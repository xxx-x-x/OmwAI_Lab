import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createBackend } from '../dist-server/backend.js'
import { ADMIN_SESSION_IDLE_MS, ADMIN_SESSION_TTL_MS, SESSION_IDLE_MS, SESSION_TTL_MS, sessionCookie, sessionExpired, validWriteOrigin } from '../dist-server/session-security.js'

const request = (headers = {}, method = 'POST', encrypted = false) => ({ method, headers: { host: 'localhost:5173', ...headers }, socket: { encrypted } })

test('write origin validation fails closed and never trusts forwarded host', () => {
  assert.equal(validWriteOrigin(request(), ''), false)
  assert.equal(validWriteOrigin(request({ origin: 'null' }), ''), false)
  assert.equal(validWriteOrigin(request({ origin: 'http://evil.example' }), ''), false)
  assert.equal(validWriteOrigin(request({ origin: 'http://localhost:5173' }), ''), true)
  assert.equal(validWriteOrigin(request({ referer: 'http://localhost:5173/admin' }), ''), true)
  assert.equal(validWriteOrigin(request({ origin: 'http://evil.example', referer: 'http://localhost:5173/' }), ''), false)
  assert.equal(validWriteOrigin(request({ origin: 'http://localhost:5173', 'sec-fetch-site': 'cross-site' }), ''), false)
  assert.equal(validWriteOrigin(request({ origin: 'https://example.com' }), 'https://example.com'), true)
  assert.equal(validWriteOrigin(request({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }), 'https://example.com'), false)
  assert.equal(validWriteOrigin(request({ origin: 'https://localhost:5173' }, 'POST', true), ''), true)
  assert.equal(validWriteOrigin(request({}, 'GET'), ''), true)
})

test('session cookies and absolute/idle timeouts have safe boundaries', () => {
  assert.match(sessionCookie('token', true), /HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/)
  assert.doesNotMatch(sessionCookie('token', false), /Secure/)
  assert.match(sessionCookie('', true, 0), /Max-Age=0; Secure$/)
  const now = 100_000_000
  for (const [role, idle, ttl] of [['user', SESSION_IDLE_MS, SESSION_TTL_MS], ['admin', ADMIN_SESSION_IDLE_MS, ADMIN_SESSION_TTL_MS]]) {
    const session = { user: { role }, lastSeenAt: now, expiresAt: now + ttl }
    assert.equal(sessionExpired(session, now + idle - 1), false)
    assert.equal(sessionExpired(session, now + idle), true)
    assert.equal(sessionExpired({ ...session, lastSeenAt: now + ttl }, now + ttl), true)
  }
})

test('HTTP blocks cross-site and missing-source writes before dependencies, permits same-origin logout', async t => {
  const backend = createBackend({ COOKIE_SECURE: 'true' })
  const server = createServer((req, res) => { void backend.handle(req, res, () => { res.statusCode = 404; res.end() }) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise(done => server.close(done)); await backend.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  for (const path of ['/api/auth/logout', '/api/auth/login', '/api/admin/users/1', '/api/admin/site-quotes/1', '/api/user/sites/1']) {
    for (const headers of [{}, { origin: 'https://evil.example' }]) {
      const response = await fetch(base + path, { method: 'POST', headers })
      assert.equal(response.status, 403, path)
      assert.equal((await response.json()).code, 'CSRF_ORIGIN_REJECTED')
    }
  }
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { origin: base } })
  assert.equal(logout.status, 200)
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0; Secure$/)
  assert.equal(logout.headers.get('cache-control'), 'no-store')
})
