import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'
import type { Database } from './mysql.ts'
import { handlePublicPricing, parseNewApiPricing, parseSub2ApiPricing, isPublicAddress, publicPricingUrl, fetchPublicPricing, publicComparisonQuotes } from './public-pricing.ts'

const row = { model_name: 'Exact-Model', quota_type: 0, model_ratio: 1.5, completion_ratio: 4, enable_groups: ['standard'] }
const payload = { success: true, data: [row], group_ratio: { standard: 0.5 } }
test('new-api uses explicit token and group ratios, never price or fallback defaults', () => {
  assert.equal(parseNewApiPricing({ ...payload, data: [{ ...row, billing_mode: 'ratio' }] }).quotes.length, 1)
  const parsed = parseNewApiPricing(payload)
  assert.deepEqual(parsed.quotes[0], { modelId: 'Exact-Model', groupName: 'standard', groupMultiplier: 0.5, currency: 'USD', billingUnit: '1M tokens', inputPrice: '1.50000000', outputPrice: '6.00000000', cacheReadPrice: null })
  for (const change of [{ quota_type: 1 }, { completion_ratio: undefined }, { model_ratio: '1' }, { billing_expr: 'tiered' }, { billing_mode: 'tiered' }, { enable_groups: [] }, { enable_groups: ['unknown'] }]) assert.throws(() => parseNewApiPricing({ ...payload, data: [{ ...row, ...change }] }))
  assert.equal(parseNewApiPricing({ ...payload, data: [row, { ...row, quota_type: 1 }] }).unsupportedCount, 1)
  assert.throws(() => parseNewApiPricing({ ...payload, success: false }))
  assert.throws(() => parseNewApiPricing({ ...payload, data: [row, row] }))
})
test('sub2api verified public model plaza retail formula excludes tiered/peak/time prices', () => {
  const model = { name: 'exact', pricing: { billing_mode: 'token', input_price: 0.000002, output_price: 0.000008, cache_read_price: 0.000001 } }
  const group = { name: 'group', rate_multiplier: 0.5, models: [model] }
  const wrap = (g: unknown) => ({ code: 0, data: { groups: [g] } })
  assert.throws(() => parseSub2ApiPricing({ code: 0, message: 'success', data: { groups: [] } }), /no_public_groups/)
  assert.equal(parseSub2ApiPricing(wrap(group)).quotes[0].groupMultiplier, 0.5)
  assert.equal(parseSub2ApiPricing(wrap(group)).quotes[0].inputPrice, '1.00000000')
  assert.equal(parseSub2ApiPricing(wrap(group)).quotes[0].outputPrice, '4.00000000')
  assert.equal(parseSub2ApiPricing(wrap(group)).quotes[0].cacheReadPrice, '0.50000000')
  assert.equal(parseSub2ApiPricing(wrap({ ...group, models: [{ ...model, pricing: { ...model.pricing, cache_read_price: 0 } }] })).quotes[0].cacheReadPrice, '0.00000000')
  for (const change of [{ peak_rate_enabled: true }, { rate_multiplier: undefined }, { user_rate_multiplier: 0 }]) assert.throws(() => parseSub2ApiPricing(wrap({ ...group, ...change })))
  for (const change of [{ long_context_basis: 'tokens' }, { time_pricing: { periods: [{}] } }, { pricing: { ...model.pricing, intervals: [{}] } }, { pricing: { ...model.pricing, billing_mode: 'per_request' } }]) assert.throws(() => parseSub2ApiPricing(wrap({ ...group, models: [{ ...model, ...change }] })))
  assert.equal(publicPricingUrl('https://example.com/site', 'sub2api').pathname, '/api/v1/model-plaza')
})
test('SSRF classifier rejects special/private/reserved, mapped and transition addresses', async () => {
  for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.31.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001::1', '2002:0808:0808::1', '3fff::1']) assert.equal(isPublicAddress(ip), false, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicAddress(ip), true, ip)
  for (const url of ['ftp://example.com', 'https://user:pass@example.com', 'https://example.com:8080']) assert.throws(() => publicPricingUrl(url))
  assert.equal(publicPricingUrl('https://example.com/base?secret=x#h').href, 'https://example.com/api/pricing')
  await assert.rejects(fetchPublicPricing(new URL('http://127.0.0.1/api/pricing')))
  await assert.rejects(fetchPublicPricing(new URL('http://[::ffff:127.0.0.1]/api/pricing')))
})
function fixture() {
  const calls: { sql: string; values: unknown[] }[] = []
  let groupAttempt: Date | null = null
  let groupSnapshot: Record<string, unknown> | undefined
  let owned = true, enabled = false, revision = 0, platform = 'new-api', attempted: Date | null = null, synced: Date | null = null, error: unknown = null, quotes: unknown[] = [], upstream: unknown = payload, fetched = 0, failInsert = false
  const record = (sql: string, values: unknown[] = []) => { calls.push({ sql, values }) }
  const get = async (sql: string, values: unknown[] = []) => {
    record(sql, values)
    if (sql.includes('FROM site_group_fetches')) return groupAttempt ? { website: 'https://example.com', attemptedAt: groupAttempt } : undefined
    if (sql.includes('FROM site_group_snapshots')) return groupSnapshot
    if (sql.includes('FROM submissions')) return owned ? { id: 1, website: 'https://example.com' } : undefined
    return { enabled: Number(enabled), platform, revision, lastAttemptAt: attempted, syncedAt: synced, errorCode: error, unsupportedCount: 0 }
  }
  const run = async (sql: string, values: unknown[] = []) => {
    record(sql, values)
    if (sql.startsWith('INSERT INTO site_group_fetches')) groupAttempt = new Date()
    if (sql.startsWith('INSERT INTO site_group_snapshots')) groupSnapshot = { groupsJson: values[2], detectedAt: values[3], source: values[4] }
    if (sql.startsWith('INSERT INTO site_pricing_settings')) { enabled = Boolean(values[1]); platform = String(values[2]); revision++ }
    if (sql.includes('last_attempt_at = CURRENT_TIMESTAMP')) { attempted = new Date(); revision++ }
    if (sql.startsWith('DELETE FROM site_public_quotes')) quotes = []
    if (sql.startsWith('INSERT INTO site_public_quotes')) { if (failInsert) throw Error('private sql credentials'); quotes.push({ id: 'sync-1', modelId: values[1], syncedAt: new Date() }) }
    if (sql.includes('SET synced_at')) { synced = new Date(); error = null }
    if (sql.includes('SET error_code')) error = values[0]
    return { affectedRows: 1 }
  }
  const db = { get, run, prepare: (sql: string) => ({ get: (...v: unknown[]) => get(sql, v), run: (...v: unknown[]) => run(sql, v), all: async (...v: unknown[]) => { record(sql, v); return quotes } }), transaction: async (fn: (connection: unknown) => Promise<unknown>) => { const saved = [...quotes]; try { return await fn({}) } catch (e) { quotes = saved; throw e } } } as unknown as Database
  const request = async (method = 'GET', body = {}, options: { signedIn?: boolean; local?: number | null; origin?: string; sync?: boolean; groups?: boolean } = {}) => {
    let status = 0, result: any
    await handlePublicPricing({ database: db, request: { method, headers: { host: 'localhost', origin: options.origin ?? 'http://localhost' }, socket: {} } as unknown as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL(`http://localhost/api/user/sites/1/${options.groups ? 'groups' : 'pricing'}${options.sync ? '/sync' : ''}`), user: options.signedIn === false ? null : { id: 'oauth-id', login: 'owner', html_url: '' }, localUserId: options.local ?? null, readJson: async () => body, json: (_r, s, p) => { status = s; result = p }, fetchPricing: async () => { fetched++; if (upstream instanceof Error) throw upstream; return upstream } })
    return { status, body: result }
  }
  return { db, calls, request, setOwned: (v: boolean) => { owned = v }, setUpstream: (v: unknown) => { upstream = v }, resetThrottle: () => { attempted = null }, failInsert: () => { failInsert = true }, fetched: () => fetched }
}
test('local/OAuth ownership, strict consent default-off and origin checks precede network', async () => {
  const f = fixture()
  assert.equal((await f.request('GET', {}, { signedIn: false })).status, 401)
  const first = await f.request()
  assert.equal(first.body.settings.enabled, false)
  assert.equal(first.body.sync.stale, true)
  assert.equal(f.calls[0].values[1], 'google:oauth-id')
  assert.match(f.calls[0].sql, /BINARY s.owner_identity = BINARY/)
  await f.request('GET', {}, { local: 7 })
  assert.ok(f.calls.some(c => c.values[1] === 'local:7'))
  assert.equal((await f.request('POST', {}, { sync: true })).status, 409)
  assert.equal((await f.request('PATCH', { enabled: 'true', platform: 'new-api' })).status, 400)
  assert.equal((await f.request('PATCH', { enabled: true, platform: 'new-api' }, { origin: 'https://evil.test' })).status, 403)
  f.setOwned(false)
  assert.equal((await f.request('PATCH', { enabled: true, platform: 'new-api' })).status, 404)
  assert.equal(f.fetched(), 0)
  assert.ok(f.calls.every(c => !/credential|probe_|authorization/.test(c.sql)))
})
test('sync snapshots replace atomically, throttle and retain last successful quotes on failures', async () => {
  const f = fixture()
  await f.request('PATCH', { enabled: true, platform: 'new-api' })
  assert.equal((await f.request('POST', {}, { sync: true })).status, 200)
  const success = await f.request()
  assert.equal(success.body.quotes.length, 1)
  const insert = f.calls.find(call => call.sql.startsWith('INSERT INTO site_public_quotes'))!
  assert.match(insert.sql, /cache_read_price/)
  assert.match(insert.sql, /group_multiplier/)
  assert.equal(insert.values[7], null)
  assert.equal(insert.values[9], 0.5)
  assert.equal(success.body.sync.stale, false)
  assert.equal((await f.request('POST', {}, { sync: true })).status, 429)
  assert.equal(f.fetched(), 1)
  f.resetThrottle(); f.setUpstream(Error('SECRET upstream response'))
  const failure = await f.request('POST', {}, { sync: true })
  assert.equal(failure.status, 422)
  assert.equal(failure.body.quotes.length, 1)
  assert.doesNotMatch(JSON.stringify(failure), /SECRET/)
  f.resetThrottle(); f.setUpstream({ data: [], group_ratio: {} })
  assert.equal((await f.request('POST', {}, { sync: true })).body.quotes.length, 1)
  f.resetThrottle(); f.setUpstream(payload); f.failInsert()
  assert.equal((await f.request('POST', {}, { sync: true })).body.quotes.length, 1)
})
test('Sub2API cache-read prices are persisted with the group multiplier', async () => {
  const f = fixture()
  await f.request('PATCH', { enabled: true, platform: 'sub2api' })
  f.setUpstream({ code: 0, data: { groups: [{ name: 'standard', rate_multiplier: 0.5, models: [{ name: 'Exact-Model', pricing: { billing_mode: 'token', input_price: 0.000002, output_price: 0.000008, cache_read_price: 0.000001 } }] }] } })
  assert.equal((await f.request('POST', {}, { sync: true })).status, 200)
  const insert = f.calls.find(call => call.sql.startsWith('INSERT INTO site_public_quotes'))!
  assert.equal(insert.values[7], '0.50000000')
})
test('public projection is exact, public-only, opted-in active and credential independent', async () => {
  const f = fixture()
  await publicComparisonQuotes(f.db, 'Exact-Model')
  const call = f.calls[0]
  assert.match(call.sql, /BINARY q.model_id = BINARY \?/)
  assert.ok(call.sql.includes("CONCAT('managed-', p.id) AS providerId"))
  assert.match(call.sql, /COALESCE\(q.group_multiplier, gm.multiplier\) AS groupMultiplier/)
  assert.match(call.sql, /BINARY gm.group_name = BINARY q.group_name/)
  assert.match(call.sql, /BINARY gm.website = BINARY s.website/)
  for (const text of ["s.status = 'approved'", 's.directory_listed = 1', 'p.active = 1', 'ps.enabled = 1', "'public-interface'", "'reference'", "CONCAT('sync-'", 'q.synced_at AS syncedAt']) assert.ok(call.sql.includes(text), text)
  assert.doesNotMatch(call.sql, /credential|user_id|owner_identity|error_code/)
  assert.deepEqual(call.values, ['Exact-Model'])
})

test('owner group sync works without quote opt-in, stores snapshot and throttles repeated attempts', async () => {
  const f = fixture()
  const sync = { groups: true, sync: true }
  assert.equal((await f.request('POST', {}, { ...sync, signedIn: false })).status, 401)
  assert.equal((await f.request('POST', {}, { ...sync, origin: 'https://evil.test' })).status, 403)
  f.setOwned(false)
  assert.equal((await f.request('POST', {}, sync)).status, 404)
  f.setOwned(true)
  assert.equal((await f.request('GET', {}, { groups: true })).body.detectedAt, null)
  const saved = await f.request('POST', {}, sync)
  assert.equal(saved.status, 200)
  assert.ok(saved.body.groups.length > 0)
  assert.ok(saved.body.detectedAt)
  assert.equal(f.fetched(), 1)
  assert.equal((await f.request('POST', {}, sync)).status, 429)
  assert.equal(f.fetched(), 1)
  assert.ok(f.calls.every(c => !/^(DELETE FROM|INSERT INTO|UPDATE) site_public_quotes/.test(c.sql)))
  assert.equal((await f.request()).body.settings.enabled, false)
})

test('failed group sync hides upstream errors and does not overwrite snapshot or prices', async () => {
  const f = fixture()
  f.setUpstream(Error('SECRET upstream details'))
  const result = await f.request('POST', {}, { groups: true, sync: true })
  assert.equal(result.status, 422)
  assert.doesNotMatch(JSON.stringify(result), /SECRET/)
  assert.ok(f.calls.every(c => !/^(DELETE FROM|INSERT INTO|UPDATE) site_(public_quotes|public_groups|group_snapshots)/.test(c.sql)))
  assert.equal((await f.request('POST', {}, { groups: true, sync: true })).status, 429)
})
