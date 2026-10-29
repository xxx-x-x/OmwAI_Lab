import type { Database } from './mysql.js'
import { validateSubmission } from './site-management.ts'

export async function updateAdminProvider(db: Database, id: number, body: Record<string, unknown>, adminId: number) {
  if (!Number.isSafeInteger(id) || id < 1) return { status: 400, error: '站点编号无效' }
  const editing = Object.keys(body).some(key => key !== 'active')
  let details: ReturnType<typeof validateSubmission> | undefined
  try {
    if (body.active !== undefined && typeof body.active !== 'boolean') throw new Error('启停状态无效')
    if (editing) details = validateSubmission({ ...body, informationValid: true })
  } catch (error) { return { status: 400, error: error instanceof Error ? error.message : '站点资料无效' } }
  return db.transaction(async connection => {
    const initial = await db.get('SELECT submission_id FROM managed_providers WHERE id = ?', [id], connection)
    if (!initial) return { status: 404, error: '站点不存在' }
    if (editing && !initial.submission_id) return { status: 409, error: '该历史站点未关联收录资料，暂不支持完整资料编辑' }
    // Lock the submission before the provider, matching the revision review lock order.
    if (initial.submission_id) {
      await db.get('SELECT id FROM submissions WHERE id = ? FOR UPDATE', [Number(initial.submission_id)], connection)
      if (editing && await db.get("SELECT id FROM site_revisions WHERE submission_id = ? AND status = 'pending' FOR UPDATE", [Number(initial.submission_id)], connection)) return { status: 409, error: '该站点有待审核修改，请先处理修改审核后再编辑资料' }
    }
    const site = await db.get('SELECT * FROM managed_providers WHERE id = ? FOR UPDATE', [id], connection)
    if (!site) return { status: 404, error: '站点不存在' }
    if (details) {
      const s = details
      await db.run('UPDATE managed_providers SET name = ?, website = ?, models = ?, pricing = ?, notes = ? WHERE id = ?', [s.name, s.website, s.models, s.pricing, s.notes, id], connection)
      if (site.submission_id) await db.run('UPDATE submissions SET name = ?, website = ?, models = ?, pricing = ?, notes = ?, founded_at = ?, description = ?, invoice_supported = ?, billing_type = ?, billing_details = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [s.name, s.website, s.models, s.pricing, s.notes, s.foundedAt, s.description, s.invoice, s.billingType, s.billingDetails, Number(site.submission_id)], connection)
      if (s.website !== site.website) {
        await db.run('INSERT IGNORE INTO site_logos (provider_id, website) VALUES (?, ?)', [id, s.website], connection)
        await db.run("UPDATE site_logos SET website = ?, image = NULL, content_type = NULL, digest = NULL, fetch_status = 'pending', attempted_at = '2000-01-01 00:00:00', revision = revision + 1 WHERE provider_id = ?", [s.website, id], connection)
      }
    }
    if (body.active !== undefined) await db.run('UPDATE managed_providers SET active = ? WHERE id = ?', [body.active ? 1 : 0, id], connection)
    await db.run('INSERT INTO audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [adminId, 'provider.update', 'provider', id, editing ? '管理员编辑站点公开资料' : body.active ? '启用站点' : '停用站点'], connection)
    return { status: 200 }
  })
}
