import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.js'
import { fetchSiteLogo, fetchLogoImage } from './site-logo.ts'

import { logoFetchGate } from './site-logo-settings.ts'

export function createSiteLogoCache(database: Database, download = fetchSiteLogo, downloadImage = fetchLogoImage) {
  let stopped = false
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const refresh = async () => {
    const sites = await database.all(`SELECT p.id, p.website, l.custom_url, COALESCE(l.revision, 0) AS revision FROM managed_providers p JOIN submissions s ON s.id = p.submission_id LEFT JOIN site_logos l ON l.provider_id = p.id WHERE s.status = 'approved' AND (l.provider_id IS NULL OR l.website <> p.website OR l.attempted_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY) AND (l.fetch_status = 'failed' OR l.image IS NULL OR l.attempted_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY))) ORDER BY l.attempted_at, p.id LIMIT 20`)
    for (const site of sites) {
      if (stopped) break
      const id = Number(site.id), website = String(site.website), revision = Number(site.revision ?? 0)
      await database.run('INSERT IGNORE INTO site_logos (provider_id, website) VALUES (?, ?)', [id, website])
      let logo
      try { logo = await logoFetchGate(`scheduled:${id}`, 0, () => site.custom_url ? downloadImage(String(site.custom_url)) : download(website)) } catch { continue }
      await database.run(`UPDATE site_logos l JOIN managed_providers p ON p.id = l.provider_id JOIN submissions s ON s.id = p.submission_id SET l.image = IF(?, ?, IF(l.website = ?, l.image, NULL)), l.content_type = IF(?, ?, IF(l.website = ?, l.content_type, NULL)), l.digest = IF(?, ?, IF(l.website = ?, l.digest, NULL)), l.website = ?, l.fetch_status = ?, l.attempted_at = CURRENT_TIMESTAMP, l.revision = l.revision + 1 WHERE l.provider_id = ? AND l.revision = ? AND p.website = ? AND s.status = 'approved'`, [Boolean(logo), logo?.data ?? null, website, Boolean(logo), logo?.contentType ?? null, website, Boolean(logo), logo ? createHash('sha256').update(logo.data).digest('hex') : null, website, website, logo ? 'ok' : 'failed', id, revision, website])
    }
  }
  const schedule = () => {
    if (stopped || running) return
    running = refresh().catch(() => { /* A database outage must not interrupt directory browsing or approval. */ }).finally(() => { running = undefined })
  }
  const start = () => {
    if (timer || stopped) return
    timer = setInterval(schedule, 60_000)
    timer.unref()
    schedule()
  }
  return {
    start,
    schedule,
    close: async () => { stopped = true; if (timer) clearInterval(timer); await running },
  }
}

export async function serveSiteLogo(database: Database, request: IncomingMessage, response: ServerResponse, id: number) {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.statusCode = 405
    response.setHeader('allow', 'GET, HEAD')
    response.end()
    return
  }
  const logo = await database.get(`SELECT l.image, l.content_type, l.digest FROM site_logos l JOIN managed_providers p ON p.id = l.provider_id JOIN submissions s ON s.id = p.submission_id WHERE p.id = ? AND p.website = l.website AND p.active = 1 AND s.status = 'approved' AND s.directory_listed = 1 AND l.image IS NOT NULL`, [id])
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('cross-origin-resource-policy', 'same-origin')
  if (!logo || !Buffer.isBuffer(logo.image) || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon'].includes(String(logo.content_type))) {
    response.statusCode = 404
    response.setHeader('cache-control', 'no-store')
    response.end()
    return
  }
  const etag = `"${logo.digest}"`
  response.setHeader('cache-control', 'public, no-cache')
  response.setHeader('etag', etag)
  if (request.headers['if-none-match'] === etag) {
    response.statusCode = 304
    response.end()
    return
  }
  response.setHeader('content-type', String(logo.content_type))
  response.setHeader('content-length', logo.image.length)
  response.statusCode = 200
  response.end(request.method === 'HEAD' ? undefined : logo.image)
}
