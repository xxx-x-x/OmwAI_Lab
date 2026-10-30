import assert from 'node:assert/strict'
import { test } from 'node:test'
import { beatLabels, historySummary, orderedBeats } from '../src/availabilityHistory.ts'

test('empty history does not imply healthy uptime or zero latency', () => {
  assert.deepEqual(historySummary([]), { successRate: '—', averagePing: '—' })
})

test('summary counts only successful beats and averages valid durations including zero', () => {
  const beats = [
    { time: '2026-10-30 02:00:00', status: 1, ping: 0 },
    { time: '2026-10-30 01:00:00', status: 0, ping: 100 },
    { time: '2026-10-30 03:00:00', status: 2, ping: null },
    { time: '2026-10-30 04:00:00', status: 3, ping: -1 },
    { time: '2026-10-30 05:00:00', status: null, ping: Infinity },
  ]
  assert.deepEqual(historySummary(beats), { successRate: '20.0%', averagePing: '50 ms' })
  assert.equal(orderedBeats(beats)[0].time, '2026-10-30 01:00:00')
  assert.equal(beats[0].time, '2026-10-30 02:00:00')
  assert.deepEqual(Object.values(beatLabels), ['失败', '成功', '待定', '维护'])
})
