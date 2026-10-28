import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.js'
import { handleLogoSettings } from './site-logo-settings.ts'

export type SiteOwner = { id: string | number; login: string; html_url: string }
export function ownerIdentity(user: SiteOwner, localUserId: number | null) {
  return localUserId !== null ? `local:${localUserId}` : `${user.html_url ? 'github' : 'google'}:${user.id}`
}

export function validateSubmission(body: Record<string, unknown>, now = new Date()) {
  const text = (field: string, max: number, optional = false) => {
    const value = body[field]
    if (optional && value === undefined) return ''
    if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new Error('提交信息格式无效')
    return value.trim()
  }
  if (body.informationValid !== true) throw new Error('请确认站点信息真实有效')
  const name = text('name', 255), website = text('website', 2048), foundedAt = text('foundedAt', 10)
  const description = text('description', 10000), models = text('models', 10000)
  const notes = text('notes', 10000, true)
  const pricing = text('pricing', 10000, true) || '以站点公开价格为准'
  let url: URL
  try { url = new URL(website) } catch { throw new Error('站点地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('站点地址无效')
  const date = new Date(`${foundedAt}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(foundedAt) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== foundedAt || foundedAt < '1000-01-01' || foundedAt > now.toISOString().slice(0, 10)) throw new Error('成立日期无效')
  return { name, website, foundedAt, description, models, pricing, notes }
}

const fields = `s.id, s.user_id, s.submitter_login, s.name, s.website, s.models, s.pricing, s.notes, s.status, s.review_note, s.created_at, s.updated_at,
  DATE_FORMAT(s.founded_at, '%Y-%m-%d') AS foundedAt, s.description, s.probe_notes AS probeNotes, s.probe_credential IS NOT NULL AS hasCredential, s.directory_listed AS directoryListed`
const ownership = '(BINARY s.owner_identity = BINARY ? OR (? IS NOT NULL AND s.user_id = ?))'
const flags = (row: Record<string, unknown>): Record<string, unknown> => ({ ...row, hasCredential: Boolean(row.hasCredential), directoryListed: Boolean(row.directoryListed) })
type Context = { database: Database; request: IncomingMessage; response: ServerResponse; url: URL; user: SiteOwner | null; localUserId: number | null; key: string; adminId?: number; onApproved?: () => void; readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>; json: (res: ServerResponse, status: number, payload: unknown) => void }

export async function handleSiteManagement(c: Context) {
  const { database: db, request: req, response: res, url, user, localUserId } = c
  const send = (status: number, payload: unknown) => c.json(res, status, payload)
  res.setHeader('cache-control', 'no-store')
  try {
    if (url.pathname === '/api/directory' && req.method === 'GET') {
      const sites = await db.prepare(`SELECT CONCAT('managed-', p.id) AS id, p.name, p.website, p.models, p.pricing, CASE WHEN l.image IS NOT NULL AND l.website = p.website THEN CONCAT('/api/site-logos/', p.id, '?v=', l.digest) ELSE NULL END AS logoUrl, s.description, DATE_FORMAT(s.founded_at, '%Y-%m-%d') AS foundedAt, s.updated_at AS updatedAt FROM managed_providers p JOIN submissions s ON s.id = p.submission_id LEFT JOIN site_logos l ON l.provider_id = p.id WHERE p.active = 1 AND s.status = 'approved' AND s.directory_listed = 1 ORDER BY p.id DESC`).all()
      return send(200, { sites })
    }
    if (!user) return send(401, { error: '请先登录' })
    const identity = ownerIdentity(user, localUserId)
    if (url.pathname === '/api/submissions' && req.method === 'POST') {
      let submission: ReturnType<typeof validateSubmission>
      try { submission = validateSubmission(await c.readJson(req)) } catch { return send(400, { error: '提交信息格式无效，请检查必填信息、地址和日期' }) }
      const s = submission
      const result = await db.prepare(`INSERT INTO submissions (user_id, local_owner_verified, owner_identity, submitter_login, name, website, founded_at, description, models, pricing, notes, review_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`).run(localUserId, localUserId !== null ? 1 : 0, identity, user.login, s.name, s.website, s.foundedAt, s.description, s.models, s.pricing, s.notes)
      return send(201, { ok: true, id: Number(result.insertId) })
    }
    if (url.pathname === '/api/user/sites' && req.method === 'GET') {
      const rows = await db.prepare(`SELECT ${fields}, p.active FROM submissions s LEFT JOIN managed_providers p ON p.submission_id = s.id WHERE ${ownership} ORDER BY s.created_at DESC`).all(identity, localUserId, localUserId)
      const sites = rows.map(flags)
      return send(200, { sites, stats: { total: sites.length, pending: sites.filter(s => s.status === 'pending').length, approved: sites.filter(s => s.status === 'approved').length } })
    }
    const logoRoute = url.pathname.match(/^\/api\/(user\/sites|admin\/providers)\/(\d+)\/logo(?:\/(preview|refetch|image))?$/)
    if (logoRoute) {
      const admin = logoRoute[1] === 'admin/providers'
      if (admin && !c.adminId) return send(403, { error: '无权访问管理员后台' })
      const id = Number(logoRoute[2])
      if (!Number.isSafeInteger(id) || id < 1) return send(400, { error: '站点编号无效' })
      const authorize = () => db.get(`SELECT p.id FROM managed_providers p JOIN submissions s ON s.id = p.submission_id WHERE ${admin ? 'p.id' : 's.id'} = ? AND s.status = 'approved' ${admin ? '' : `AND ${ownership}`}`, admin ? [id] : [id, identity, localUserId, localUserId])
      const provider = await authorize()
      if (!provider) return send(404, { error: '已审核的站点不存在或无权操作' })
      return handleLogoSettings({ database: db, request: req, response: res, providerId: Number(provider.id), identity, authorize, readJson: c.readJson, json: c.json }, logoRoute[3])
    }
    const listing = url.pathname.match(/^\/api\/user\/sites\/(\d+)\/listing$/)
    if (listing && req.method === 'PATCH') {
      const id = Number(listing[1])
      if (!Number.isSafeInteger(id) || id < 1) return send(400, { error: '站点编号无效' })
      let body: Record<string, unknown>
      try { body = await c.readJson(req) } catch { return send(400, { error: '请求格式无效' }) }
      if (typeof body.listed !== 'boolean') return send(400, { error: 'listed 必须为布尔值' })
      const owned = await db.transaction(async connection => {
        const site = await db.get(`SELECT s.id FROM submissions s WHERE s.id = ? AND s.status = 'approved' AND ${ownership} FOR UPDATE`, [id, identity, localUserId, localUserId], connection)
        if (!site) return false
        await db.run('UPDATE submissions SET directory_listed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [body.listed as boolean, id], connection)
        return true
      })
      return owned ? send(200, { ok: true, directoryListed: body.listed }) : send(404, { error: '已审核的自有站点不存在' })
    }
    if (c.adminId) {
      if (url.pathname === '/api/admin/submissions' && req.method === 'GET') return send(200, { submissions: (await db.prepare(`SELECT ${fields}, DATE_FORMAT(s.founded_at, '%Y-%m-%d') AS founded_at, s.probe_notes FROM submissions s ORDER BY s.created_at DESC`).all()).map(flags) })
      const review = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)$/)
      if (review && req.method === 'PATCH') {
        let body: Record<string, unknown>
        try { body = await c.readJson(req) } catch { return send(400, { error: '请求格式无效' }) }
        if (!['approved', 'rejected'].includes(String(body.status)) || (body.review_note !== undefined && (typeof body.review_note !== 'string' || body.review_note.length > 10000))) return send(400, { error: '审核信息无效' })
        const id = Number(review[1]), status = String(body.status), note = String(body.review_note ?? '').trim()
        const found = await db.transaction(async connection => {
          const existing = await db.get('SELECT id, name, website, models, pricing, notes FROM submissions WHERE id = ? FOR UPDATE', [id], connection)
          if (!existing) return false
          if (status === 'approved') {
            const provider = await db.get('SELECT id FROM managed_providers WHERE submission_id = ? FOR UPDATE', [id], connection)
            const values = [String(existing.name), String(existing.website), String(existing.models), String(existing.pricing), String(existing.notes)]
            // Never upsert on website: a duplicate must roll back rather than transfer ownership.
            if (provider) await db.run('UPDATE managed_providers SET name = ?, website = ?, models = ?, pricing = ?, notes = ?, active = 1 WHERE id = ?', [...values, Number(provider.id)], connection)
            else await db.run('INSERT INTO managed_providers (name, website, models, pricing, notes, submission_id) VALUES (?, ?, ?, ?, ?, ?)', [...values, id], connection)
          } else await db.run('UPDATE managed_providers SET active = 0 WHERE submission_id = ?', [id], connection)
          await db.run('UPDATE submissions SET status = ?, review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, note, id], connection)
          await db.run('INSERT INTO audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [c.adminId!, `submission.${status}`, 'submission', id, note], connection)
          return true
        })
        if (found && status === 'approved') c.onApproved?.()
        return found ? send(200, { ok: true }) : send(404, { error: '提交记录不存在' })
      }
    }
    return send(404, { error: '接口不存在' })
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return send(409, { error: '该站点地址已被其他记录使用' })
    return send(503, { error: '站点服务暂不可用' })
  }
}
