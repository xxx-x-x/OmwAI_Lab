import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { initializeDatabase, type Database } from './mysql.ts'
import { analyticsRange, conversionRate, createAnalyticsCollector, createAnalyticsLimiter, getAnalyticsDashboard, normalizeAnalyticsPath, validateAnalyticsEvent } from './analytics.ts'

const event = { eventId: 'a5aff74e-f579-43d2-9d41-e8988596f14b', visitorId: 'b5aff74e-f579-43d2-9d41-e8988596f14b', sessionId: 'c5aff74e-f579-43d2-9d41-e8988596f14b', kind: 'pageview', path: '/' }

test('strict schemas reject personal fields, invalid IDs, private paths and inconsistent providers', () => {
  for (const change of [{ email: 'private@example.org' }, { url: 'https://secret.test' }, { visitorId: 'anything' }, { kind: 'login' }, { path: '/admin' }, { path: '/login?email=private' }, { path: '//evil.test' }, { path: '/provider/managed-2', providerId: 'managed-1' }, { kind: 'outbound_click' }, { providerId: 'managed-0' }, { path: '/site-management/sites/123' }]) assert.throws(() => validateAnalyticsEvent({ ...event, ...change }))
  assert.throws(() => validateAnalyticsEvent([]))
  assert.equal(validateAnalyticsEvent({ ...event, kind: 'outbound_intent', providerId: 'managed-1' }).kind, 'outbound_intent')
  assert.equal(validateAnalyticsEvent({ ...event, path: '/pricing/model?model=private#token' }).path, '/pricing/model')
  assert.equal(validateAnalyticsEvent({ ...event, path: '/provider/managed-2' }).providerId, 'managed-2')
  assert.equal(normalizeAnalyticsPath('/directory/'), '/')
  assert.equal(normalizeAnalyticsPath('/site-management?secret=value'), '/site-management')
})

test('Shanghai calendar ranges handle UTC boundaries, leap dates and empty denominators', () => {
  const now = new Date('2024-03-01T00:01:00+08:00')
  const yesterday = analyticsRange('yesterday', now)
  assert.equal(yesterday.startDate, '2024-02-29')
  assert.equal(yesterday.endDate, '2024-02-29')
  assert.equal(new Date(yesterday.start).toISOString(), '2024-02-28T16:00:00.000Z')
  assert.equal(analyticsRange(null, now).dates.length, 7)
  assert.equal(analyticsRange('30d', now).dates.length, 30)
  assert.equal(analyticsRange('today', now).startDate, '2024-03-01')
  assert.throws(() => analyticsRange('all'))
  assert.equal(conversionRate(0, 0), null)
  assert.equal(conversionRate(4, 1), 0.25)
  assert.equal(conversionRate(1, 2), 1)
})

test('bounded rate limiter expires windows and refuses capacity exhaustion', () => {
  const allow = createAnalyticsLimiter(2, 100, 1)
  assert.equal(allow('ip', 0), true)
  assert.equal(allow('ip', 1), true)
  assert.equal(allow('ip', 2), false)
  assert.equal(allow('other', 3), false)
  assert.equal(allow('other', 100), true)
})

function request(body: string, headers: Record<string, string> = {}) {
  return Object.assign(Readable.from([Buffer.from(body)]), { method: 'POST', headers: { origin: 'https://lab.test', 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', ...headers }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage
}
const response = () => ({ setHeader() {} }) as unknown as ServerResponse

test('collector verifies origin, method, content type, streamed byte limit, bots before storage', async () => {
  let writes = 0, ready = 0, status = 0
  const db = { prepare: (sql: string) => ({ run: async () => { if (sql.startsWith('INSERT')) writes++; return { affectedRows: 1 } } }) } as unknown as Database
  const collect = createAnalyticsCollector(db, 'https://lab.test', false, async () => { ready++ })
  const send = (_res: ServerResponse, code: number) => { status = code }
  for (const [req, expected] of [
    [request(JSON.stringify(event), { origin: 'https://evil.test' }), 403],
    [request(JSON.stringify(event), { 'sec-fetch-site': 'cross-site' }), 403],
    [Object.assign(request('{}'), { method: 'GET' }), 405],
    [request('{}', { 'content-type': 'text/plain' }), 415],
    [request('x'.repeat(4100)), 413],
    [request('{}', { 'content-length': '4100' }), 413],
    [request('{}', { 'content-encoding': 'gzip' }), 415],
    [request('{'), 400],
    [request(JSON.stringify(event), { 'user-agent': 'Googlebot' }), 202],
  ] as const) {
    await collect(req, response(), send)
    assert.equal(status, expected)
  }
  assert.equal(writes, 0); assert.equal(ready, 0)
  await collect(request(JSON.stringify(event)), response(), send)
  assert.equal(status, 202); assert.equal(writes, 1); assert.equal(ready, 1)
})

test('collector applies a persistent visitor window and does not write excess requests', async () => {
  let writes = 0, status = 0
  const collect = createAnalyticsCollector({ prepare: (sql: string) => ({ run: async () => { if (sql.startsWith('INSERT')) writes++ } }) } as unknown as Database, 'https://lab.test')
  for (let i = 0; i < 61; i++) await collect(request(JSON.stringify(event)), response(), (_res, code) => { status = code })
  assert.equal(status, 429)
  assert.equal(writes, 60)
})

test('collector deduplicates through event primary key and stores only normalized fields with server UTC time', async () => {
  let sql = '', values: unknown[] = [], status = 0
  const collect = createAnalyticsCollector({ prepare: (query: string) => ({ get: async () => ({ id: 1 }), run: async (...args: unknown[]) => { sql = query; values = args } }) } as unknown as Database, 'https://lab.test')
  await collect(request(JSON.stringify({ ...event, path: '/provider/managed-1?api_key=secret', providerId: 'managed-1' })), response(), (_res, code) => { status = code })
  assert.equal(status, 202)
  assert.match(sql, /UTC_TIMESTAMP\(3\)/)
  assert.match(sql, /ON DUPLICATE KEY UPDATE event_id = event_id/)
  assert.deepEqual(values, [event.eventId, event.visitorId, event.sessionId, 'pageview', '/provider/managed-1', 'managed-1'])
})

test('request-driven retention deletes bounded indexed batches, is throttled and tolerates cleanup failure', async () => {
  const queries: string[] = []; let status = 0
  const collect = createAnalyticsCollector({ prepare: (sql: string) => ({ run: async () => {
    queries.push(sql)
    if (sql.startsWith('DELETE')) throw new Error('cleanup unavailable')
    return { affectedRows: 1 }
  } }) } as unknown as Database, 'https://lab.test')
  for (let i = 0; i < 2; i++) await collect(request(JSON.stringify(event)), response(), (_res, code) => { status = code })
  assert.equal(status, 202)
  assert.equal(queries.filter(sql => sql.startsWith('DELETE')).length, 1)
  assert.equal(queries.filter(sql => sql.startsWith('INSERT')).length, 2)
  assert.match(queries[0], /created_at < UTC_TIMESTAMP\(3\) - INTERVAL 90 DAY ORDER BY created_at LIMIT 1000/)
})

test('collector rejects unpublished providers and reports database errors without leaking details', async () => {
  let status = 0
  const collect = createAnalyticsCollector({ prepare: () => ({ get: async () => undefined, run: async () => ({}) }) } as unknown as Database, 'https://lab.test')
  await collect(request(JSON.stringify({ ...event, providerId: 'managed-1' })), response(), (_res, code) => { status = code })
  assert.equal(status, 400)
  const unavailable = createAnalyticsCollector({} as Database, 'https://lab.test', false, async () => { throw new Error('password=secret') })
  await unavailable(request(JSON.stringify(event)), response(), (_res, code, payload) => { status = code; assert.ok(!JSON.stringify(payload).includes('secret')) })
  assert.equal(status, 503)
})

test('dashboard aggregates active review queues without historical quotes, distinct visitors, zero-filled dates and local accounts', async () => {
  const queries: string[] = []
  const db = { prepare: (sql: string) => {
    queries.push(sql)
    return {
      get: async () => {
        if (sql.includes('AS pending,')) return { pending: 700, providers: 600, users: 550, logs: 900 }
        if (sql.includes('FROM analytics_events')) return { pv: '8', uv: '4', outboundClicks: '3', outboundVisitors: '3', convertedVisitors: '2' }
        if (sql.includes('AS newUsers')) return { newUsers: '3', newSubmissions: '2', publicProviders: '4', localUsers: '550' }
        if (sql.includes('pending_items')) return { submissions: 700, revisions: 2, oldestEpoch: 1700000000, overdue: 3 }
        if (sql.includes('analytics_metadata')) return { collectedSince: '2026-10-28T00:00:00.000Z' }
        return { rankingModels: 601, priceModels: 800, pricingFailures: 2, rankingEpoch: 1700000000 }
      },
      all: async () => {
        if (sql.includes('GROUP BY date')) return [{ date: '2026-10-29', pv: 8, uv: 4, outboundClicks: 3 }]
        if (sql.includes('GROUP BY e.provider_id')) return [{ id: 'managed-1', name: 'One', views: 4, visitors: 3, outboundClicks: 3, outboundVisitors: 3, convertedVisitors: 2 }]
        if (sql.includes('GROUP BY path')) return [{ path: '/', pv: 4, uv: 3 }]
        return [{ id: 1, action: 'review', admin_name: 'admin', createdEpoch: 1700000000 }]
      },
    }
  } } as unknown as Database
  const result = await getAnalyticsDashboard(db, null, new Date('2026-10-29T01:00:00Z'))
  assert.equal(result.counts.users, 550)
  assert.equal(result.analytics.totals.conversionRate, 0.5)
  assert.equal(result.analytics.totals.localUsers, 550)
  assert.equal(result.analytics.trend.length, 7)
  assert.equal(result.analytics.trend[0].pv, 0)
  assert.equal(result.analytics.trend[6].pv, 8)
  assert.equal(result.analytics.pending.submissions, 700)
  assert.equal(result.analytics.pending.overdue, 3)
  assert.equal(result.analytics.topProviders[0].conversionRate, 2 / 3)
  assert.equal(result.analytics.health.rankingModels, 601)
  assert.equal(result.analytics.recentLogs[0].created_at, '2023-11-14T22:13:20.000Z')
  const pending = queries.find(sql => sql.includes('pending_items'))!
  assert.ok(pending.includes('FROM submissions'))
  assert.ok(pending.includes('FROM site_revisions'))
  assert.ok(!pending.includes('group_authorization'))
  assert.ok(!('quotes' in result.analytics.pending))
  assert.ok(queries.some(sql => sql.includes("p.active = 1 AND s.status = 'approved' AND s.directory_listed = 1")))
  const eventTotals = queries.find(sql => sql.includes('FROM analytics_events e WHERE') && !sql.includes('GROUP BY'))!
  assert.match(eventTotals, /COUNT\(DISTINCT CASE WHEN kind = 'pageview' THEN visitor_id END\) AS uv/)
  assert.match(eventTotals, /viewed\.created_at >= \? AND viewed\.created_at < \? AND viewed\.created_at < e\.created_at/)
  assert.match(eventTotals, /viewed\.kind = 'pageview' AND viewed\.visitor_id = e\.visitor_id/)
  assert.ok(!eventTotals.includes('viewed.provider_id = e.provider_id'))
  assert.match(eventTotals, /COUNT\(DISTINCT CASE WHEN kind = 'outbound_click' THEN visitor_id END\) AS outboundVisitors/)
  assert.match(eventTotals, /created_at >= \? AND created_at < \?/)
  const providerTotals = queries.find(sql => sql.includes('GROUP BY e.provider_id'))!
  assert.match(providerTotals, /COUNT\(DISTINCT CASE WHEN e.kind = 'pageview' THEN e.visitor_id END\) AS visitors/)
  assert.ok(providerTotals.includes('viewed.provider_id = e.provider_id'))
  assert.match(providerTotals, /viewed\.created_at < e\.created_at/)
  const daily = queries.find(sql => sql.includes('GROUP BY date'))!
  assert.match(daily, /COUNT\(DISTINCT CASE WHEN kind = 'pageview' THEN visitor_id END\) AS uv/)
  assert.equal(result.analytics.totals.outboundVisitors, 3)
  assert.equal(result.analytics.topProviders[0].outboundVisitors, 3)
  assert.ok(queries.some(sql => sql.includes('COUNT(DISTINCT model_key)')))
  assert.ok(!queries.filter(sql => !sql.includes('LIMIT 10')).some(sql => /LIMIT/.test(sql)))
})

test('outbound-only visitors and clicks before views do not contribute to conversion rates', async () => {
  const bindings: unknown[][] = []
  const db = { prepare: (sql: string) => ({
    get: async (...values: unknown[]) => {
      if (sql.includes('AS convertedVisitors')) { bindings.push(values); return { pv: 2, uv: 1, outboundClicks: 5, outboundVisitors: 4, convertedVisitors: 0 } }
      return {}
    },
    all: async (...values: unknown[]) => {
      if (sql.includes('GROUP BY e.provider_id')) { bindings.push(values); return [{ id: 'managed-1', name: 'One', views: 2, visitors: 1, outboundClicks: 5, outboundVisitors: 4, convertedVisitors: 0 }] }
      return []
    },
  }) } as unknown as Database
  const { analytics } = await getAnalyticsDashboard(db, 'today', new Date('2026-10-29T01:00:00Z'))
  assert.equal(analytics.totals.uv, 1)
  assert.equal(analytics.totals.outboundVisitors, 4)
  assert.equal(analytics.totals.conversionRate, 0)
  assert.equal(analytics.topProviders[0].visitors, 1)
  assert.equal(analytics.topProviders[0].conversionRate, 0)
  assert.deepEqual(bindings, Array.from({ length: 2 }, () => ['2026-10-28 16:00:00.000', '2026-10-29 16:00:00.000', '2026-10-28 16:00:00.000', '2026-10-29 16:00:00.000']))
})

test('initialization creates indexed deduplicated UTC event storage and preserves collection start', async () => {
  const statements: string[] = []
  const db = { run: async (sql: string) => { statements.push(sql) }, all: async () => [] } as unknown as Database
  await initializeDatabase(db)
  const schema = statements.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS analytics_events'))!
  assert.match(schema, /event_id CHAR\(36\).*PRIMARY KEY/)
  assert.match(schema, /created_at DATETIME\(3\)/)
  assert.match(schema, /idx_analytics_time/)
  const metadata = statements.find(sql => sql.includes('INSERT INTO analytics_metadata'))!
  assert.match(metadata, /UTC_TIMESTAMP\(3\)/)
  assert.match(metadata, /ON DUPLICATE KEY UPDATE id = id/)
  assert.ok(!/ip_address|user_agent|email|referrer|source_url/.test(schema))
})

test('empty tables keep null conversion and metadata instead of fabricated historical activity', async () => {
  const db = { prepare: () => ({ get: async () => ({}), all: async () => [] }) } as unknown as Database
  const { analytics } = await getAnalyticsDashboard(db, 'today', new Date('2026-10-29T01:00:00Z'))
  assert.equal(analytics.collectedSince, null)
  assert.equal(analytics.totals.conversionRate, null)
  assert.equal(analytics.pending.oldestAt, null)
  assert.deepEqual(analytics.trend, [{ date: '2026-10-29', pv: 0, uv: 0, outboundClicks: 0 }])
})
