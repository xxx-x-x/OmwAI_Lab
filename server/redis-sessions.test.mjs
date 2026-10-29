import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Redis } from 'ioredis'
import { createAuthRedis, AuthRedisUnavailableError } from '../dist-server/auth-redis.js'
import { createBackend } from '../dist-server/backend.js'
import { ADMIN_SESSION_IDLE_MS, SESSION_IDLE_MS } from '../dist-server/session-security.js'

const token = () => randomBytes(32).toString('hex')
const session = (overrides = {}) => ({ user: { id: 'oauth-user', login: 'tester', role: 'user', name: null, avatar_url: '', html_url: '' }, localUserId: null, lastSeenAt: Date.now(), expiresAt: Date.now() + 60_000, ...overrides })

async function listen(backend) {
  const server = createServer((req, res) => { void backend.handle(req, res, () => { res.statusCode = 404; res.end() }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => { await new Promise(resolve => server.close(resolve)); await backend.close() } }
}

test('Redis unavailable returns 503 without deleting the browser session', async t => {
  const backend = createBackend({})
  const http = await listen(backend)
  t.after(http.close)
  for (const [path, method] of [['/api/auth/me', 'GET'], ['/api/auth/logout', 'POST']]) {
    const response = await fetch(http.base + path, { method, headers: { cookie: `omwai_session=${token()}`, origin: http.base } })
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('set-cookie'), null)
  }
  const store = createAuthRedis('')
  t.after(() => store.close())
  await assert.rejects(store.sessions.create(token(), session()), AuthRedisUnavailableError)
  await assert.rejects(store.sessions.revokeUser(1), AuthRedisUnavailableError)
})

test('real Redis: shared sessions, restart, hashed tokens, expiry, atomic touch and revocation', { skip: !process.env.REDIS_TEST_URL }, async t => {
  const url = process.env.REDIS_TEST_URL
  const prefix = `omwai-session-test:${randomUUID()}:`
  const client = new Redis(url, { maxRetriesPerRequest: 1 })
  const stores = []
  const makeStore = () => { const store = createAuthRedis(url, prefix); stores.push(store); return store.sessions }
  t.after(async () => {
    const keys = await client.keys(`${prefix}*`)
    if (keys.length) await client.del(...keys)
    stores.forEach(store => store.close())
    client.disconnect()
  })
  const first = makeStore()
  const second = makeStore()
  const id = token()
  const original = session({ mfaVerifiedAt: Date.now() })
  await first.create(id, original)
  assert.deepEqual(await second.get(id, false), original)
  const keys = await client.keys(`${prefix}*`)
  assert.ok(keys.every(key => !key.includes(id)))
  const stored = await client.get(keys[0])
  assert.ok(!stored.includes(id))
  assert.ok(await client.pttl(keys[0]) > 0)
  stores[0].close()
  assert.deepEqual(await makeStore().get(id, false), original)
  await new Promise(resolve => setTimeout(resolve, 15))
  const reads = await Promise.all(Array.from({ length: 12 }, () => second.get(id)))
  assert.ok(reads.every(value => value.lastSeenAt >= original.lastSeenAt))
  assert.ok(reads.every(value => value.expiresAt === original.expiresAt))
  await second.delete(id)
  assert.equal(await second.get(id), undefined)

  for (const [role, idle] of [['user', SESSION_IDLE_MS], ['admin', ADMIN_SESSION_IDLE_MS]]) {
    const expiredId = token()
    await second.create(expiredId, session({ user: { ...original.user, role }, lastSeenAt: Date.now() - idle, expiresAt: Date.now() + 60_000 }))
    assert.equal(await second.get(expiredId), undefined)
    const activeId = token()
    await second.create(activeId, session({ user: { ...original.user, role }, lastSeenAt: Date.now() - idle + 30_000 }))
    assert.ok(await second.get(activeId))
  }
  const short = token()
  await second.create(short, session({ expiresAt: Date.now() + 30 }))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(await second.get(short), undefined)

  const oldIds = [token(), token()]
  for (const oldId of oldIds) await second.create(oldId, session({ localUserId: 42 }))
  const other = token()
  await second.create(other, session({ localUserId: 43 }))
  await second.revokeUser(42)
  for (const oldId of oldIds) assert.equal(await second.get(oldId), undefined)
  assert.ok(await second.get(other))
  const fresh = token()
  await second.create(fresh, session({ localUserId: 42 }))
  assert.ok(await second.get(fresh))
  await Promise.all([second.get(fresh), second.revokeUser(42)])
  assert.equal(await second.get(fresh), undefined)
  assert.equal(await second.get('invalid-token'), undefined)
  const isolated = createAuthRedis(url, `${prefix}isolated:`)
  t.after(() => isolated.close())
  assert.equal(await isolated.sessions.get(other), undefined)
})

test('real Redis: HTTP session survives backend restart and logout revokes across instances', { skip: !process.env.REDIS_TEST_URL }, async t => {
  const url = process.env.REDIS_TEST_URL
  const prefix = `omwai-http-session-test:${randomUUID()}:`
  const store = createAuthRedis(url, prefix)
  const client = new Redis(url, { maxRetriesPerRequest: 1 })
  const servers = []
  t.after(async () => {
    for (const server of servers) await server.close()
    const keys = await client.keys(`${prefix}*`)
    if (keys.length) await client.del(...keys)
    store.close()
    client.disconnect()
  })
  const makeServer = async () => { const server = await listen(createBackend({ REDIS_URL: url, REDIS_KEY_PREFIX: prefix })); servers.push(server); return server }
  const id = token()
  const value = session()
  await store.sessions.create(id, value)
  const headers = { cookie: `omwai_session=${id}` }
  const first = await makeServer()
  assert.deepEqual((await (await fetch(first.base + '/api/auth/me', { headers })).json()).user, value.user)
  await first.close()
  servers.splice(servers.indexOf(first), 1)
  const restarted = await makeServer()
  const peer = await makeServer()
  for (const server of [restarted, peer]) {
    const response = await fetch(server.base + '/api/auth/me', { headers })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).user, value.user)
    assert.equal(response.headers.get('set-cookie'), null)
  }
  const logout = await fetch(restarted.base + '/api/auth/logout', { method: 'POST', headers: { ...headers, origin: restarted.base } })
  assert.equal(logout.status, 200)
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
  const response = await fetch(peer.base + '/api/auth/me', { headers })
  assert.equal((await response.json()).user, null)
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
})
