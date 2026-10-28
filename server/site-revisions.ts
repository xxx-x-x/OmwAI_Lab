import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database, DatabaseRow } from './mysql.js'
import { validateSubmission } from './site-management.ts'
import { validateLogoUrl } from './site-logo.ts'

const ownership = '(BINARY s.owner_identity = BINARY ? OR (? IS NOT NULL AND s.user_id = ?))'
export function revisionView(row: Record<string, unknown>) {
  return { id: Number(row.id), submissionId: Number(row.submission_id), status: row.status, proposal: typeof row.proposal === 'string' ? JSON.parse(row.proposal) : row.proposal, reviewNote: row.review_note, createdAt: row.created_at, updatedAt: row.updated_at }
}
type Context = {
  database: Database; request: IncomingMessage; response: ServerResponse; url: URL
  identity: string; localUserId: number | null; adminId?: number; onApproved?: () => void
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>
  json: (res: ServerResponse, status: number, payload: unknown) => void
}

// Full public snapshot; omitted logoUrl preserves the approved config, empty string means discovery.
export async function handleSiteRevision(c: Context) {
  const { database: db, request: req, url } = c
  const send = (status: number, value: unknown) => c.json(c.response, status, value)
  const owner = url.pathname.match(/^\/api\/user\/sites\/(\d+)\/revision$/)
  const review = url.pathname.match(/^\/api\/admin\/site-revisions\/(\d+)$/)
  if (!owner && !c.adminId) return send(403, { error: '无权访问管理员后台' })
  if (owner) {
    const id = Number(owner[1])
    if (!Number.isSafeInteger(id) || id < 1) return send(400, { error: '站点编号无效' })
    if (!['POST', 'DELETE'].includes(req.method ?? '')) return send(405, { error: '请求方法无效' })
    let proposal: ReturnType<typeof validateSubmission> & { logoUrl?: string | null } | undefined
    if (req.method === 'POST') {
      try {
        const body = await c.readJson(req)
        proposal = validateSubmission(body)
        if (body.logoUrl !== undefined) {
          if (typeof body.logoUrl !== 'string' || body.logoUrl.length > 2048) throw new Error('logo')
          proposal.logoUrl = body.logoUrl.trim() ? validateLogoUrl(body.logoUrl.trim()).href : null
        }
      } catch { return send(400, { error: '修改信息无效，请检查必填信息、地址、日期和 Logo 地址' }) }
    }
    const result = await db.transaction(async connection => {
      const site = await db.get(`SELECT s.id, p.id AS providerId, l.custom_url FROM submissions s JOIN managed_providers p ON p.submission_id = s.id LEFT JOIN site_logos l ON l.provider_id = p.id WHERE s.id = ? AND s.status = 'approved' AND ${ownership} FOR UPDATE`, [id, c.identity, c.localUserId, c.localUserId], connection)
      if (!site) return { status: 404, error: '已审核的自有站点不存在' }
      const pending = await db.get("SELECT id FROM site_revisions WHERE submission_id = ? AND status = 'pending' FOR UPDATE", [id], connection)
      if (req.method === 'DELETE') {
        if (!pending) return { status: 409, error: '没有待审核的修改' }
        await db.run("UPDATE site_revisions SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(pending.id)], connection)
        return { status: 200 }
      }
      if (pending) return { status: 409, error: '已有待审核修改，请先撤回' }
      const snapshot = { ...proposal!, logoUrl: proposal!.logoUrl === undefined ? site.custom_url ?? null : proposal!.logoUrl }
      const inserted = await db.run('INSERT INTO site_revisions (submission_id, proposal) VALUES (?, ?)', [id, JSON.stringify(snapshot)], connection)
      return { status: 201, id: Number(inserted.insertId) }
    })
    return send(result.status, result.error ? { error: result.error } : { ok: true, ...(result.id ? { id: result.id } : {}) })
  }
  if (url.pathname === '/api/admin/site-revisions' && req.method === 'GET') {
    const rows = await db.all(`SELECT r.*, s.submitter_login, s.name, s.website, s.models, s.pricing, s.notes, s.description, s.invoice_supported AS invoice, s.billing_type AS billingType, s.billing_details AS billingDetails, DATE_FORMAT(s.founded_at, '%Y-%m-%d') AS foundedAt, l.custom_url AS logoUrl FROM site_revisions r JOIN submissions s ON s.id = r.submission_id LEFT JOIN managed_providers p ON p.submission_id = s.id LEFT JOIN site_logos l ON l.provider_id = p.id ORDER BY r.id DESC LIMIT 500`)
    return send(200, { revisions: rows.map(row => ({ ...revisionView(row), submitter_login: row.submitter_login, current: { name: row.name, website: row.website, models: row.models, pricing: row.pricing, notes: row.notes, description: row.description, invoice: row.invoice == null ? null : Boolean(row.invoice), billingType: row.billingType, billingDetails: row.billingDetails, foundedAt: row.foundedAt, logoUrl: row.logoUrl ?? null } })) })
  }
  if (review && req.method === 'PATCH') {
    const id = Number(review[1])
    if (!Number.isSafeInteger(id) || id < 1) return send(400, { error: '修改编号无效' })
    let body: Record<string, unknown>
    try { body = await c.readJson(req) } catch { return send(400, { error: '请求格式无效' }) }
    if (!['approved', 'rejected'].includes(String(body.status)) || (body.review_note !== undefined && (typeof body.review_note !== 'string' || body.review_note.length > 10000))) return send(400, { error: '审核信息无效' })
    const initial = await db.get('SELECT submission_id FROM site_revisions WHERE id = ?', [id])
    if (!initial) return send(404, { error: '修改记录不存在' })
    const status = String(body.status), note = String(body.review_note ?? '').trim()
    const result = await db.transaction(async connection => {
      // All owner/admin operations lock the submission first to serialize reviews and withdrawals.
      const site = await db.get("SELECT s.id, p.id AS providerId, p.website, l.custom_url FROM submissions s JOIN managed_providers p ON p.submission_id = s.id LEFT JOIN site_logos l ON l.provider_id = p.id WHERE s.id = ? AND s.status = 'approved' FOR UPDATE", [Number(initial.submission_id)], connection)
      if (!site) return 409
      const revision = await db.get('SELECT * FROM site_revisions WHERE id = ? AND submission_id = ? FOR UPDATE', [id, Number(site.id)], connection)
      if (!revision || revision.status !== 'pending') return 409
      if (status === 'approved') {
        const stored = typeof revision.proposal === 'string' ? JSON.parse(revision.proposal) : revision.proposal
        const s = validateSubmission({ ...stored, informationValid: true })
        const logoUrl = stored.logoUrl == null ? null : validateLogoUrl(stored.logoUrl).href
        await db.run('UPDATE submissions SET name = ?, website = ?, models = ?, pricing = ?, notes = ?, founded_at = ?, description = ?, invoice_supported = ?, billing_type = ?, billing_details = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [s.name, s.website, s.models, s.pricing, s.notes, s.foundedAt, s.description, s.invoice, s.billingType, s.billingDetails, Number(site.id)], connection)
        await db.run('UPDATE managed_providers SET name = ?, website = ?, models = ?, pricing = ?, notes = ? WHERE id = ?', [s.name, s.website, s.models, s.pricing, s.notes, Number(site.providerId)], connection)
        if (s.website !== site.website || logoUrl !== (site.custom_url ?? null)) {
          await db.run('INSERT IGNORE INTO site_logos (provider_id, website) VALUES (?, ?)', [Number(site.providerId), s.website], connection)
          await db.run("UPDATE site_logos SET website = ?, custom_url = ?, image = NULL, content_type = NULL, digest = NULL, fetch_status = 'pending', attempted_at = '2000-01-01 00:00:00', revision = revision + 1 WHERE provider_id = ?", [s.website, logoUrl, Number(site.providerId)], connection)
        }
      }
      await db.run('UPDATE site_revisions SET status = ?, review_note = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, note, c.adminId!, id], connection)
      await db.run('INSERT INTO audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [c.adminId!, `site_revision.${status}`, 'site_revision', id, note], connection)
      return 200
    })
    if (result === 200 && status === 'approved') c.onApproved?.()
    return send(result, result === 200 ? { ok: true } : { error: '修改或站点状态已变化，请重新加载' })
  }
  return send(405, { error: '请求方法无效' })
}

export async function ownerRevisions(db: Database, identity: string, localUserId: number | null) {
  return db.prepare(`SELECT r.* FROM site_revisions r JOIN submissions s ON s.id = r.submission_id WHERE ${ownership} AND (r.status = 'pending' OR r.id = (SELECT MAX(latest.id) FROM site_revisions latest WHERE latest.submission_id = s.id)) ORDER BY r.id DESC`).all<DatabaseRow>(identity, localUserId, localUserId)
}
