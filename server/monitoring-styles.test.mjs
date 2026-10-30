import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('directory history styles do not constrain the full-width task history', async () => {
  const css = await readFile(new URL('../src/directoryMonitoring.css', import.meta.url), 'utf8')
  const directory = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const tasks = await readFile(new URL('../src/AvailabilityMonitor.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /(?<![\w-])\.monitor-history(?:[\s.{:#>]|$)/)
  assert.match(css, /\.directory-monitor-history\s*\{/)
  assert.match(directory, /className=\{`directory-monitor-history /)
  assert.match(tasks, /className="monitor-history"/)
})

test('grouped model timelines stay visible outside collapsed details', async () => {
  const tasks = await readFile(new URL('../src/AvailabilityMonitor.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/AvailabilityMonitor.css', import.meta.url), 'utf8')
  const rowStart = tasks.indexOf('return <div className="monitor-model-row"')
  const detailStart = tasks.indexOf('<details className="monitor-model-detail">', rowStart)
  const row = tasks.slice(rowStart, detailStart)
  assert.ok(rowStart > 0 && detailStart > rowStart)
  assert.match(row, /className="monitor-model-row-timeline"/)
  assert.match(row, /<TaskBeats history=\{entry.data\} \/>/)
  assert.match(row, /暂无探测记录/)
  assert.match(row, /历史更新失败，当前为上次结果/)
  assert.doesNotMatch(tasks.slice(detailStart), /<TaskBeats/)
  assert.match(css, /\.monitor-model-row-timeline\s*\{\s*min-width: 0;/)
  assert.match(css, /\.monitor-model-row-timeline \.monitor-beats\s*\{[^}]*height: 32px;/)
  assert.match(css, /\.monitor-model-row-timeline \.monitor-beat\s*\{\s*flex: 0 1 6px; max-width: 6px;/)
  assert.match(css, /\.monitor-model-row-timeline\s*\{\s*grid-column: 1 \/ -1; grid-row: 2;/)
})
