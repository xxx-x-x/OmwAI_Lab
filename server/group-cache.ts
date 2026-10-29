import type { Database } from './mysql.js'
import { fillMissingPublicGroups, type PublicGroup } from './public-groups.ts'
import { fetchPublicPricing, publicPricingUrl } from './public-pricing.ts'

export async function readGroupSnapshot(db: Database, website: string) {
  const site = await db.get("SELECT s.id FROM submissions s JOIN managed_providers p ON p.submission_id = s.id WHERE BINARY s.website = BINARY ? AND s.status = 'approved' AND s.directory_listed = 1 AND p.active = 1 LIMIT 1", [website])
  if (!site) return null
  const snapshot = await db.get('SELECT groups_json AS groupsJson, detected_at AS detectedAt, source_url AS source FROM site_group_snapshots WHERE submission_id = ? AND BINARY website = BINARY ?', [site.id, website])
  if (snapshot) return { groups: (typeof snapshot.groupsJson === 'string' ? JSON.parse(snapshot.groupsJson) : snapshot.groupsJson) as PublicGroup[], detectedAt: snapshot.detectedAt, source: snapshot.source, cacheStatus: 'saved' }
  const rows = await db.prepare('SELECT group_name AS name, multiplier AS ratio, detected_at AS detectedAt, source_url AS source FROM site_public_groups WHERE submission_id = ? AND BINARY website = BINARY ? ORDER BY group_name').all(site.id, website)
  return { groups: rows.map(row => ({ name: String(row.name), ratio: Number(row.ratio), type: '模型分组', description: '', modelCount: 0 })), detectedAt: rows[0]?.detectedAt ?? null, source: rows[0]?.source ?? null, cacheStatus: rows.length ? 'saved' : 'pending' }
}

export function createGroupCache(db: Database, fetchPricing = fetchPublicPricing) {
  let stopped = false
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const refresh = async () => {
    const sites = await db.prepare(`SELECT s.id AS siteId, s.website, ps.platform, NULL AS groupMultiplier FROM submissions s JOIN managed_providers p ON p.submission_id = s.id LEFT JOIN site_pricing_settings ps ON ps.submission_id = s.id LEFT JOIN site_group_fetches f ON f.submission_id = s.id LEFT JOIN site_group_snapshots g ON g.submission_id = s.id WHERE s.status = 'approved' AND s.directory_listed = 1 AND p.active = 1 AND (f.submission_id IS NULL OR BINARY f.website <> BINARY s.website OR f.attempted_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)) AND (g.submission_id IS NULL OR BINARY g.website <> BINARY s.website OR g.detected_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)) ORDER BY f.attempted_at, s.id LIMIT 4`).all()
    if (!stopped) await fillMissingPublicGroups(db, sites, fetchPricing, publicPricingUrl)
  }
  const schedule = () => {
    if (stopped || running) return
    running = refresh().catch(() => { /* Keep the previous snapshot during database or upstream outages. */ }).finally(() => { running = undefined })
  }
  return {
    start: () => {
      if (stopped || timer) return
      timer = setInterval(schedule, 60_000)
      timer.unref()
      schedule()
    },
    schedule,
    close: async () => { stopped = true; if (timer) clearInterval(timer); await running },
  }
}
