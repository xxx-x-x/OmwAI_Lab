import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.js'
import { fetchLogoImage, fetchSiteLogo, validateLogoUrl, type SiteLogo } from './site-logo.ts'

export function createLogoFetchGate() {
  let active = 0
  const attempts = new Map<string, number>()
  return async <T>(key: string, cooldown: number, operation: () => Promise<T>): Promise<T> => {
    const now = Date.now()
    for (const [id, at] of attempts) if (now - at > 60_000) attempts.delete(id)
    if (active >= 4 || attempts.size >= 2000 || now - (attempts.get(key) ?? 0) < cooldown) throw new Error('LOGO_BUSY')
    attempts.set(key, now); active++
    try { return await operation() } finally { active-- }
  }
}
export const logoFetchGate = createLogoFetchGate()
export const logoDigest = (logo: SiteLogo) => createHash('sha256').update(logo.data).digest('hex')
type Context = {
  database: Database; request: IncomingMessage; response: ServerResponse; providerId: number; identity: string
  authorize: () => Promise<unknown>
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>
  json: (res: ServerResponse, status: number, value: unknown) => void
  image?: typeof fetchLogoImage; discover?: typeof fetchSiteLogo; gate?: typeof logoFetchGate
}
export async function handleLogoSettings(c: Context, action = '') {
  const { database: db, request: req, response: res, providerId: id } = c
  const send = (status: number, value: unknown) => c.json(res, status, value)
  res.setHeader('cache-control', 'no-store')
  if (!await c.authorize()) return send(404, { error: '已审核的站点不存在或无权操作' })
  const load = () => db.get('SELECT p.website, l.custom_url, COALESCE(l.revision, 0) AS revision, l.fetch_status, l.digest, l.image, l.content_type, l.website AS cachedWebsite FROM managed_providers p LEFT JOIN site_logos l ON l.provider_id = p.id WHERE p.id = ?', [id])
  const current = await load()
  if (!current) return send(404, { error: '站点不存在' })
  if (req.method === 'GET' && !action) return send(200, { customUrl: current.custom_url ?? '', revision: Number(current.revision), status: current.fetch_status ?? 'pending', hasImage: current.cachedWebsite === current.website && Boolean(current.image), digest: current.digest })
  if (req.method === 'GET' && action === 'image') {
    if (current.cachedWebsite !== current.website || !Buffer.isBuffer(current.image)) return send(404, { error: '暂无图标' })
    res.setHeader('content-type', String(current.content_type)); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('cross-origin-resource-policy', 'same-origin')
    res.end(current.image); return
  }
  if (!((req.method === 'POST' && ['preview', 'refetch'].includes(action)) || (req.method === 'PATCH' && !action))) return send(405, { error: '请求方法无效' })
  let body: Record<string, unknown>
  try { body = await c.readJson(req) } catch { return send(400, { error: '请求格式无效' }) }
  let custom: string | null = current.custom_url ? String(current.custom_url) : null
  if (action !== 'refetch') {
    if (typeof body.url !== 'string' || body.url.length > 2048) return send(400, { error: 'Logo URL 无效' })
    try { custom = body.url.trim() ? validateLogoUrl(body.url.trim()).href : null } catch { return send(400, { error: '仅支持公网 HTTP/HTTPS 标准端口图片地址（最多 2048 字符）' }) }
    if (action === 'preview' && !custom) return send(400, { error: '请输入图片地址' })
  }
  if (action !== 'preview' && (!Number.isSafeInteger(body.revision) || body.revision !== Number(current.revision))) return send(409, { error: '图标设置已变化，请重新加载后重试' })
  let logo: SiteLogo | null
  try {
    logo = await (c.gate ?? logoFetchGate)(`${c.identity}:${action === 'preview' ? 'preview' : 'mutation'}`, action === 'preview' ? 500 : 3000, () => custom ? (c.image ?? fetchLogoImage)(custom) : (c.discover ?? fetchSiteLogo)(String(current.website)))
  } catch { res.setHeader('retry-after', '3'); return send(429, { error: '抓取繁忙，请稍后重试' }) }
  if (action === 'preview') {
    if (!logo) return send(422, { error: '无法读取有效图片（支持 PNG/JPEG/GIF/WebP/ICO，最大 512 KiB）' })
    res.setHeader('content-type', logo.contentType); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('cross-origin-resource-policy', 'same-origin'); res.end(logo.data); return
  }
  if (!logo && custom && action !== 'refetch') return send(422, { error: '图片抓取失败，原图标和设置未更改' })
  const updated = await db.transaction(async connection => {
    // Recheck authorization and website after external I/O; never hold a transaction while fetching.
    const site = await db.get("SELECT p.website FROM managed_providers p JOIN submissions s ON s.id = p.submission_id WHERE p.id = ? AND s.status = 'approved' FOR UPDATE", [id], connection)
    if (!site || site.website !== current.website || !await c.authorize()) return false
    await db.run('INSERT IGNORE INTO site_logos (provider_id, website) VALUES (?, ?)', [id, String(site.website)], connection)
    const existing = await db.get('SELECT revision FROM site_logos WHERE provider_id = ? FOR UPDATE', [id], connection)
    if (Number(existing?.revision) !== Number(current.revision)) return false
    if (!logo && action === 'refetch') await db.run("UPDATE site_logos SET fetch_status = 'failed', attempted_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE provider_id = ?", [id], connection)
    else await db.run('UPDATE site_logos SET website = ?, custom_url = ?, image = ?, content_type = ?, digest = ?, fetch_status = ?, attempted_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE provider_id = ?', [String(current.website), custom, logo?.data ?? null, logo?.contentType ?? null, logo ? logoDigest(logo) : null, logo ? 'ok' : 'failed', id], connection)
    return true
  })
  if (!updated) return send(409, { error: '站点或图标设置已变化，请重新加载后重试' })
  return send(200, { ok: true, status: logo ? 'ok' : 'failed', message: logo ? '图标已保存' : action === 'refetch' ? '抓取失败，保留原图标，可重试' : '已恢复自动发现，暂无可用图标' })
}
