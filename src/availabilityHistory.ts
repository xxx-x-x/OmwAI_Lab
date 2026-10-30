export type Beat = { time: string; status: number | null; ping: number | null }
export const beatLabels: Record<number, string> = { 0: '失败', 1: '成功', 2: '待定', 3: '维护' }

export function orderedBeats(beats: Beat[]) {
  return [...beats].sort((a, b) => a.time.localeCompare(b.time))
}

export function historySummary(beats: Beat[]) {
  const durations = beats.flatMap(beat => beat.ping !== null && Number.isFinite(beat.ping) && beat.ping >= 0 ? [beat.ping] : [])
  return {
    successRate: beats.length ? `${(100 * beats.filter(beat => beat.status === 1).length / beats.length).toFixed(1)}%` : '—',
    averagePing: durations.length ? `${Math.round(durations.reduce((sum, ping) => sum + ping, 0) / durations.length)} ms` : '—',
  }
}
