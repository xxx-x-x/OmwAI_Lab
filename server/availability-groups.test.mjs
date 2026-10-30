import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAvailability } from '../dist-server/availability.js'
import { initializeDatabase } from '../dist-server/mysql.js'

const encryption = { ok: true, labEncryption: { version: 1, algorithm: 'AES-256-GCM', encryptedAtRest: true, redactedManagement: true } }
let owner = 1000
function fixture({ models = ['model-1', 'model-2'], quota = {}, failAt, failBind, body = {} } = {}) {
  const events = [], writes = [], reserved = [], bound = [], queries = []
  let adds = 0, committed = false
  const db = {
    transaction: async fn => {
      const result = await fn({})
      committed = true
      return result
    },
    get: async (sql, params) => {
      queries.push([sql, params])
      if (sql.includes('FROM submissions')) return { id: 7, website: 'https://8.8.8.8' }
      if (sql.includes('AS owned')) return { total: 0, owned: 0, daily: 0, ...quota }
      return { id: 1 }
    },
    run: async (sql, params) => {
      writes.push([sql, params])
      if (sql.startsWith('INSERT')) { assert.equal(committed, false); reserved.push(params) }
      else { if (failBind && bound.length === failBind - 1) throw new Error('private DB failure'); bound.push(params) }
    },
    all: async () => [],
  }
  const c = {
    database: db, request: { method: 'POST' }, response: { setHeader() {} },
    url: new URL('https://lab/api/user/availability'), user: { id: 42, login: 'test' }, localUserId: owner++,
    config: { enabled: true, origins: ['https://8.8.8.8'] },
    readJson: async () => ({ siteId: 7, models, key: 'private-low-quota-key', groupName: '', intervalSeconds: 900, baseUrl: 'https://8.8.8.8', costConfirmed: true, keyConfirmed: true, ...body }),
    json: (_res, status, payload) => ({ status, payload }),
    models: async () => ['model-1', 'model-2', 'model-3', 'model-4', 'model-5'],
    connect: async (_config, action) => {
      assert.equal(committed, true)
      return action(async (event, payload) => {
        events.push(event)
        if (event === 'labEncryptionCapabilities') return encryption
        assert.equal(event, 'add'); assert.ok(reserved.length >= 1)
        assert.equal(payload.active, false)
        adds++
        if (adds === failAt) throw new Error('private upstream key')
        return { monitorID: 100 + adds }
      })
    },
  }
  return { c, events, reserved, bound, writes, queries }
}

test('five models reserve one group before upstream and create independent paused bindings', async () => {
  const f = fixture({ models: ['model-1', 'model-2', 'model-3', 'model-4', 'model-5'] })
  const result = await handleAvailability(f.c)
  assert.equal(result.status, 201); assert.equal(result.payload.ok, true)
  assert.equal(f.reserved.length, 5); assert.equal(f.bound.length, 5)
  assert.equal(new Set(f.reserved.map(row => row[0])).size, 5)
  assert.ok(f.reserved.every(row => row[1] === result.payload.taskGroupId))
  assert.deepEqual(result.payload.models.map(row => row.state), Array(5).fill('paused'))
  assert.equal(result.payload.id, result.payload.models[0].id)
  assert.ok(!JSON.stringify([f.writes, result]).includes('private-low-quota-key'))
  const sql = f.queries.find(([sql]) => sql.includes('AS owned'))[0]
  assert.match(sql, /COUNT\(DISTINCT CASE WHEN BINARY owner_identity = BINARY \? AND state <> 'deleted' THEN COALESCE\(task_group_id, id\) END\) AS owned/)
  assert.match(sql, /COUNT\(DISTINCT CASE WHEN BINARY owner_identity = BINARY \? AND created_at >= UTC_TIMESTAMP\(\) - INTERVAL 1 DAY THEN COALESCE\(task_group_id, id\) END\) AS daily/)
})

test('legacy model creates a single grouped probe', async () => {
  const f = fixture({ models: undefined, body: { models: undefined, model: 'model-1' } })
  const result = await handleAvailability(f.c)
  assert.equal(result.status, 201); assert.equal(result.payload.models.length, 1)
})

test('reject empty, duplicate, invalid, oversized or unavailable model lists without reservations', async () => {
  for (const models of [[], ['model-1', 'model-1'], ['bad model'], ['model-1', 'model-2', 'model-3', 'model-4', 'model-5', 'model-6'], ['model-1', 'unavailable'], 'model-1', null]) {
    const f = fixture({ models })
    const result = await handleAvailability(f.c)
    assert.equal(result.status, 400); assert.deepEqual(f.reserved, []); assert.deepEqual(f.events, [])
  }
})

test('group quotas and physical capacity reject before remote creation; exact global boundary succeeds', async () => {
  for (const quota of [{ owned: 5 }, { daily: 10 }, { total: 199 }]) {
    const f = fixture({ quota })
    assert.equal((await handleAvailability(f.c)).status, 400)
    assert.deepEqual(f.reserved, []); assert.deepEqual(f.events, [])
  }
  const f = fixture({ quota: { owned: 4, daily: 9, total: 198 } })
  assert.equal((await handleAvailability(f.c)).status, 201)
})

test('lost remote ack preserves successes, uncertain and unattempted pending rows without retries or deletes', async () => {
  const f = fixture({ models: ['model-1', 'model-2', 'model-3'], failAt: 2 })
  const result = await handleAvailability(f.c)
  assert.equal(result.status, 207); assert.equal(result.payload.ok, false); assert.equal(result.payload.partial, true)
  assert.deepEqual(result.payload.models.map(row => row.state), ['paused', 'pending', 'pending'])
  assert.deepEqual(f.events, ['labEncryptionCapabilities', 'add', 'add'])
  assert.equal(f.reserved.length, 3); assert.equal(f.bound.length, 1)
  assert.ok(!JSON.stringify(result).includes('private'))
})

test('failed first add or binding keeps pending metadata and never continues', async () => {
  for (const failure of [{ failAt: 1 }, { failBind: 1 }]) {
    const f = fixture(failure)
    const result = await handleAvailability(f.c)
    assert.equal(result.status, 400); assert.equal(result.payload.partial, true)
    assert.ok(result.payload.taskGroupId)
    assert.deepEqual(result.payload.models.map(row => row.state), ['pending', 'pending'])
    assert.deepEqual(f.events, ['labEncryptionCapabilities', 'add'])
  }
})

test('all-or-nothing reservation failure makes no upstream call', async () => {
  const f = fixture()
  f.c.database.run = async () => { throw new Error('insert failed') }
  const result = await handleAvailability(f.c)
  assert.equal(result.status, 400); assert.deepEqual(f.events, [])
})

test('list exposes normalized legacy group identity and both limits', async () => {
  const f = fixture(); const queries = []
  f.c.request.method = 'GET'
  f.c.database.all = async sql => { queries.push(sql); return [] }
  const result = await handleAvailability(f.c)
  assert.equal(result.payload.maxTasks, 5); assert.equal(result.payload.maxModels, 5)
  assert.match(queries[0], /COALESCE\(task_group_id, id\) AS taskGroupId/)
})

test('owner read and mutation budgets independently support 25 histories and sequential batch actions', async () => {
  const f = fixture()
  // Disabled service avoids remote traffic while exercising the shared pre-routing limiter.
  f.c.config.enabled = false
  f.c.request.method = 'GET'
  for (let i = 0; i < 26; i++) assert.equal((await handleAvailability(f.c)).status, 200)
  f.c.request.method = 'POST'
  for (let i = 0; i < 50; i++) assert.equal((await handleAvailability(f.c)).status, 503)
  f.c.request.method = 'GET'
  for (let i = 26; i < 120; i++) assert.equal((await handleAvailability(f.c)).status, 200)
  assert.equal((await handleAvailability(f.c)).status, 429)
  f.c.request.method = 'POST'
  for (let i = 50; i < 60; i++) assert.equal((await handleAvailability(f.c)).status, 503)
  assert.equal((await handleAvailability(f.c)).status, 429)
  const other = fixture()
  other.c.request.method = 'GET'
  assert.equal((await handleAvailability(other.c)).status, 200)
})

test('nullable group migration is idempotent and preserves legacy rows', async () => {
  const writes = []
  let migrated = false
  const db = {
    run: async sql => { writes.push(sql); if (sql.startsWith('ALTER TABLE lab_monitors')) migrated = true },
    all: async sql => sql === 'SHOW COLUMNS FROM lab_monitors' ? (migrated ? [{ Field: 'task_group_id' }] : []) : [],
  }
  await initializeDatabase(db); await initializeDatabase(db)
  const changes = writes.filter(sql => sql.startsWith('ALTER TABLE lab_monitors'))
  assert.equal(changes.length, 1)
  assert.match(changes[0], /task_group_id CHAR\(36\).*NULL/)
  assert.ok(!writes.some(sql => /UPDATE lab_monitors|DELETE FROM lab_monitors/.test(sql)))
})
