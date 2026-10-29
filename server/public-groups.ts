import type { Database } from './mysql.js'

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const validName = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v === v.trim() && v.length <= 191 && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const validRatio = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
export type PublicGroup = { name: string; ratio: number; type: string; description: string; modelCount: number }

export function parsePublicGroups(payload: unknown, platform = 'new-api'): PublicGroup[] {
  if (!object(payload)) throw new Error('未发现兼容的公开分组接口')
  if (platform === 'sub2api') {
    if (payload.code !== 0 || !object(payload.data) || !Array.isArray(payload.data.groups)) throw new Error('未发现兼容的公开分组接口')
    const groups = payload.data.groups.flatMap(g => object(g) && validName(g.name) && validRatio(g.rate_multiplier) && g.user_rate_multiplier == null && !g.peak_rate_enabled ? [{ name: g.name, ratio: g.rate_multiplier, type: '模型分组', description: '', modelCount: Array.isArray(g.models) ? g.models.length : 0 }] : [])
    return unique(groups)
  }
  if (payload.success !== true || !object(payload.group_ratio)) throw new Error('未发现兼容的公开分组接口')
  const descriptions = object(payload.usable_group) ? payload.usable_group : {}
  const users = object(payload.user_groups) ? payload.user_groups : {}
  const auto = new Set(Array.isArray(payload.auto_groups) ? payload.auto_groups : [])
  const counts = new Map<string, number>()
  for (const model of Array.isArray(payload.data) ? payload.data : []) {
    if (!object(model) || !Array.isArray(model.enable_groups)) continue
    for (const group of new Set(model.enable_groups.filter(validName))) counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return unique(Object.entries(payload.group_ratio).flatMap(([name, ratio]) => validName(name) && validRatio(ratio) ? [{ name, ratio, type: auto.has(name) ? '自动分组' : users[name] === true ? '用户等级' : '模型分组', description: typeof descriptions[name] === 'string' ? descriptions[name] : '', modelCount: counts.get(name) ?? 0 }] : []))
}

function unique(groups: PublicGroup[]) {
  if (groups.length > 10000 || new Set(groups.map(g => g.name)).size !== groups.length) throw new Error('无效的公开分组数据')
  return groups.sort((a, b) => a.type.localeCompare(b.type, 'zh-CN') || a.ratio - b.ratio || a.name.localeCompare(b.name, 'zh-CN'))
}

export async function storePublicGroups(db: Database, siteId: number, website: string, source: URL, groups: PublicGroup[], detectedAt: Date) {
  if (new URL(website).origin !== source.origin) throw new Error('分组来源与站点不匹配')
  await db.transaction(async connection => {
    const site = await db.get("SELECT id FROM submissions WHERE id = ? AND BINARY website = BINARY ? AND status = 'approved' FOR UPDATE", [siteId, website], connection)
    if (!site) return
    const latest = await db.get('SELECT MAX(detected_at) AS detectedAt FROM site_public_groups WHERE submission_id = ?', [siteId], connection)
    if (latest?.detectedAt && new Date(String(latest.detectedAt)).getTime() > detectedAt.getTime()) return
    const snapshot = await db.get('SELECT detected_at AS detectedAt FROM site_group_snapshots WHERE submission_id = ?', [siteId], connection)
    if (snapshot?.detectedAt && new Date(String(snapshot.detectedAt)).getTime() > detectedAt.getTime()) return
    await db.run('INSERT INTO site_group_snapshots (submission_id, website, groups_json, detected_at, source_url) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE website = VALUES(website), groups_json = VALUES(groups_json), detected_at = VALUES(detected_at), source_url = VALUES(source_url)', [siteId, website, JSON.stringify(groups), detectedAt, source.href], connection)
    await db.run('DELETE FROM site_public_groups WHERE submission_id = ?', [siteId], connection)
    for (const group of groups) await db.run('INSERT INTO site_public_groups (submission_id, website, group_name, multiplier, detected_at, source_url) VALUES (?, ?, ?, ?, ?, ?)', [siteId, website, group.name, group.ratio, detectedAt, source.href], connection)
  })
}

export async function cacheProbedGroups(db: Database, source: URL, groups: PublicGroup[], detectedAt: Date) {
  const sites = await db.prepare("SELECT s.id, s.website FROM submissions s JOIN managed_providers p ON p.submission_id = s.id WHERE s.status = 'approved' AND s.directory_listed = 1 AND p.active = 1").all()
  for (const site of sites) {
    try { if (new URL(String(site.website)).origin !== source.origin) continue } catch { continue }
    await storePublicGroups(db, Number(site.id), String(site.website), source, groups, detectedAt)
  }
}

export const groupJoin = 'LEFT JOIN site_public_groups gm ON gm.submission_id = s.id AND BINARY gm.group_name = BINARY q.group_name AND BINARY gm.website = BINARY s.website'
export const groupFields = `COALESCE(q.group_multiplier, gm.multiplier) AS groupMultiplier, CASE WHEN q.group_multiplier IS NOT NULL THEN q.synced_at ELSE gm.detected_at END AS groupMultiplierDetectedAt, CASE WHEN q.group_multiplier IS NOT NULL THEN q.source_url ELSE gm.source_url END AS groupMultiplierSourceUrl, CASE WHEN q.group_multiplier IS NOT NULL THEN 'price-snapshot' WHEN gm.multiplier IS NOT NULL THEN 'group-probe' ELSE NULL END AS groupMultiplierSource`

export async function fillMissingPublicGroups(db: Database, rows: Record<string, unknown>[], fetchPricing: (url: URL) => Promise<unknown>, pricingUrl: (website: string, platform: string) => URL) {
  const sites = [...new Map(rows.filter(r => r.groupMultiplier == null).map(r => [Number(r.siteId), r])).values()]
  let fetchCount = 0
  const workers = Array.from({ length: Math.min(4, sites.length) }, async () => {
    for (let site = sites.shift(); site; site = sites.shift()) {
      if (fetchCount >= 4) break
      try {
        const id = Number(site.siteId), website = String(site.website)
        const claimed = await db.transaction(async connection => {
          await db.get('SELECT id FROM submissions WHERE id = ? FOR UPDATE', [id], connection)
          const previous = await db.get('SELECT website, attempted_at AS attemptedAt FROM site_group_fetches WHERE submission_id = ?', [id], connection)
          if (previous?.website === website && Date.now() - new Date(String(previous.attemptedAt)).getTime() < 86400000) return false
          const snapshot = await db.get('SELECT website, detected_at AS detectedAt FROM site_group_snapshots WHERE submission_id = ?', [id], connection)
          if (snapshot?.website === website && Date.now() - new Date(String(snapshot.detectedAt)).getTime() < 86400000) return false
          await db.run('INSERT INTO site_group_fetches (submission_id, website, attempted_at) VALUES (?, ?, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE website = VALUES(website), attempted_at = VALUES(attempted_at)', [id, website], connection)
          return true
        })
        if (!claimed) continue
        if (fetchCount >= 4) break
        fetchCount++
        const platform = String(site.platform ?? 'new-api'), source = pricingUrl(website, platform)
        const payload = await fetchPricing(source), detectedAt = new Date()
        await storePublicGroups(db, id, website, source, parsePublicGroups(payload, platform), detectedAt)
      } catch { /* An unavailable public interface must not hide existing prices. */ }
    }
  })
  await Promise.all(workers)
}
