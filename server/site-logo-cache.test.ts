import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.ts'
import { createSiteLogoCache, serveSiteLogo } from './site-logo-cache.ts'

function fixture(row?: Record<string, unknown>) {
  const calls: { sql: string; values: unknown[] }[] = []
  const database = {
    all: async (sql: string) => { calls.push({ sql, values: [] }); return [{ id: 1, website: 'https://example.com' }] },
    run: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return {} },
    get: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return row },
  } as unknown as Database
  return { database, calls }
}

test('cache stores validated image bytes and guards against website changes', async () => {
  const f = fixture()
  const data = Buffer.from('image fixture')
  let downloaded!: () => void
  const started = new Promise<void>(resolve => { downloaded = resolve })
  const cache = createSiteLogoCache(f.database, async website => { assert.equal(website, 'https://example.com'); downloaded(); return { data, contentType: 'image/png' } })
  cache.schedule()
  await started
  await cache.close()
  assert.equal(f.calls.length, 3)
  assert.match(f.calls[0].sql, /INTERVAL 7 DAY/)
  assert.match(f.calls[1].sql, /INSERT IGNORE/)
  assert.equal(f.calls[2].values[1], data)
  assert.match(f.calls[2].sql, /p.website = \?/)
})

test('failed download records attempt without overwriting cached image', async () => {
  const f = fixture()
  let downloaded!: () => void
  const started = new Promise<void>(resolve => { downloaded = resolve })
  const cache = createSiteLogoCache(f.database, async () => { downloaded(); return null })
  cache.schedule()
  await started
  await cache.close()
  assert.equal(f.calls.length, 3)
  assert.match(f.calls[2].sql, /IF\(l.website = \?, l.image, NULL\)/)
})

async function serve(row?: Record<string, unknown>, method = 'GET', headers = {}) {
  const f = fixture(row)
  const responseHeaders: Record<string, unknown> = {}
  let body: unknown
  const response = { statusCode: 0, setHeader: (key: string, value: unknown) => { responseHeaders[key] = value }, end: (value: unknown) => { body = value } }
  await serveSiteLogo(f.database, { method, headers } as IncomingMessage, response as unknown as ServerResponse, 1)
  return { ...f, status: response.statusCode, headers: responseHeaders, body }
}
const logo = { image: Buffer.from('image'), content_type: 'image/png', digest: 'abc' }
test('image endpoint serves local bytes with cache validation and HEAD support', async () => {
  const get = await serve(logo)
  assert.equal(get.status, 200)
  assert.deepEqual(get.body, logo.image)
  assert.equal(get.headers['content-type'], 'image/png')
  assert.equal(get.headers['x-content-type-options'], 'nosniff')
  assert.match(get.calls[0].sql, /p.active = 1 AND s.status = 'approved' AND s.directory_listed = 1/)
  assert.equal((await serve(logo, 'HEAD')).body, undefined)
  const cached = await serve(logo, 'GET', { 'if-none-match': '"abc"' })
  assert.equal(cached.status, 304)
  assert.equal(cached.body, undefined)
})
test('image endpoint rejects missing, unsafe or unpublished images and writes', async () => {
  assert.equal((await serve()).status, 404)
  assert.equal((await serve({ ...logo, content_type: 'image/svg+xml' })).status, 404)
  const post = await serve(logo, 'POST')
  assert.equal(post.status, 405)
  assert.equal(post.calls.length, 0)
})


test('scheduled refresh uses saved custom URL exclusively and guards revision on completion', async () => {
  const calls: { sql: string; values: unknown[] }[] = []
  const db = {
    all: async () => [{ id: 99, website: 'https://example.com', custom_url: 'https://cdn.example/logo.png', revision: 8 }],
    run: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return { affectedRows: 1 } },
  } as unknown as Database
  let resolve!: () => void
  const started = new Promise<void>(r => { resolve = r })
  const cache = createSiteLogoCache(db, async () => { assert.fail('manual preference must not invoke discovery') }, async url => {
    assert.equal(url, 'https://cdn.example/logo.png'); resolve(); return null
  })
  cache.schedule(); await started; await cache.close()
  assert.match(calls[1].sql, /l.revision = \?/)
  assert.match(calls[1].sql, /IF\(l.website = \?, l.image, NULL\)/)
  assert.doesNotMatch(calls[1].sql, /custom_url =/)
  assert.equal(calls[1].values.at(-2), 8)
  assert.ok(calls[1].values.includes('failed'))
})
