import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createAdminModelPrice, validateManualModel, editAdminModelPrice, listAdminModelPrices, priceIdentity, validatePriceOverride } from './admin-model-prices.ts'
import { EFFECTIVE_PRICE_ROWS, PRICE_SELECT } from './price-store.ts'
import type { Database } from './mysql.ts'

const identity = { sourceId: 'manual', providerId: 'OpenAI', modelId: 'Model-Exact' }
const body = { ...identity, inputPrice: null, outputPrice: 0, cacheReadPrice: 0.25, releaseDate: '2024-02-29', sourceName: 'Official documentation', sourceUrl: 'https://example.com/pricing' }
function fixture(missing = false, failAudit = false) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const connection = {}
  let rollback = false
  const db = {
    get: async (sql: string, values: unknown[], executor: unknown) => {
      assert.equal(executor, connection)
      calls.push({ sql, values })
      return sql.includes('FROM model_prices ') ? missing ? undefined : { ...identity, input_price: 9 } : { input_price: 3 }
    },
    run: async (sql: string, values: unknown[], executor: unknown) => {
      assert.equal(executor, connection)
      calls.push({ sql, values })
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable')
    },
    transaction: async (operation: (connection: unknown) => unknown) => {
      try { return await operation(connection) } catch (error) { rollback = true; throw error }
    },
  } as unknown as Database
  return { db, calls, rollback: () => rollback }
}

test('validation preserves explicit unknown, free pricing, leap day and exact identity', () => {
  assert.deepEqual(priceIdentity(body), ['manual', 'OpenAI', 'Model-Exact'])
  assert.deepEqual(validatePriceOverride(body), { inputPrice: null, outputPrice: 0, cacheReadPrice: 0.25, releaseDate: '2024-02-29', sourceName: body.sourceName, sourceUrl: body.sourceUrl })
  assert.equal(validatePriceOverride({ ...body, releaseDate: null }).releaseDate, null)
})

test('invalid prices, fake dates and unsupported provenance are rejected', () => {
  for (const inputPrice of [-1, Infinity, NaN, '1', '', undefined, {}, true]) assert.throws(() => validatePriceOverride({ ...body, inputPrice }))
  for (const releaseDate of ['2025-02-29', '2024-04-31', '2024-13-01', '2024-2-01', '', '0000-01-01', '2024-01-01T00:00:00Z', 0]) assert.throws(() => validatePriceOverride({ ...body, releaseDate }))
  for (const sourceUrl of ['javascript:alert(1)', 'file:///secret', 'https://name:pass@example.com', '/pricing', 'https://example.com/\n']) assert.throws(() => validatePriceOverride({ ...body, sourceUrl }))
  for (const sourceName of ['', ' ', 'x'.repeat(256), 'name\nspoof', null]) assert.throws(() => validatePriceOverride({ ...body, sourceName }))
  assert.throws(() => priceIdentity({ ...identity, modelId: '' }))
})

test('save writes only independent override, uses exact locked identity and audits atomically', async () => {
  const f = fixture()
  assert.equal((await editAdminModelPrice(f.db, body, 7)).status, 200)
  assert.match(f.calls[0].sql, /BINARY source_id = BINARY \?.*BINARY model_id = BINARY \? FOR UPDATE/)
  assert.deepEqual(f.calls[0].values, Object.values(identity))
  const write = f.calls.find(call => call.sql.startsWith('INSERT INTO model_price_overrides'))!
  assert.deepEqual(write.values, [...Object.values(identity), null, 0, 0.25, '2024-02-29', body.sourceUrl, body.sourceName, 7])
  assert.equal(f.calls.some(call => /^(UPDATE|DELETE FROM) model_prices\b/.test(call.sql)), false)
  const audit = f.calls.at(-1)!
  assert.match(audit.sql, /INSERT INTO audit_logs/)
  assert.equal(audit.values[1], 'model-price.override')
  assert.deepEqual(JSON.parse(String(audit.values[4])).before, { input_price: 3 })
})

test('reset deletes the override only; latest source snapshot remains intact', async () => {
  const f = fixture()
  assert.equal((await editAdminModelPrice(f.db, identity, 7, true)).status, 200)
  assert.match(f.calls[2].sql, /^DELETE FROM model_price_overrides/)
  assert.deepEqual(f.calls[2].values, Object.values(identity))
  assert.equal(f.calls.at(-1)!.values[1], 'model-price.reset')
  assert.equal(JSON.parse(String(f.calls.at(-1)!.values[4])).after, null)
})

test('missing models and invalid bodies do not create records; audit failures roll back', async () => {
  const f = fixture(true)
  assert.equal((await editAdminModelPrice(f.db, body, 7)).status, 404)
  assert.equal(f.calls.length, 1)
  const bad = fixture()
  await assert.rejects(editAdminModelPrice(bad.db, { ...body, outputPrice: -1 }, 7))
  assert.equal(bad.calls.length, 0)
  const fail = fixture(false, true)
  await assert.rejects(editAdminModelPrice(fail.db, body, 7), /audit unavailable/)
  assert.equal(fail.rollback(), true)
})

test('search is parameterized and pagination is bounded and stable', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db = { get: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return { total: 51 } }, all: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return [] } } as unknown as Database
  const result = await listAdminModelPrices(db, new URLSearchParams({ q: "%' OR 1=1", page: '2', pageSize: '25' }))
  assert.equal(result.total, 51)
  assert.match(calls[1].sql, /ORDER BY release_date IS NULL, release_date DESC, provider_name, name, BINARY source_id, BINARY provider_id, BINARY model_id LIMIT 25 OFFSET 25/)
  assert.equal(calls[1].sql.includes("%' OR 1=1"), false)
  assert.deepEqual(calls[1].values, ["%' OR 1=1", "%' OR 1=1"])
  for (const params of [{ page: '0' }, { page: '1.5' }, { pageSize: '101' }, { pageSize: '0' }, { q: 'a'.repeat(201) }]) await assert.rejects(listAdminModelPrices(db, new URLSearchParams(params)))
})

test('effective reads honor null overrides and both replace-all sync paths leave overrides alone', () => {
  assert.match(EFFECTIVE_PRICE_ROWS, /IF\(o.model_id IS NULL, p.input_price, o.input_price\)/)
  assert.match(EFFECTIVE_PRICE_ROWS, /IF\(o.model_id IS NULL, p.release_date, o.release_date\)/)
  assert.match(EFFECTIVE_PRICE_ROWS, /BINARY p.source_id = BINARY o.source_id.*BINARY p.provider_id = BINARY o.provider_id.*BINARY p.model_id = BINARY o.model_id/)
  assert.match(PRICE_SELECT, /LEFT JOIN model_price_overrides/)
  for (const file of ['../scripts/sync-model-prices.ts', './price-import.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /(?:DELETE FROM|UPDATE|REPLACE INTO|INSERT INTO) model_price_overrides/)
  }
  const schema = readFileSync(new URL('./mysql.ts', import.meta.url), 'utf8')
  assert.match(schema, /model_price_overrides \(source_id VARBINARY\(400\).*provider_id VARBINARY\(400\).*model_id VARBINARY\(764\)/)
})

test('admin route stays behind shared administrator MFA and origin guards', () => {
  const backend = readFileSync(new URL('./backend.ts', import.meta.url), 'utf8')
  const route = backend.indexOf("if (url.pathname === '/api/admin/model-prices')")
  assert.ok(route > backend.indexOf("if (user.role !== 'admin')"))
  assert.ok(route > backend.indexOf('管理员操作需要 MFA 验证'))
  const originGuard = backend.indexOf('!validWriteOrigin(')
  assert.ok(originGuard >= 0)
  assert.match(backend.slice(originGuard), /CSRF_ORIGIN_REJECTED[\s\S]*await auth\.handle\(/)
  const authenticatedGuard = backend.indexOf("if (!user) return json(response, 401", backend.indexOf("if (url.pathname.startsWith('/api/admin/'))"))
  assert.ok(authenticatedGuard >= 0 && route > authenticatedGuard)
  assert.match(backend.slice(backend.indexOf("if (url.pathname.startsWith('/api/admin/'))"), route), /SELECT id FROM users WHERE username = \? AND role/)
  assert.match(backend.slice(0, route), /writes && Date.now\(\) - session.mfaVerifiedAt >= MFA_RECENT_MS/)
})


test('manual creation persists real identity, nullable pricing, billing and audited provenance atomically', async () => {
  const f = fixture(true)
  const input = { ...body, providerId: 'openai', modelId: 'gpt-real-api-id', name: 'Real model', providerName: 'OpenAI', billingUnit: '百万 Tokens', modality: 'text' }
  assert.equal((await createAdminModelPrice(f.db, input, 7)).status, 201)
  const insert = f.calls.find(call => call.sql.startsWith('INSERT INTO model_prices'))!
  assert.deepEqual(insert.values.slice(0, 6), ['manual', 'openai', 'gpt-real-api-id', 'gpt-real-api-id', 'Real model', 'OpenAI'])
  assert.deepEqual(insert.values.slice(9, 12), [null, 0, 0.25])
  assert.deepEqual(insert.values.slice(15, 17), ['text', '百万 Tokens'])
  assert.equal(f.calls.at(-1)!.values[1], 'model-price.create')
  assert.equal((await createAdminModelPrice(fixture().db, input, 7)).status, 409)
  const failure = fixture(true, true)
  await assert.rejects(createAdminModelPrice(failure.db, input, 7), /audit unavailable/)
  assert.equal(failure.rollback(), true)
  for (const patch of [{ sourceId: 'ranking' }, { providerId: ' fake ' }, { modelId: 'not an api id' }, { modelId: 'ranking:leaderboard-slug' }, { name: '' }, { providerName: '' }, { billingUnit: '' }, { modality: 'invalid' }, { reasoning: 'yes' }]) assert.throws(() => validateManualModel({ ...input, ...patch }))
})

test('ranking synchronization has no pricing writes or pricing persistence dependency', () => {
  const backend = readFileSync(new URL('./backend.ts', import.meta.url), 'utf8')
  const sync = backend.slice(backend.indexOf('const syncModelRankings ='), backend.indexOf('const mfa ='))
  const script = readFileSync(new URL('../scripts/sync-model-rankings.ts', import.meta.url), 'utf8')
  for (const source of [sync, script]) {
    assert.match(source, /INSERT INTO model_rankings/)
    assert.doesNotMatch(source, /model_prices|model_price_overrides|persistRankingPrices|ranking-prices/)
  }
  assert.match(PRICE_SELECT, /'official', 'curated', 'manual'/)
  assert.doesNotMatch(PRICE_SELECT, /'ranking'/)
  assert.throws(() => priceIdentity({ ...identity, sourceId: 'ranking' }))
})
