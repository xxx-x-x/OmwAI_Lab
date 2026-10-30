import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAvailability } from '../dist-server/availability.js'
import { monitorPayload, safeBeats, uptimeConfig, validateMonitorTarget } from '../dist-server/uptime.js'
const config = { enabled: true, url: 'https://status.example.com', token: 'secret', username: '', password: '', origins: ['https://api.example.com'] }
function context(overrides = {}) {
  const response = { setHeader() {} }
  return { database: { get: async () => undefined }, request: { method: 'POST' }, response, url: new URL('http://lab/api/user/availability/11111111-1111-1111-1111-111111111111/resume'), user: { id: 42, login: 'tester', html_url: '' }, localUserId: 42, config, readJson: async () => ({}), json: (_res, status, payload) => ({ status, payload }), ...overrides }
}
test('disabled unless enabled AND egress enforcement is acknowledged', () => {
  assert.equal(uptimeConfig({ UPTIME_ENABLED: 'true' }).enabled, false)
  assert.throws(() => uptimeConfig({ UPTIME_ENABLED: 'true', UPTIME_EGRESS_ENFORCED: 'true' }))
})
test('target requires allowed HTTPS public DNS and canonical path', async () => {
  const dns = async () => [{ address: '8.8.8.8', family: 4 }]
  assert.equal(await validateMonitorTarget('https://api.example.com/v1', config, dns), 'https://api.example.com/v1/chat/completions')
  for (const value of ['http://api.example.com', 'https://other.example.com', 'https://api.example.com/private', 'https://api.example.com?key=secret', 'https://user:pass@api.example.com']) await assert.rejects(validateMonitorTarget(value, config, dns))
  await assert.rejects(validateMonitorTarget('https://api.example.com', config, async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }]))
})
test('payload is paused, bounded, non-streaming and no notifications/redirects/retries', () => {
  const payload = monitorPayload('Lab:uuid', 'https://api.example.com/v1/chat/completions', 'model', 'private-key', 900)
  assert.equal(payload.active, false); assert.equal(payload.maxredirects, 0); assert.equal(payload.maxretries, 0); assert.equal(payload.timeout, 30)
  assert.equal(JSON.parse(payload.body).stream, false); assert.equal(JSON.parse(payload.body).max_tokens, 16)
  assert.deepEqual(payload.notificationIDList, {}); assert.equal(payload.parent, null)
  assert.equal(payload.type, 'json-query'); assert.equal(payload.expectedValue, 'true')
})
test('history only exposes safe numeric/date fields, never error messages or monitor IDs', () => {
  assert.deepEqual(safeBeats([{ time: '2026-10-30', status: 0, ping: 42, msg: 'Bearer secret', monitor_id: 99, response: 'secret' }]), [{ time: '2026-10-30', status: 0, ping: 42 }])
})
test('authentication and exact DB ownership precede any Uptime call', async () => {
  let connected = false, sql = '', params
  const connect = async () => { connected = true; throw new Error('must not connect') }
  assert.equal((await handleAvailability(context({ user: null, connect }))).status, 401)
  const result = await handleAvailability(context({ connect, database: { get: async (query, values) => { sql = query; params = values } } }))
  assert.equal(result.status, 404); assert.equal(connected, false)
  assert.match(sql, /BINARY owner_identity = BINARY \?/); assert.equal(params[1], 'local:42')
})
test('pending binding cannot operate by name or discover any existing monitors', async () => {
  const result = await handleAvailability(context({ database: { get: async () => ({ id: 'uuid', monitor_id: null }) }, connect: async () => { throw new Error('must not connect') } }))
  assert.equal(result.status, 409)
})
test('unbound/mismatched upstream monitor cannot be resumed or deleted', async () => {
  const events = []
  const db = { get: async () => ({ id: 'uuid', monitor_id: 99, endpoint: 'https://api.example.com/v1/chat/completions', interval_seconds: 900 }), transaction: async fn => fn({}) }
  const result = await handleAvailability(context({ database: db, connect: async (_config, action) => action(async event => { events.push(event); return { ok: true, monitor: { name: 'original monitor' } } }) }))
  assert.equal(result.status, 400); assert.deepEqual(events, ['getMonitor'])
})
test('no raw upstream secrets in errors', async () => {
  const db = { get: async () => ({ id: 'uuid', monitor_id: 99 }), transaction: async fn => fn({}) }
  const result = await handleAvailability(context({ database: db, connect: async () => { throw new Error('authorization: Bearer private-secret') } }))
  assert.equal(result.status, 400); assert.ok(!JSON.stringify(result).includes('private-secret'))
})

test('creation reserves owned DB binding before add, creates paused and never resumes', async () => {
  const order = [], writes = []
  const body = { siteId: 7, model: 'model-1', key: 'dedicated-low-quota-key', groupName: '', intervalSeconds: 900, baseUrl: 'https://8.8.8.8', costConfirmed: true, keyConfirmed: true }
  const db = {
    transaction: async fn => fn({}),
    get: async sql => sql.includes('FROM submissions') ? { id: 7, website: 'https://8.8.8.8' } : sql.includes('SUM(') ? { total: 0, owned: 0, daily: 0 } : { id: 1 },
    run: async (sql, params) => { order.push(sql.startsWith('INSERT') ? 'reserve' : 'bind'); writes.push({ sql, params }) },
  }
  const result = await handleAvailability(context({ url: new URL('http://lab/api/user/availability'), database: db, readJson: async () => body, config: { ...config, origins: ['https://8.8.8.8'] }, models: async () => ['model-1'], connect: async (_config, fn) => fn(async (event, payload) => { if (event === 'labEncryptionCapabilities') return { ok: true, labEncryption: { version: 1, algorithm: 'AES-256-GCM', encryptedAtRest: true, redactedManagement: true } }; order.push(event); assert.equal(payload.active, false); assert.equal(payload.type, 'json-query'); return { ok: true, monitorID: 123 } }) }))
  assert.equal(result.status, 201); assert.deepEqual(order, ['reserve', 'add', 'bind'])
  assert.ok(!JSON.stringify(writes).includes(body.key)); assert.ok(!JSON.stringify(result).includes(body.key))
})
test('owned history calls only the bound monitor and filters upstream data', async () => {
  const events = [], task = { id: 'uuid', monitor_id: 77, endpoint: 'https://api.example.com/v1/chat/completions', interval_seconds: 900 }
  const db = { get: async () => task, transaction: async fn => fn({}) }
  const result = await handleAvailability(context({ request: { method: 'GET' }, url: new URL('http://lab/api/user/availability/11111111-1111-1111-1111-111111111111/history'), database: db, connect: async (_config, action) => action(async (event, ...args) => {
    events.push([event, ...args])
    return event === 'getMonitor' ? { ok: true, monitor: { name: 'Lab:uuid', url: task.endpoint, type: 'json-query', parent: null, maxredirects: 0, interval: 900, active: true, headers: 'secret' } } : { ok: true, data: [{ time: '2026-10-30', status: 1, ping: 50, msg: 'private-secret' }] }
  }) }))
  assert.equal(result.status, 200); assert.deepEqual(events, [['getMonitor', 77], ['getMonitorBeats', 77, 24]])
  assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(result.payload.active, true)
})
test('delete only exact bound monitor, explicitly false deleteChildren and preserves binding audit row', async () => {
  const task = { id: 'uuid', monitor_id: 77, endpoint: 'https://api.example.com/v1/chat/completions', interval_seconds: 900 }, events = [], writes = []
  const db = { get: async () => task, transaction: async fn => fn({}), run: async (sql, params) => writes.push([sql, params]) }
  const result = await handleAvailability(context({ request: { method: 'DELETE' }, url: new URL('http://lab/api/user/availability/11111111-1111-1111-1111-111111111111'), readJson: async () => ({ deleteConfirmed: true }), database: db, connect: async (_config, action) => action(async (event, ...args) => {
    events.push([event, ...args]); return { ok: true, monitor: { name: 'Lab:uuid', url: task.endpoint, type: 'json-query', parent: null, maxredirects: 0, interval: 900 } }
  }) }))
  assert.equal(result.status, 200); assert.deepEqual(events, [['getMonitor', 77], ['deleteMonitor', 77, false]])
  assert.match(writes[0][0], /^UPDATE lab_monitors/); assert.equal(writes[0][1][0], 'deleted')
})
