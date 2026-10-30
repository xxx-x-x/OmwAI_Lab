import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAvailability } from '../dist-server/availability.js'
const body = { siteId: 7, model: 'model-1', key: 'private-low-quota-key', groupName: '', intervalSeconds: 900, baseUrl: 'https://8.8.8.8', costConfirmed: true, keyConfirmed: true }
function context(extra = {}) {
  return { database: { transaction: async fn => fn({}), get: async sql => sql.includes('FROM submissions') ? { id: 7, website: 'https://8.8.8.8' } : sql.includes('SUM(') ? { total: 0, owned: 0, daily: 0 } : { id: 1 }, run: async () => {} }, request: { method: 'POST' }, response: { setHeader() {} }, url: new URL('https://lab/api/user/availability'), user: { id: 42, login: 'tester', html_url: '' }, localUserId: 42, config: { enabled: true, origins: ['https://8.8.8.8'] }, readJson: async () => body, json: (_res, status, payload) => ({ status, payload }), models: async () => ['model-1'], ...extra }
}
test('unsupported Uptime receives capability only, never add or KEY', async () => {
  const calls = []
  const result = await handleAvailability(context({ connect: async (_config, fn) => fn(async (...args) => { calls.push(args); return { ok: true } }) }))
  assert.equal(result.status, 400); assert.match(result.payload.error, /拒绝发送 KEY/)
  assert.deepEqual(calls, [['labEncryptionCapabilities']]); assert.ok(!JSON.stringify(calls).includes(body.key))
})
test('server rejects hand-entered model absent from current upstream list before any remote call', async () => {
  let connected = false
  const result = await handleAvailability(context({ models: async () => ['different-model'], connect: async () => { connected = true } }))
  assert.equal(result.status, 400); assert.equal(connected, false); assert.match(result.payload.error, /上游模型列表/)
})
test('models endpoint requires ownership before touching upstream with KEY', async () => {
  let fetched = false
  const result = await handleAvailability(context({ url: new URL('https://lab/api/user/availability/models'), database: { get: async () => undefined }, models: async () => { fetched = true; return ['a'] } }))
  assert.equal(result.status, 400); assert.equal(fetched, false)
})
test('models endpoint rechecks public group and never returns key', async () => {
  const result = await handleAvailability(context({ url: new URL('https://lab/api/user/availability/models'), readJson: async () => ({ ...body, groupName: 'missing' }), database: { get: async sql => sql.includes('FROM submissions') ? { id: 7, website: 'https://8.8.8.8' } : undefined }, models: async () => { throw new Error('must not fetch') } }))
  assert.equal(result.status, 400); assert.match(result.payload.error, /分组不存在/); assert.ok(!JSON.stringify(result).includes(body.key))
})
