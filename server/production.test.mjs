import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createProductionServer, productionConfig } from '../dist-server/production.js'

test('production config validates port and trusted proxy origin', () => {
  assert.deepEqual(productionConfig({}), { host: '127.0.0.1', port: 3000 })
  for (const PORT of ['0', '-1', 'abc', '65536', '1.5']) assert.throws(() => productionConfig({ PORT }))
  assert.throws(() => productionConfig({ TRUST_PROXY: 'true' }))
  assert.throws(() => productionConfig({ PUBLIC_ORIGIN: 'https://example.com/path' }))
  assert.equal(productionConfig({ TRUST_PROXY: 'true', PUBLIC_ORIGIN: 'https://example.com', PORT: '4000' }).port, 4000)
})

test('production HTTP serves safe static/SPA routes and database-independent APIs', async t => {
  const root = resolve(`.production-test-${process.pid}`)
  const dist = resolve(root, 'dist')
  await mkdir(resolve(dist, 'assets'), { recursive: true })
  await writeFile(resolve(dist, 'index.html'), '<html>production fixture</html>')
  await writeFile(resolve(dist, 'assets', 'app-hash.js'), 'console.log("ok")')
  await writeFile(resolve(dist, '.env'), 'hidden')
  await writeFile(resolve(root, 'secret.txt'), 'outside')
  let linked = false
  try { await symlink(resolve(root, 'secret.txt'), resolve(dist, 'leak.txt')); linked = true } catch { /* Windows may require elevated symlink permissions. */ }
  const app = createProductionServer({}, dist)
  await new Promise(done => app.server.listen(0, '127.0.0.1', done))
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${app.server.address().port}`
  for (const path of ['/', '/submit', '/account/settings']) {
    const response = await fetch(base + path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /production fixture/)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  }
  const asset = await fetch(base + '/assets/app-hash.js')
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('cache-control'), /immutable/)
  const head = await fetch(base + '/', { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  for (const path of ['/api', '/api/unknown', '/assets/missing.js', '/missing.css', '/.env', '/%2eenv', '/%2e%2e%5csecret.txt', ...(linked ? ['/leak.txt'] : [])]) {
    assert.equal((await fetch(base + path, { headers: { accept: 'text/html' } })).status, 404, path)
  }
  assert.equal((await fetch(base + '/%ZZ')).status, 400)
  assert.equal((await fetch(base + '/submit', { method: 'POST' })).status, 405)
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { status: 'ok' })
  assert.deepEqual(await (await fetch(base + '/api/auth/me')).json(), { user: null })
  const db = await fetch(base + '/api/model-prices')
  assert.equal(db.status, 503)
  assert.deepEqual(await db.json(), { error: '数据库服务暂不可用' })
  assert.equal((await fetch(base + '/api/auth/me', { headers: { cookie: 'bad=%ZZ' } })).status, 500)
})
