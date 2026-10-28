import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.ts'
import { createLogoFetchGate, handleLogoSettings } from './site-logo-settings.ts'
import { createSiteLogoFetcher, validateLogoUrl } from './site-logo.ts'

function fixture() {
  const writes: { sql: string; values: unknown[] }[] = []
  let allowed = true, fail = false, raced = false, inTransaction = false, downloads = 0
  const current = { website: 'https://example.com', cachedWebsite: 'https://example.com', custom_url: 'https://cdn.example/logo.png', revision: 2, image: Buffer.from('old'), digest: 'old', content_type: 'image/png' }
  const db = {
    get: async (sql: string) => sql.includes('SELECT revision') ? { revision: raced ? 3 : 2 } : current,
    run: async (sql: string, values: unknown[]) => { writes.push({ sql, values }); return { affectedRows: 1 } },
    transaction: async (fn: (connection: unknown) => Promise<unknown>) => { inTransaction = true; try { return await fn({}) } finally { inTransaction = false } },
  } as unknown as Database
  async function request(action = '', method = 'PATCH', body: Record<string, unknown> = { url: 'https://cdn.example/new.png', revision: 2 }) {
    let status = 200, payload: unknown
    const headers: Record<string, unknown> = {}
    const res = { setHeader: (key: string, value: unknown) => { headers[key] = value }, end: (value: unknown) => { payload = value } } as unknown as ServerResponse
    const fetch = async () => { assert.equal(inTransaction, false); downloads++; return fail ? null : { data: Buffer.from('new'), contentType: 'image/png' } }
    await handleLogoSettings({ database: db, request: { method } as IncomingMessage, response: res, providerId: 7, identity: 'local:1', authorize: async () => allowed, readJson: async () => body, json: (_res, code, value) => { status = code; payload = value }, image: fetch, discover: fetch, gate: async (_key, _cooldown, fn) => fn() }, action)
    return { status, payload, headers }
  }
  return { request, writes, setAllowed: (value: boolean) => { allowed = value }, setFail: () => { fail = true }, setRaced: () => { raced = true }, downloads: () => downloads }
}
test('preview is scoped, no-store and never commits; save refetches before mutation', async () => {
  const f = fixture()
  const preview = await f.request('preview', 'POST')
  assert.equal(preview.status, 200); assert.equal(preview.headers['cache-control'], 'no-store'); assert.ok(Buffer.isBuffer(preview.payload)); assert.equal(f.writes.length, 0)
  assert.equal((await f.request()).status, 200); assert.equal(f.downloads(), 2)
  assert.ok(f.writes[1].values.includes('https://cdn.example/new.png'))
  assert.match(f.writes[1].sql, /revision = revision \+ 1/)
})
test('failed save retains prior image and preference; clear removes stale manual image even if discovery fails', async () => {
  const f = fixture(); f.setFail()
  assert.equal((await f.request()).status, 422); assert.equal(f.writes.length, 0)
  assert.equal((await f.request('', 'PATCH', { url: '', revision: 2 })).status, 200)
  assert.deepEqual(f.writes[1].values.slice(1, 5), [null, null, null, null])
})
test('failed refetch preserves bytes and URL with retriable status', async () => {
  const f = fixture(); f.setFail()
  assert.equal((await f.request('refetch', 'POST', { revision: 2 })).status, 200)
  assert.match(f.writes[1].sql, /fetch_status = 'failed'/); assert.doesNotMatch(f.writes[1].sql, /image =|custom_url =/)
})
test('authorization and stale revision prevent fetches; racing save prevents overwrite', async () => {
  const f = fixture(); f.setAllowed(false)
  assert.equal((await f.request('preview', 'POST')).status, 404); assert.equal(f.downloads(), 0)
  f.setAllowed(true)
  assert.equal((await f.request('', 'PATCH', { url: '', revision: 1 })).status, 409); assert.equal(f.downloads(), 0)
  f.setRaced(); assert.equal((await f.request()).status, 409); assert.equal(f.writes.length, 1)
})
test('URL limits and public transport apply to direct images without discovery requests', async () => {
  assert.throws(() => validateLogoUrl('https://example.com/' + 'a'.repeat(2048)))
  const paths: string[] = []
  const fetch = createSiteLogoFetcher({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async url => { paths.push(url.pathname); return { status: 200, headers: {}, data: Buffer.from('<html>not image</html>') } } }, true)
  assert.equal(await fetch('https://example.com/direct.png'), null); assert.deepEqual(paths, ['/direct.png'])
  const f = fixture()
  for (const url of ['http://localhost/a', 'https://example.com:9000/a', 'file:///a']) assert.equal((await f.request('preview', 'POST', { url })).status, 400)
  assert.equal(f.downloads(), 0)
})
test('fetch gate enforces per-identity cooldown and global four-fetch concurrency', async () => {
  const gate = createLogoFetchGate()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const tasks = Array.from({ length: 4 }, (_, i) => gate(String(i), 3000, () => pending))
  await assert.rejects(gate('fifth', 3000, async () => 1), /LOGO_BUSY/)
  release(); await Promise.all(tasks)
  await assert.rejects(gate('0', 3000, async () => 1), /LOGO_BUSY/)
})
