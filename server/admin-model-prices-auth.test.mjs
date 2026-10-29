import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { createBackend } from '../dist-server/backend.js'

test('model price mutations reject missing/cross-site origin before any database or auth dependency', async t => {
  const backend = createBackend({})
  const server = createServer((req, res) => { void backend.handle(req, res, () => { res.statusCode = 404; res.end() }) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise(done => server.close(done)); await backend.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const headers of [{}, { origin: 'https://evil.example' }, { origin: base, 'sec-fetch-site': 'cross-site' }]) {
      const response = await fetch(`${base}/api/admin/model-prices`, { method, headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })
      assert.equal(response.status, 403)
      assert.equal((await response.json()).code, 'CSRF_ORIGIN_REJECTED')
    }
  }
})
