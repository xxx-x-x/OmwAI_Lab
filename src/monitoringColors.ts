export function monitoringColor(uptime: number | null, complete: boolean) {
  if (!complete || uptime == null || !Number.isFinite(uptime) || uptime < 0 || uptime > 100) return 'unknown'
  return uptime === 100 ? 'up' : uptime >= 95 ? 'light-green' : uptime >= 50 ? 'orange' : 'down'
}
