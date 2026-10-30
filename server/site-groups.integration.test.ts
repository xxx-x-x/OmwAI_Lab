import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createBackend } from '../dist-server/backend.js'

test('retired manual quote routes return 410 before database, sessions or MFA and never reach fallback', async t => {
  const backend = createBackend({})
  let fallbacks = 0
  const server = createServer((request, response) => { void backend.handle(request, response, () => { fallbacks++; response.statusCode = 404; response.end() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await backend.close() })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const paths = ['/api/user/sites/1/authorizations', '/api/user/sites/1/authorizations/Group%20A', '/api/user/sites/1/quotes', '/api/user/sites/1/quotes/42', '/api/admin/site-quotes', '/api/admin/site-quotes/42']
  for (const path of paths) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = await fetch(`${base}${path}`, { method, headers: { origin: base, cookie: 'omwai_session=%' } })
      assert.equal(response.status, 410, `${method} ${path}`)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      if (method !== 'HEAD') assert.match((await response.json()).error, /retired/)
    }
  }
  assert.equal(fallbacks, 0)
})
