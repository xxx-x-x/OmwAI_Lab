import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.js'
import { validWriteOrigin } from './session-security.ts'

const DAY = 86_400_000
const OFFSET = 8 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROVIDER = /^managed-[1-9]\d{0,14}$/
const PUBLIC_PROVIDER = "p.active = 1 AND s.status = 'approved' AND s.directory_listed = 1"
export type AnalyticsEvent = { eventId: string; visitorId: string; sessionId: string; kind: 'pageview' | 'outbound_intent' | 'outbound_click'; path: string; providerId?: string }

// Query strings/fragments are discarded, never persisted (including model/search/login parameters).
export function normalizeAnalyticsPath(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32)) throw new Error('Invalid path')
  const path = value.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  if (!['/', '/directory', '/pricing', '/pricing/model', '/models', '/welcome', '/submit', '/site-management', '/site-management/sites', '/site-management/model-test', '/site-management/latency-test'].includes(path) && !/^\/provider\/managed-[1-9]\d{0,14}$/.test(path)) throw new Error('Invalid path')
  return path === '/directory' ? '/' : path
}

export function validateAnalyticsEvent(body: unknown): AnalyticsEvent {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid event')
  const event = body as Record<string, unknown>
  const keys = ['eventId', 'visitorId', 'sessionId', 'kind', 'path', 'providerId']
  if (Object.keys(event).some(key => !keys.includes(key))) throw new Error('Unknown event field')
  for (const key of ['eventId', 'visitorId', 'sessionId']) if (typeof event[key] !== 'string' || !UUID.test(event[key])) throw new Error('Invalid UUID')
  if (typeof event.kind !== 'string' || !['pageview', 'outbound_intent', 'outbound_click'].includes(event.kind)) throw new Error('Invalid kind')
  if (event.providerId !== undefined && (typeof event.providerId !== 'string' || !PROVIDER.test(event.providerId))) throw new Error('Invalid provider')
  if (event.kind !== 'pageview' && !event.providerId) throw new Error('Outbound events require providerId')
  const path = normalizeAnalyticsPath(event.path)
  const pathProvider = path.startsWith('/provider/') ? path.slice('/provider/'.length) : undefined
  if (pathProvider && event.providerId && event.providerId !== pathProvider) throw new Error('Provider path mismatch')
  const providerId = event.providerId ? String(event.providerId) : pathProvider
  return { eventId: String(event.eventId).toLowerCase(), visitorId: String(event.visitorId).toLowerCase(), sessionId: String(event.sessionId).toLowerCase(), kind: event.kind as AnalyticsEvent['kind'], path, ...(providerId ? { providerId } : {}) }
}

export function analyticsRange(value: string | null, now = new Date()) {
  const range = value ?? '7d'
  if (!['today', 'yesterday', '7d', '30d'].includes(range)) throw new Error('Invalid range')
  const today = Math.floor((now.getTime() + OFFSET) / DAY) * DAY - OFFSET
  const end = range === 'yesterday' ? today : today + DAY
  const days = range === '30d' ? 30 : range === '7d' ? 7 : 1
  const start = end - days * DAY
  const date = (time: number) => new Date(time + OFFSET).toISOString().slice(0, 10)
  return { range, start, end, startDate: date(start), endDate: date(end - DAY), dates: Array.from({ length: days }, (_, i) => date(start + i * DAY)) }
}

export function conversionRate(visitors: number, outboundVisitors: number) {
  return visitors ? Math.min(1, outboundVisitors / visitors) : null
}

// In-memory, per-process abuse protection; keys are hashed and expire, never stored as event data.
export function createAnalyticsLimiter(limit = 120, windowMs = 60_000, maxKeys = 10_000) {
  const entries = new Map<string, { count: number; expires: number }>()
  return (key: string, now = Date.now()) => {
    for (const [id, entry] of entries) if (entry.expires <= now) entries.delete(id)
    const id = createHash('sha256').update(key).digest('hex')
    let entry = entries.get(id)
    if (!entry) {
      if (entries.size >= maxKeys) return false
      entry = { count: 0, expires: now + windowMs }; entries.set(id, entry)
    }
    return ++entry.count <= limit
  }
}

type Send = (response: ServerResponse, status: number, payload: unknown) => void
export function createAnalyticsCollector(database: Database, publicOrigin: string, trustProxy = false, ensureReady: () => Promise<void> = async () => {}) {
  const allowIp = createAnalyticsLimiter()
  const allowVisitor = createAnalyticsLimiter(60)
  let nextCleanupAt = 0
  // Request-driven, indexed batches avoid timers and unbounded deletes on busy installations.
  const cleanupExpiredEvents = () => {
    const now = Date.now()
    if (now < nextCleanupAt) return
    nextCleanupAt = now + 60_000
    void database.prepare('DELETE FROM analytics_events WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 90 DAY ORDER BY created_at LIMIT 1000').run().catch(() => {
      // Cleanup is best-effort and must not fail event collection.
    })
  }
  return async (request: IncomingMessage, response: ServerResponse, send: Send) => {
    response.setHeader('cache-control', 'no-store')
    if (request.method !== 'POST') { response.setHeader('allow', 'POST'); return send(response, 405, { error: 'Method not allowed' }) }
    if (!validWriteOrigin(request, publicOrigin)) return send(response, 403, { error: 'Invalid origin' })
    const forwarded = trustProxy ? request.headers['x-forwarded-for'] : undefined
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'
    if (!allowIp(ip)) { response.setHeader('retry-after', '60'); return send(response, 429, { error: 'Too many events' }) }
    if (/bot|crawler|spider|slurp|headless|preview|monitor|curl|wget/i.test(request.headers['user-agent'] ?? '')) return send(response, 202, { ok: true })
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) return send(response, 415, { error: 'JSON required' })
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') return send(response, 415, { error: 'Unsupported encoding' })
    if (Number(request.headers['content-length']) > 4096) return send(response, 413, { error: 'Event too large' })
    let event: AnalyticsEvent
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > 4096) return send(response, 413, { error: 'Event too large' })
        chunks.push(buffer)
      }
      event = validateAnalyticsEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch { return send(response, 400, { error: 'Invalid analytics event' }) }
    if (!allowVisitor(event.visitorId)) { response.setHeader('retry-after', '60'); return send(response, 429, { error: 'Too many events' }) }
    try {
      await ensureReady()
      cleanupExpiredEvents()
      if (event.providerId) {
        const provider = await database.prepare(`SELECT p.id FROM managed_providers p JOIN submissions s ON s.id = p.submission_id WHERE p.id = ? AND ${PUBLIC_PROVIDER}`).get(event.providerId.slice(8))
        if (!provider) return send(response, 400, { error: 'Provider is not public' })
      }
      await database.prepare(`INSERT INTO analytics_events (event_id, visitor_id, session_id, kind, path, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE event_id = event_id`).run(event.eventId, event.visitorId, event.sessionId, event.kind, event.path, event.providerId ?? null)
      return send(response, 202, { ok: true })
    } catch { return send(response, 503, { error: 'Analytics temporarily unavailable' }) }
  }
}

const number = (value: unknown) => Number(value ?? 0)
const utcSql = (time: number) => new Date(time).toISOString().slice(0, 23).replace('T', ' ')

export async function getAnalyticsDashboard(database: Database, value: string | null, now = new Date()) {
  const period = analyticsRange(value, now)
  const bounds = [utcSql(period.start), utcSql(period.end)]
  const where = 'created_at >= ? AND created_at < ?'
  const metrics = `SUM(kind = 'pageview') AS pv, COUNT(DISTINCT CASE WHEN kind = 'pageview' THEN visitor_id END) AS uv, SUM(kind = 'outbound_click') AS outboundClicks, COUNT(DISTINCT CASE WHEN kind = 'outbound_click' THEN visitor_id END) AS outboundVisitors`
  const matchedClick = (sameProvider: boolean) => `kind = 'outbound_click' AND EXISTS (SELECT 1 FROM analytics_events viewed WHERE viewed.kind = 'pageview' AND viewed.visitor_id = e.visitor_id ${sameProvider ? 'AND viewed.provider_id = e.provider_id' : ''} AND viewed.created_at >= ? AND viewed.created_at < ? AND viewed.created_at < e.created_at)`
  const matchedVisitors = `COUNT(DISTINCT CASE WHEN ${matchedClick(false)} THEN visitor_id END) AS convertedVisitors`
  // Legacy tables use TIMESTAMP, so compare via epochs independently of MySQL session time zone.
  const legacyWhere = 'created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)'
  const pendingItems = `SELECT created_at, 'submissions' AS kind FROM submissions WHERE status = 'pending'
    UNION ALL SELECT created_at, 'revisions' FROM site_revisions WHERE status = 'pending'`
  const [counts, totals, business, pending, trend, providers, pages, metadata, health, recentLogs] = await Promise.all([
    database.prepare("SELECT (SELECT COUNT(*) FROM submissions WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM managed_providers WHERE active = 1) AS providers, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM audit_logs) AS logs").get(),
    database.prepare(`SELECT ${metrics}, ${matchedVisitors} FROM analytics_events e WHERE ${where}`).get(...bounds, ...bounds),
    database.prepare(`SELECT (SELECT COUNT(*) FROM users WHERE ${legacyWhere}) AS newUsers, (SELECT COUNT(*) FROM submissions WHERE ${legacyWhere}) AS newSubmissions, (SELECT COUNT(*) FROM managed_providers p JOIN submissions s ON s.id = p.submission_id WHERE ${PUBLIC_PROVIDER}) AS publicProviders, (SELECT COUNT(*) FROM users) AS localUsers`).get(period.start / 1000, period.end / 1000, period.start / 1000, period.end / 1000),
    database.prepare(`SELECT SUM(kind = 'submissions') AS submissions, SUM(kind = 'revisions') AS revisions, MIN(UNIX_TIMESTAMP(created_at)) AS oldestEpoch, SUM(UNIX_TIMESTAMP(created_at) <= ?) AS overdue FROM (${pendingItems}) pending_items`).get(now.getTime() / 1000 - 48 * 3600),
    database.prepare(`SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL 8 HOUR), '%Y-%m-%d') AS date, ${metrics} FROM analytics_events WHERE ${where} GROUP BY date ORDER BY date`).all(...bounds),
    database.prepare(`SELECT e.provider_id AS id, p.name, SUM(e.kind = 'pageview') AS views, COUNT(DISTINCT CASE WHEN e.kind = 'pageview' THEN e.visitor_id END) AS visitors, SUM(e.kind = 'outbound_click') AS outboundClicks, COUNT(DISTINCT CASE WHEN e.kind = 'outbound_click' THEN e.visitor_id END) AS outboundVisitors, COUNT(DISTINCT CASE WHEN ${matchedClick(true)} THEN e.visitor_id END) AS convertedVisitors FROM analytics_events e JOIN managed_providers p ON CONCAT('managed-', p.id) = e.provider_id JOIN submissions s ON s.id = p.submission_id WHERE e.created_at >= ? AND e.created_at < ? AND ${PUBLIC_PROVIDER} GROUP BY e.provider_id, p.name ORDER BY outboundClicks DESC, views DESC, id LIMIT 10`).all(...bounds, ...bounds),
    database.prepare(`SELECT path, COUNT(*) AS pv, COUNT(DISTINCT visitor_id) AS uv FROM analytics_events WHERE ${where} AND kind = 'pageview' GROUP BY path ORDER BY pv DESC, path LIMIT 10`).all(...bounds),
    database.prepare("SELECT DATE_FORMAT(collected_since, '%Y-%m-%dT%H:%i:%s.000Z') AS collectedSince FROM analytics_metadata WHERE id = 1").get(),
    database.prepare(`SELECT (SELECT MAX(UNIX_TIMESTAMP(synced_at)) FROM model_ranking_syncs) AS rankingEpoch, (SELECT COUNT(*) FROM model_rankings) AS rankingModels, (SELECT MAX(UNIX_TIMESTAMP(synced_at)) FROM model_price_syncs) AS pricesEpoch, (SELECT COUNT(DISTINCT model_key) FROM model_prices) AS priceModels, (SELECT COUNT(*) FROM site_pricing_settings WHERE enabled = 1 AND error_code IS NOT NULL) AS pricingFailures`).get(),
    database.prepare("SELECT l.id, l.action, u.username AS admin_name, UNIX_TIMESTAMP(l.created_at) AS createdEpoch FROM audit_logs l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 10").all(),
  ])
  const epochIso = (value: unknown) => value == null ? null : new Date(Number(value) * 1000).toISOString()
  const pv = number(totals?.pv), uv = number(totals?.uv), outboundVisitors = number(totals?.outboundVisitors)
  return {
    counts: { pending: number(counts?.pending), providers: number(counts?.providers), users: number(counts?.users), logs: number(counts?.logs) },
    analytics: {
      range: period.range, startDate: period.startDate, endDate: period.endDate, collectedSince: metadata?.collectedSince == null ? null : String(metadata.collectedSince),
      totals: { pv, uv, outboundClicks: number(totals?.outboundClicks), outboundVisitors, conversionRate: conversionRate(uv, number(totals?.convertedVisitors)), newUsers: number(business?.newUsers), newSubmissions: number(business?.newSubmissions), publicProviders: number(business?.publicProviders), localUsers: number(business?.localUsers) },
      pending: { submissions: number(pending?.submissions), revisions: number(pending?.revisions), oldestAt: epochIso(pending?.oldestEpoch), overdue: number(pending?.overdue) },
      trend: period.dates.map(date => { const row = trend.find(item => item.date === date); return { date, pv: number(row?.pv), uv: number(row?.uv), outboundClicks: number(row?.outboundClicks) } }),
      topProviders: providers.map(row => ({ id: String(row.id), name: String(row.name), views: number(row.views), visitors: number(row.visitors), outboundClicks: number(row.outboundClicks), outboundVisitors: number(row.outboundVisitors), conversionRate: conversionRate(number(row.visitors), number(row.convertedVisitors)) })),
      topPages: pages.map(row => ({ path: String(row.path), pv: number(row.pv), uv: number(row.uv) })),
      health: { rankingSyncedAt: epochIso(health?.rankingEpoch), rankingModels: number(health?.rankingModels), pricesSyncedAt: epochIso(health?.pricesEpoch), priceModels: number(health?.priceModels), pricingFailures: number(health?.pricingFailures) },
      recentLogs: recentLogs.map(row => ({ id: number(row.id), action: String(row.action), admin_name: row.admin_name == null ? '' : String(row.admin_name), created_at: epochIso(row.createdEpoch) })),
    },
  }
}
