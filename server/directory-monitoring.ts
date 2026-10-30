import type { Database } from './mysql.js'
import { withUptime, type UptimeConfig } from './uptime.js'

export type MonitoringPeriod = { time: string; status: 'up' | 'down' | 'unknown'; samples: number; uptime: number | null; complete: boolean }
export type PublicMonitoring = { history?: MonitoringPeriod[]; status: 'up' | 'down' | 'unknown'; uptime: number | null; latency: number | null; samples: number; monitors: number; checkedAt: string | null; hours: number }
export const unknownMonitoring = (): PublicMonitoring => ({ status: 'unknown', uptime: null, latency: null, samples: 0, monitors: 0, checkedAt: null, hours: 24 })
const timestamp = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,3})?Z?$/.test(value)) return NaN
  return Date.parse(value.replace(' ', 'T').replace(/Z?$/, 'Z'))
}
function sameOrigin(website: unknown, endpoint: unknown) {
  try {
    const site = new URL(String(website)), target = new URL(String(endpoint))
    return !site.username && !site.password && !target.username && !target.password && site.origin === target.origin && target.protocol === 'https:' && target.pathname === '/v1/chat/completions' && !target.search && !target.hash
  } catch { return false }
}

// One process-local, coalesced snapshot; anonymous directory visits never create probes.
export function createDirectoryMonitoring(db: Database, config: UptimeConfig, connect = withUptime, now = Date.now) {
  let cached: Map<number, PublicMonitoring> | undefined, expires = 0, pending: Promise<Map<number, PublicMonitoring>> | undefined
  async function load() {
    const result = new Map<number, PublicMonitoring>()
    if (!config.enabled) return result
    const at = now()
    try {
      const tasks = await db.all(`SELECT m.id, m.submission_id AS siteId, m.monitor_id, m.endpoint, m.interval_seconds, s.website FROM lab_monitors m JOIN submissions s ON s.id = m.submission_id JOIN managed_providers p ON p.submission_id = s.id AND BINARY p.website = BINARY s.website WHERE m.state = 'active' AND m.monitor_id IS NOT NULL AND s.status = 'approved' AND s.directory_listed = 1 AND p.active = 1 ORDER BY m.id LIMIT 200`)
      const histories = new Map<number, Map<number, { samples: number; up: number; down: boolean; monitors: Set<string> }>>()
      const start = Math.floor(at / 3600000) * 3600000 - 23 * 3600000
      const grouped = new Map<number, { expected: number; valid: number; down: boolean; sum: number; pings: number; up: number; samples: number; latest: number }>()
      for (const task of tasks) {
        const id = Number(task.siteId)
        if (!grouped.has(id)) grouped.set(id, { expected: 0, valid: 0, down: false, sum: 0, pings: 0, up: 0, samples: 0, latest: 0 })
        grouped.get(id)!.expected++
      }
      if (tasks.length) await connect(config, async rpc => {
        let cursor = 0
        await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
          while (cursor < tasks.length) {
            const task = tasks[cursor++], summary = grouped.get(Number(task.siteId))!
            try {
              if (!sameOrigin(task.website, task.endpoint) || !config.origins.includes(new URL(String(task.endpoint)).origin) || !Number.isSafeInteger(Number(task.monitor_id)) || Number(task.monitor_id) <= 0) continue
              const { monitor } = await rpc('getMonitor', Number(task.monitor_id))
              if (!monitor || monitor.name !== `Lab:${task.id}` || monitor.url !== task.endpoint || monitor.type !== 'json-query' || !monitor.active || monitor.parent != null || Number(monitor.maxredirects) !== 0 || Number(monitor.interval) !== Number(task.interval_seconds)) continue
              const { data } = await rpc('getMonitorBeats', Number(task.monitor_id), 24)
              const beats = (data || []).map(row => ({ time: timestamp(row.time), status: row.status, ping: row.ping })).filter(row => Number.isFinite(row.time) && row.time <= at && row.time >= at - 86400000).sort((a, b) => a.time - b.time).slice(-300)
              const history = histories.get(Number(task.siteId)) ?? new Map<number, { samples: number; up: number; down: boolean; monitors: Set<string> }>()
              histories.set(Number(task.siteId), history)
              for (const beat of beats) {
                if (beat.status !== 0 && beat.status !== 1) continue
                const hour = Math.floor((beat.time - start) / 3600000)
                if (hour < 0 || hour >= 24) continue
                const period = history.get(hour) ?? { samples: 0, up: 0, down: false, monitors: new Set<string>() }
                period.samples++; period.up += beat.status; period.down ||= beat.status === 0; period.monitors.add(String(task.id))
                history.set(hour, period)
              }
              const latest = beats.at(-1)
              if (!latest || at - latest.time > Math.min(86400000, Number(task.interval_seconds) * 2000 + 60000) || ![0, 1].includes(Number(latest.status)) || typeof latest.status !== 'number') continue
              summary.valid++; summary.down ||= latest.status === 0; summary.latest = Math.max(summary.latest, latest.time)
              for (const beat of beats) {
                if (beat.status !== 0 && beat.status !== 1) continue
                summary.samples++; summary.up += beat.status
                if (beat.status === 1 && typeof beat.ping === 'number' && Number.isFinite(beat.ping) && beat.ping >= 0) { summary.sum += beat.ping; summary.pings++ }
              }
            } catch { /* A missing, changed or unreachable binding stays unknown, never expose upstream errors. */ }
          }
        }))
      })
      for (const [id, value] of grouped) result.set(id, {
        status: value.down ? 'down' : value.valid === value.expected ? 'up' : 'unknown',
        uptime: value.samples ? Math.round(value.up / value.samples * 10000) / 100 : null,
        latency: value.pings ? Math.round(value.sum / value.pings) : null,
        samples: value.samples, monitors: value.valid, checkedAt: value.latest ? new Date(value.latest).toISOString() : null, hours: 24,
        history: Array.from({ length: 24 }, (_, hour) => {
          const period = histories.get(id)?.get(hour)
          return { time: new Date(start + hour * 3600000).toISOString(), status: period?.down ? 'down' : period?.monitors.size === value.expected ? 'up' : 'unknown', complete: period?.monitors.size === value.expected, samples: period?.samples ?? 0, uptime: period?.samples ? period.up / period.samples * 100 : null }
        }),
      })
    } catch { return new Map<number, PublicMonitoring>() }
    return result
  }
  return async () => {
    if (cached && now() < expires) return cached
    if (!pending) pending = load().then(value => { cached = value; expires = now() + 60000; return value }).finally(() => { pending = undefined })
    return pending
  }
}
