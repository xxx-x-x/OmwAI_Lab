import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { TLSSocket } from 'node:tls'
import type { Database } from './mysql.js'
import { ownerIdentity, type SiteOwner } from './site-management.ts'

export type PublicQuote = { modelId: string; groupName: string; currency: 'USD'; billingUnit: '1M tokens'; inputPrice: string; outputPrice: string }
const day = 24 * 60 * 60 * 1000
const errors: Record<string, string> = { unsupported_platform: 'This platform has no verified public pricing interface.', invalid_data: 'No valid supported public token prices were returned.', no_public_groups: 'The public Model Plaza returned no public pricing groups.', upstream_unavailable: 'The public pricing interface could not be read safely.', disabled: 'Public pricing sync is disabled.', throttled: 'Please wait five minutes before syncing again.', changed: 'Pricing settings changed; retry the sync.' }
class SyncError extends Error {}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ratio = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const label = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v === v.trim() && v.length <= 191 && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)

// Only the ordinary ratio-based token formula is supported. No fallback ratios or group names.
// https://github.com/QuantumNous/new-api/blob/main/model/pricing.go
// https://github.com/QuantumNous/new-api/blob/main/setting/billing_setting/tiered_billing.go
export function parseNewApiPricing(payload: unknown) {
  if (!object(payload) || payload.success === false || !Array.isArray(payload.data) || !object(payload.group_ratio) || payload.data.length > 20000) throw new SyncError('invalid_data')
  const quotes: PublicQuote[] = [], keys = new Set<string>()
  let unsupportedCount = 0
  for (const row of payload.data) {
    if (!object(row) || !label(row.model_name) || row.quota_type !== 0 || !ratio(row.model_ratio) || !ratio(row.completion_ratio) || (row.billing_mode !== undefined && row.billing_mode !== null && row.billing_mode !== '' && row.billing_mode !== 'ratio') || (row.billing_expr !== undefined && row.billing_expr !== null && row.billing_expr !== '') || !Array.isArray(row.enable_groups) || !row.enable_groups.length) { unsupportedCount++; continue }
    for (const group of row.enable_groups) {
      if (!label(group) || !Object.hasOwn(payload.group_ratio, group) || !ratio(payload.group_ratio[group])) { unsupportedCount++; continue }
      const input = row.model_ratio * 2 * payload.group_ratio[group], output = input * row.completion_ratio
      if (!Number.isFinite(input) || !Number.isFinite(output) || input >= 1e12 || output >= 1e12 || (input > 0 && input < 1e-8) || (output > 0 && output < 1e-8)) { unsupportedCount++; continue }
      const key = JSON.stringify([row.model_name, group])
      if (keys.has(key)) throw new SyncError('invalid_data')
      keys.add(key)
      quotes.push({ modelId: row.model_name, groupName: group, currency: 'USD', billingUnit: '1M tokens', inputPrice: input.toFixed(8), outputPrice: output.toFixed(8) })
      if (quotes.length > 10000) throw new SyncError('invalid_data')
    }
  }
  if (!quotes.length) throw new SyncError('invalid_data')
  return { quotes, unsupportedCount }
}

// Verified upstream Model Plaza schema; retail token prices are raw USD/token times the group rate.
// https://github.com/Wei-Shaw/sub2api/blob/main/frontend/src/components/modelPlaza/PlazaModelPricingTable.vue
export function parseSub2ApiPricing(payload: unknown) {
  if (!object(payload) || payload.code !== 0 || !object(payload.data) || !Array.isArray(payload.data.groups)) throw new SyncError('invalid_data')
  if (!payload.data.groups.length) throw new SyncError('no_public_groups')
  const quotes: PublicQuote[] = [], keys = new Set<string>()
  let unsupportedCount = 0
  for (const group of payload.data.groups) {
    if (!object(group) || !Array.isArray(group.models)) { unsupportedCount++; continue }
    for (const model of group.models) {
      const p = object(model) && object(model.pricing) ? model.pricing : null
      if (!label(group.name) || !ratio(group.rate_multiplier) || group.user_rate_multiplier != null || group.peak_rate_enabled || !object(model) || !label(model.name) || !p || p.billing_mode !== 'token' || !ratio(p.input_price) || !ratio(p.output_price) || (p.intervals != null && (!Array.isArray(p.intervals) || p.intervals.length > 0)) || model.long_context_basis || (model.time_pricing != null && (!object(model.time_pricing) || !Array.isArray(model.time_pricing.periods) || model.time_pricing.periods.length > 0)) || (p.reasoning_effort_multipliers != null && (!object(p.reasoning_effort_multipliers) || Object.keys(p.reasoning_effort_multipliers).length > 0))) { unsupportedCount++; continue }
      const input = p.input_price * group.rate_multiplier * 1e6, output = p.output_price * group.rate_multiplier * 1e6
      if (!Number.isFinite(input) || !Number.isFinite(output) || input >= 1e12 || output >= 1e12 || (input > 0 && input < 1e-8) || (output > 0 && output < 1e-8)) { unsupportedCount++; continue }
      const key = JSON.stringify([model.name, group.name])
      if (keys.has(key)) throw new SyncError('invalid_data')
      keys.add(key)
      quotes.push({ modelId: model.name, groupName: group.name, currency: 'USD', billingUnit: '1M tokens', inputPrice: input.toFixed(8), outputPrice: output.toFixed(8) })
      if (quotes.length > 10000) throw new SyncError('invalid_data')
    }
  }
  if (!quotes.length) throw new SyncError('invalid_data')
  return { quotes, unsupportedCount }
}

export function isPublicAddress(address: string) {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (family !== 6 || address.includes('%')) return false
  // Restrict to global unicast, excluding transition, documentation and special-purpose ranges.
  const first = Number.parseInt(address.split(':')[0], 16)
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff || first === 0x2002 || first === 0x3fff) return false
  if (first === 0x2001) {
    const second = Number.parseInt(address.split(':')[1] || '0', 16)
    if (second < 0x200 || second === 0xdb8) return false
  }
  return true
}

export function publicPricingUrl(website: string, platform = 'new-api') {
  const base = new URL(website)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || (base.port && !['80', '443'].includes(base.port))) throw new SyncError('upstream_unavailable')
  base.pathname = platform === 'sub2api' ? '/api/v1/model-plaza' : '/api/pricing'; base.search = ''; base.hash = ''
  return base
}

export async function fetchPublicPricing(url: URL): Promise<unknown> {
  // DNS answers are all checked; the connection uses exactly one approved answer, never a second lookup.
  const target = publicPricingUrl(url.href, url.pathname === '/api/v1/model-plaza' ? 'sub2api' : 'new-api')
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  const signal = AbortSignal.timeout(10000)
  let addresses: { address: string; family: number }[]
  if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }]
  else addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new SyncError('upstream_unavailable')), { once: true })),
  ])
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new SyncError('upstream_unavailable')
  const pinned = addresses[0]
  return new Promise((resolve, reject) => {
    const fail = () => reject(new SyncError('upstream_unavailable'))
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: 'GET', agent: false, signal, family: pinned.family, headers: { accept: 'application/json', 'accept-encoding': 'identity' },
      lookup: (_name, _options, callback) => callback(null, pinned.address, pinned.family),
    }, response => {
      if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') || Number(response.headers['content-length']) > 2 * 1024 * 1024) { response.destroy(); fail(); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024 * 1024) { response.destroy(); fail() } else chunks.push(chunk) })
      response.on('error', fail)
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { fail() } })
    })
    req.on('error', fail)
    req.end()
  })
}

const quoteFields = `CONCAT('sync-', q.id) AS id, q.model_id AS modelId, q.group_name AS groupName, q.currency, q.billing_unit AS billingUnit, q.input_price AS inputPrice, q.output_price AS outputPrice, q.source_url AS sourceUrl, 'public-interface' AS sourceType, 'reference' AS sourceStatus, q.synced_at AS syncedAt`
const stale = (value: unknown) => !value || !Number.isFinite(new Date(String(value)).getTime()) || Date.now() - new Date(String(value)).getTime() > day
export async function publicComparisonQuotes(db: Database, model: string) {
  const rows = await db.prepare(`SELECT ${quoteFields}, s.id AS siteId, s.name AS siteName, s.website FROM site_public_quotes q JOIN site_pricing_settings ps ON ps.submission_id = q.submission_id JOIN submissions s ON s.id = q.submission_id JOIN managed_providers p ON p.submission_id = s.id WHERE BINARY q.model_id = BINARY ? AND s.status = 'approved' AND s.directory_listed = 1 AND p.active = 1 AND ps.enabled = 1 ORDER BY q.id DESC LIMIT 500`).all(model)
  return rows.map(row => ({ ...row, stale: stale(row.syncedAt) }))
}

type Context = { database: Database; request: IncomingMessage; response: ServerResponse; url: URL; user: SiteOwner | null; localUserId: number | null; readJson: (request: IncomingMessage) => Promise<Record<string, unknown>>; json: (response: ServerResponse, status: number, payload: unknown) => void; fetchPricing?: typeof fetchPublicPricing }
export async function handlePublicPricing(c: Context) {
  const { database: db, request: req, response: res } = c
  const send = (status: number, payload: unknown) => c.json(res, status, payload)
  res.setHeader('cache-control', 'no-store')
  if (!c.user) return send(401, { error: 'Login required' })
  if (req.method !== 'GET' && (!req.headers.origin || req.headers.origin !== `${req.socket instanceof TLSSocket && req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`)) return send(403, { error: 'Invalid origin' })
  const match = c.url.pathname.match(/^\/api\/user\/sites\/(\d+)\/pricing(\/sync)?$/)
  if (!match) return send(404, { error: 'Not found' })
  const id = Number(match[1])
  if (!Number.isSafeInteger(id) || id < 1) return send(400, { error: 'Invalid site ID' })
  try {
    const site = await db.prepare("SELECT s.id, s.website FROM submissions s WHERE s.id = ? AND s.status = 'approved' AND (BINARY s.owner_identity = BINARY ? OR (? IS NOT NULL AND s.user_id = ?))").get(id, ownerIdentity(c.user, c.localUserId), c.localUserId, c.localUserId)
    if (!site) return send(404, { error: 'Approved owned site not found' })
    const snapshot = async () => {
      const settings = await db.prepare('SELECT enabled, platform, synced_at AS syncedAt, last_attempt_at AS lastAttemptAt, error_code AS errorCode, unsupported_count AS unsupportedCount FROM site_pricing_settings WHERE submission_id = ?').get(id)
      const rows = await db.prepare(`SELECT ${quoteFields} FROM site_public_quotes q WHERE q.submission_id = ? ORDER BY q.id LIMIT 10000`).all(id)
      const error = settings?.errorCode ? String(settings.errorCode) : null
      return { settings: { enabled: Boolean(settings?.enabled), platform: settings?.platform ?? 'new-api' }, sync: { syncedAt: settings?.syncedAt ?? null, lastAttemptAt: settings?.lastAttemptAt ?? null, error: error ? errors[error] ?? errors.upstream_unavailable : null, errorCode: error, unsupportedCount: Number(settings?.unsupportedCount ?? 0), stale: stale(settings?.syncedAt) }, quotes: rows.map(row => ({ ...row, stale: stale(row.syncedAt) })) }
    }
    if (!match[2] && req.method === 'GET') return send(200, await snapshot())
    if (!match[2] && req.method === 'PATCH') {
      let body: Record<string, unknown>
      try { body = await c.readJson(req) } catch { return send(400, { error: 'Invalid request' }) }
      if (typeof body.enabled !== 'boolean' || !['new-api', 'sub2api'].includes(String(body.platform))) return send(400, { error: 'enabled must be boolean; platform must be new-api or sub2api' })
      await db.prepare('INSERT INTO site_pricing_settings (submission_id, enabled, platform) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), platform = VALUES(platform), revision = revision + 1').run(id, body.enabled, String(body.platform))
      return send(200, await snapshot())
    }
    if (match[2] && req.method === 'POST') {
      const claim = await db.transaction(async connection => {
        const settings = await db.get('SELECT enabled, platform, revision, last_attempt_at AS lastAttemptAt FROM site_pricing_settings WHERE submission_id = ? FOR UPDATE', [id], connection)
        if (!settings?.enabled) throw new SyncError('disabled')
        if (settings.lastAttemptAt && Date.now() - new Date(String(settings.lastAttemptAt)).getTime() < 300000) throw new SyncError('throttled')
        await db.run('UPDATE site_pricing_settings SET last_attempt_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE submission_id = ?', [id], connection)
        return { platform: String(settings.platform), revision: Number(settings.revision) + 1 }
      })
      try {
        if (!['new-api', 'sub2api'].includes(claim.platform)) throw new SyncError('unsupported_platform')
        const source = publicPricingUrl(String(site.website), claim.platform)
        const payload = await (c.fetchPricing ?? fetchPublicPricing)(source)
        const parsed = claim.platform === 'new-api' ? parseNewApiPricing(payload) : parseSub2ApiPricing(payload)
        await db.transaction(async connection => {
          const settings = await db.get('SELECT enabled, platform, revision FROM site_pricing_settings WHERE submission_id = ? FOR UPDATE', [id], connection)
          if (!settings?.enabled || Number(settings.revision) !== claim.revision || settings.platform !== claim.platform) throw new SyncError('changed')
          await db.run('DELETE FROM site_public_quotes WHERE submission_id = ?', [id], connection)
          for (const q of parsed.quotes) await db.run('INSERT INTO site_public_quotes (submission_id, model_id, group_name, currency, billing_unit, input_price, output_price, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, q.modelId, q.groupName, q.currency, q.billingUnit, q.inputPrice, q.outputPrice, source.href], connection)
          await db.run('UPDATE site_pricing_settings SET synced_at = CURRENT_TIMESTAMP, error_code = NULL, unsupported_count = ? WHERE submission_id = ?', [parsed.unsupportedCount, id], connection)
        })
        return send(200, await snapshot())
      } catch (error) {
        const code = error instanceof SyncError && errors[error.message] ? error.message : 'upstream_unavailable'
        await db.prepare('UPDATE site_pricing_settings SET error_code = ? WHERE submission_id = ? AND revision = ?').run(code, id, claim.revision)
        return send(code === 'changed' ? 409 : 422, { ...await snapshot(), error: errors[code] })
      }
    }
    return send(405, { error: 'Method not allowed' })
  } catch (error) {
    const code = error instanceof SyncError ? error.message : ''
    return send(code === 'throttled' ? 429 : code === 'disabled' ? 409 : 503, { error: errors[code] ?? 'Pricing service unavailable' })
  }
}
