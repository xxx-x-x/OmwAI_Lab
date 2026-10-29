import { createCipheriv, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { TLSSocket } from 'node:tls'
import type { Database } from './mysql.js'
import { publicComparisonQuotes } from './public-pricing.ts'

export function encryptCredential(secret: string, configuredKey: string) {
  if (!/^[0-9a-fA-F]{64}$/.test(configuredKey)) throw new Error('Credential encryption is not configured')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(configuredKey, 'hex'), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`
}

export function validateQuote(body: Record<string, unknown>) {
  const text = (key: string, max: number) => {
    const value = body[key]
    if (typeof value !== 'string' || !value.trim() || value.length > max || value !== value.trim()) throw new Error('Invalid quote')
    return value
  }
  const authorizationId = body.authorizationId
  if (typeof authorizationId !== 'number' || !Number.isSafeInteger(authorizationId) || authorizationId < 1) throw new Error('Invalid quote')
  const model = text('modelId', 191), currency = text('currency', 3), unit = text('billingUnit', 64), source = text('sourceUrl', 2048)
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid quote')
  let url: URL
  try { url = new URL(source) } catch { throw new Error('Invalid quote') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid quote')
  const price = (value: unknown) => {
    if (value === null || value === undefined) return null
    if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,8})?$/.test(value)) throw new Error('Invalid quote')
    return value
  }
  const input = price(body.inputPrice), output = price(body.outputPrice)
  if (input === null && output === null) throw new Error('Invalid quote')
  return { authorizationId, model, currency, unit, source, input, output }
}

type Context = { database: Database; request: IncomingMessage; response: ServerResponse; url: URL; localUserId: number | null; adminId: number | null; key: string; readJson: (request: IncomingMessage) => Promise<Record<string, unknown>>; json: (response: ServerResponse, status: number, payload: unknown) => void }

export async function handleSiteGroups(c: Context) {
  const { database: db, request: req, response: res, url, localUserId, adminId } = c
  const send = (status: number, payload: unknown) => c.json(res, status, payload)
  res.setHeader('cache-control', 'no-store')
  if (url.pathname === '/api/site-comparison' && req.method === 'GET') {
    const model = url.searchParams.get('modelId')
    if (!model || model.length > 191) return send(400, { error: 'modelId is required' })
    const publicQuotes = await publicComparisonQuotes(db, model)
    const manualQuery = `SELECT q.id, q.model_id AS modelId, a.group_name AS groupName, gm.multiplier AS groupMultiplier, gm.detected_at AS groupMultiplierDetectedAt, gm.source_url AS groupMultiplierSourceUrl, CASE WHEN gm.multiplier IS NOT NULL THEN 'group-probe' ELSE NULL END AS groupMultiplierSource, ps.platform, q.currency, q.billing_unit AS billingUnit, q.input_price AS inputPrice, q.output_price AS outputPrice, q.source_url AS sourceUrl, q.reviewed_at AS reviewedAt, 'manual' AS sourceType, 'approved' AS sourceStatus, s.id AS siteId, CASE WHEN s.directory_listed = 1 AND p.active = 1 THEN CONCAT('managed-', p.id) ELSE NULL END AS providerId, s.name AS siteName, s.website, (s.status = 'approved' AND s.directory_listed = 1 AND p.active = 1) AS verified, CASE WHEN l.image IS NOT NULL AND l.website = p.website THEN CONCAT('/api/site-logos/', p.id, '?v=', l.digest) ELSE NULL END AS logoUrl FROM group_authorization_quotes q JOIN group_authorizations a ON a.id = q.authorization_id JOIN submissions s ON s.id = a.submission_id AND a.user_id = s.user_id LEFT JOIN managed_providers p ON p.submission_id = s.id LEFT JOIN site_logos l ON l.provider_id = p.id LEFT JOIN site_pricing_settings ps ON ps.submission_id = s.id LEFT JOIN site_public_groups gm ON gm.submission_id = s.id AND BINARY gm.group_name = BINARY a.group_name AND BINARY gm.website = BINARY s.website WHERE BINARY q.model_id = BINARY ? AND q.status = 'approved' AND s.status = 'approved' AND s.local_owner_verified = 1 AND a.revoked_at IS NULL AND a.credential IS NOT NULL ORDER BY q.id DESC LIMIT 500`
    const quotes = await db.prepare(manualQuery).all(model)
    return send(200, { quotes: [...publicQuotes, ...quotes] })
  }
  if (!localUserId) return send(401, { error: 'Local login required' })
  if (req.method !== 'GET') {
    const origin = req.headers.origin
    if (!origin || origin !== `${req.socket instanceof TLSSocket && req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`) return send(403, { error: 'Invalid origin' })
  }
  const siteMatch = url.pathname.match(/^\/api\/user\/sites\/(\d+)\/(authorizations|quotes)(?:\/([^/]+))?$/)
  if (siteMatch) {
    const siteId = Number(siteMatch[1])
    if (!Number.isSafeInteger(siteId) || siteId < 1) return send(400, { error: 'Invalid site ID' })
    const owned = await db.prepare("SELECT id FROM submissions WHERE id = ? AND user_id = ? AND status = 'approved' AND local_owner_verified = 1").get(siteId, localUserId)
    if (!owned) return send(404, { error: 'Approved owned site not found' })
    if (siteMatch[2] === 'authorizations' && !siteMatch[3] && req.method === 'GET') {
      const authorizations = await db.prepare('SELECT id, group_name AS groupName, consent_at AS consentAt, revoked_at AS revokedAt, credential IS NOT NULL AS hasCredential FROM group_authorizations WHERE submission_id = ? AND user_id = ? ORDER BY id').all(siteId, localUserId)
      return send(200, { authorizations })
    }
    let groupName = ''
    if (siteMatch[3]) {
      try { groupName = decodeURIComponent(siteMatch[3]) } catch { return send(400, { error: 'Invalid group name' }) }
      if (!groupName.trim() || groupName !== groupName.trim() || groupName.length > 191 || /[\x00-\x1f\x7f]/.test(groupName)) return send(400, { error: 'Invalid group name' })
    }
    if (siteMatch[2] === 'authorizations' && groupName && req.method === 'PUT') {
      let body: Record<string, unknown>
      try { body = await c.readJson(req) } catch { return send(400, { error: 'Invalid request' }) }
      if (body.consent !== true || typeof body.key !== 'string' || !body.key.trim() || body.key.length > 8192) return send(400, { error: 'Consent and key required' })
      let encrypted: string
      try { encrypted = encryptCredential(body.key, c.key) } catch { return send(503, { error: 'Credential encryption is not configured' }) }
      await db.transaction(async connection => {
        await db.run('INSERT INTO group_authorizations (submission_id, user_id, group_name, credential, consent_at, revoked_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL) ON DUPLICATE KEY UPDATE credential = VALUES(credential), consent_at = CURRENT_TIMESTAMP, revoked_at = NULL', [siteId, localUserId, groupName, encrypted], connection)
        await db.run("UPDATE group_authorization_quotes q JOIN group_authorizations a ON a.id = q.authorization_id SET q.status = 'pending', q.reviewed_at = NULL WHERE a.submission_id = ? AND a.user_id = ? AND BINARY a.group_name = BINARY ?", [siteId, localUserId, groupName], connection)
      })
      return send(200, { ok: true })
    }
    if (siteMatch[2] === 'authorizations' && groupName && req.method === 'DELETE') {
      await db.transaction(async connection => {
        await db.run('UPDATE group_authorizations SET credential = NULL, revoked_at = CURRENT_TIMESTAMP WHERE submission_id = ? AND user_id = ? AND BINARY group_name = BINARY ?', [siteId, localUserId, groupName], connection)
        await db.run("UPDATE group_authorization_quotes q JOIN group_authorizations a ON a.id = q.authorization_id SET q.status = 'pending', q.reviewed_at = NULL WHERE a.submission_id = ? AND a.user_id = ? AND BINARY a.group_name = BINARY ?", [siteId, localUserId, groupName], connection)
      })
      return send(200, { ok: true })
    }
    if (siteMatch[2] === 'quotes' && !siteMatch[3] && req.method === 'GET') {
      const quotes = await db.prepare('SELECT q.id, q.authorization_id AS authorizationId, a.group_name AS groupName, q.model_id AS modelId, q.currency, q.billing_unit AS billingUnit, q.input_price AS inputPrice, q.output_price AS outputPrice, q.source_url AS sourceUrl, q.status, q.created_at AS createdAt, q.reviewed_at AS reviewedAt FROM group_authorization_quotes q JOIN group_authorizations a ON a.id = q.authorization_id WHERE a.submission_id = ? AND a.user_id = ? ORDER BY q.id DESC LIMIT 500').all(siteId, localUserId)
      return send(200, { quotes })
    }
    if (siteMatch[2] === 'quotes' && !siteMatch[3] && req.method === 'POST') {
      let quote: ReturnType<typeof validateQuote>
      try { quote = validateQuote(await c.readJson(req)) } catch { return send(400, { error: 'Invalid quote' }) }
      const result = await db.prepare(`INSERT INTO group_authorization_quotes (authorization_id, model_id, currency, billing_unit, input_price, output_price, source_url) SELECT a.id, ?, ?, ?, ?, ?, ? FROM submissions s JOIN group_authorizations a ON a.submission_id = s.id AND a.user_id = s.user_id WHERE a.id = ? AND s.id = ? AND s.user_id = ? AND s.status = 'approved' AND s.local_owner_verified = 1 AND a.revoked_at IS NULL AND a.credential IS NOT NULL`).run(quote.model, quote.currency, quote.unit, quote.input, quote.output, quote.source, quote.authorizationId, siteId, localUserId)
      if (!result.affectedRows) return send(409, { error: 'Active authorization required' })
      return send(201, { id: result.insertId, status: 'pending' })
    }
  }
  if (url.pathname === '/api/admin/site-quotes' && req.method === 'GET') {
    if (!adminId) return send(403, { error: 'Admin required' })
    const quotes = await db.prepare('SELECT q.id, a.submission_id AS siteId, q.authorization_id AS authorizationId, a.group_name AS groupName, q.model_id AS modelId, q.currency, q.billing_unit AS billingUnit, q.input_price AS inputPrice, q.output_price AS outputPrice, q.source_url AS sourceUrl, q.status, q.created_at AS createdAt, q.reviewed_at AS reviewedAt FROM group_authorization_quotes q JOIN group_authorizations a ON a.id = q.authorization_id ORDER BY q.id DESC LIMIT 500').all()
    return send(200, { quotes })
  }
  const review = url.pathname.match(/^\/api\/admin\/site-quotes\/(\d+)$/)
  if (review && req.method === 'PATCH') {
    if (!adminId) return send(403, { error: 'Admin required' })
    const id = Number(review[1])
    if (!Number.isSafeInteger(id) || id < 1) return send(400, { error: 'Invalid quote ID' })
    let body: Record<string, unknown>
    try { body = await c.readJson(req) } catch { return send(400, { error: 'Invalid request' }) }
    if (body.status !== 'approved' && body.status !== 'rejected') return send(400, { error: 'Invalid status' })
    const result = await db.transaction(async connection => {
      const updated = await db.run(`UPDATE group_authorization_quotes q JOIN group_authorizations a ON a.id = q.authorization_id JOIN submissions s ON s.id = a.submission_id AND a.user_id = s.user_id SET q.status = ?, q.reviewed_at = CURRENT_TIMESTAMP WHERE q.id = ? AND q.status = 'pending' AND s.status = 'approved' AND s.local_owner_verified = 1 AND a.revoked_at IS NULL AND a.credential IS NOT NULL`, [body.status as string, id], connection)
      if (updated.affectedRows) await db.run('INSERT INTO audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [adminId, `site-quote.${body.status}`, 'site-quote', id, ''], connection)
      return updated
    })
    return result.affectedRows ? send(200, { ok: true }) : send(409, { error: 'Quote not pending or authorization inactive' })
  }
  return send(405, { error: 'Method not allowed' })
}
