import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Database } from './mysql.ts'
import { cacheProbedGroups, fillMissingPublicGroups, parsePublicGroups, storePublicGroups } from './public-groups.ts'
import { publicComparisonQuotes, publicPricingUrl } from './public-pricing.ts'

const payload = { success: true, group_ratio: { Standard: 0, standard: 0.5, invalid: -1, text: '1', nan: NaN }, data: [{ enable_groups: ['standard', 'standard'] }], usable_group: { standard: 'description' }, user_groups: { Standard: true } }
test('group parser preserves exact names, zero, metadata and rejects invalid multipliers', () => {
  const groups = parsePublicGroups(payload)
  assert.equal(groups.length, 2)
  assert.equal(groups.find(g => g.name === 'Standard')?.ratio, 0)
  assert.equal(groups.find(g => g.name === 'standard')?.modelCount, 1)
  assert.equal(groups.find(g => g.name === 'standard')?.description, 'description')
  assert.throws(() => parsePublicGroups({ ...payload, success: false }))
  const sub = { code: 0, data: { groups: [{ name: 'a', rate_multiplier: 0.3, models: [] }, { name: 'b', rate_multiplier: 1, peak_rate_enabled: true }] } }
  assert.deepEqual(parsePublicGroups(sub, 'sub2api').map(g => g.name), ['a'])
  assert.throws(() => parsePublicGroups({ code: 0, data: { groups: [sub.data.groups[0], sub.data.groups[0]] } }, 'sub2api'))
})

function fixture(attemptedAt?: Date) {
  const calls: { sql: string; values: unknown[] }[] = []
  const cached = new Map<string, { ratio: number; date: Date; source: string }>()
  let attempt: { website: unknown; attemptedAt: Date } | undefined = attemptedAt ? { website: 'https://example.com/', attemptedAt } : undefined
  const website = 'https://example.com/'
  const db = {
    transaction: async (fn: (c: unknown) => unknown) => fn({}),
    get: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values })
      if (sql.includes('site_group_fetches')) return attempt
      if (sql.includes('MAX(detected_at)')) return { detectedAt: [...cached.values()][0]?.date }
      return { id: 1 }
    },
    run: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values })
      if (sql.startsWith('DELETE FROM site_public_groups')) cached.clear()
      if (sql.startsWith('INSERT INTO site_public_groups')) cached.set(String(values[2]), { ratio: Number(values[3]), date: values[4] as Date, source: String(values[5]) })
      if (sql.startsWith('INSERT INTO site_group_fetches')) attempt = { website: values[1], attemptedAt: new Date() }
      return { affectedRows: 1 }
    },
    prepare: (sql: string) => ({ all: async (...values: unknown[]) => {
      calls.push({ sql, values })
      if (!sql.includes('FROM site_public_quotes')) return [{ id: 1, website }]
      return ['standard', 'Standard', 'STANDARD'].map((groupName, index) => {
        const stored = cached.get(groupName)
        return { id: index, siteId: 1, website, platform: 'new-api', groupName, inputPrice: '2.00000000', syncedAt: '2020-01-01T00:00:00Z', groupMultiplier: index === 1 ? 9 : stored?.ratio ?? null, groupMultiplierDetectedAt: index === 1 ? '2020-01-01T00:00:00Z' : stored?.date, groupMultiplierSource: index === 1 ? 'price-snapshot' : stored ? 'group-probe' : null }
      })
    } }),
  } as unknown as Database
  return { db, calls, cached, website }
}

test('comparison only reads cached groups and never fetches or rewrites prices', async () => {
  const f = fixture()
  await storePublicGroups(f.db, 1, f.website, new URL('https://example.com/api/pricing'), parsePublicGroups(payload), new Date())
  f.calls.length = 0
  const rows = await publicComparisonQuotes(f.db, 'Exact')
  assert.equal(rows[0].groupMultiplier, 0.5)
  assert.equal(rows[0].groupMultiplierSource, 'group-probe')
  assert.ok(rows[0].groupMultiplierDetectedAt instanceof Date)
  assert.equal(rows[0].syncedAt, '2020-01-01T00:00:00Z')
  assert.equal(rows[0].inputPrice, '2.00000000')
  assert.equal(rows[1].groupMultiplier, 9)
  assert.equal(rows[1].groupMultiplierSource, 'price-snapshot')
  assert.equal(rows[2].groupMultiplier, null)
  await publicComparisonQuotes(f.db, 'Exact')
  assert.ok(f.calls.every(c => c.sql.startsWith('SELECT')))
})

test('listed-site probe caches exact origin only and older responses cannot replace newer groups', async () => {
  const f = fixture(), groups = parsePublicGroups(payload)
  await cacheProbedGroups(f.db, new URL('https://unrelated.example/api/pricing'), groups, new Date())
  assert.equal(f.cached.size, 0)
  await cacheProbedGroups(f.db, new URL('https://example.com/api/pricing'), groups, new Date('2026-10-29'))
  assert.equal(f.cached.size, 2)
  await storePublicGroups(f.db, 1, f.website, new URL('https://example.com/api/pricing'), [], new Date('2020-01-01'))
  assert.equal(f.cached.size, 2)
  await assert.rejects(storePublicGroups(f.db, 1, f.website, new URL('https://wrong.example/api/pricing'), groups, new Date()))
})

test('failed automatic fetch is throttled, preserves old prices, and is bounded per comparison', async () => {
  const f = fixture(); let fetched = 0
  const fail = async () => { fetched++; throw Error('unavailable') }
  const rows = await publicComparisonQuotes(f.db, 'Exact')
  assert.equal(rows[0].groupMultiplier, null)
  assert.equal(rows[0].inputPrice, '2.00000000')
  assert.equal(fetched, 0)
  await fillMissingPublicGroups(f.db, [{ siteId: 1, website: f.website }], fail, publicPricingUrl)
  await fillMissingPublicGroups(f.db, [{ siteId: 1, website: f.website }], fail, publicPricingUrl)
  assert.equal(fetched, 1)
  const other = fixture(); fetched = 0
  await fillMissingPublicGroups(other.db, Array.from({ length: 20 }, (_, i) => ({ siteId: i + 1, website: `https://example${i}.com` })), fail, publicPricingUrl)
  assert.equal(fetched, 4)
})

test('background attempts are throttled for a full day, including failed attempts', async () => {
  let fetched = 0
  const fetcher = async () => { fetched++; throw Error('offline') }
  const recent = fixture(new Date(Date.now() - 23 * 3600000))
  await fillMissingPublicGroups(recent.db, [{ siteId: 1, website: recent.website }], fetcher, publicPricingUrl)
  assert.equal(fetched, 0)
  const expired = fixture(new Date(Date.now() - 25 * 3600000))
  await fillMissingPublicGroups(expired.db, [{ siteId: 1, website: expired.website }], fetcher, publicPricingUrl)
  assert.equal(fetched, 1)
  await fillMissingPublicGroups(expired.db, [{ siteId: 1, website: expired.website }], fetcher, publicPricingUrl)
  assert.equal(fetched, 1)
})
