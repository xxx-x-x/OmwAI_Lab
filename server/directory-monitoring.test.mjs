import assert from 'node:assert/strict'
import test from 'node:test'
import { createDirectoryMonitoring, unknownMonitoring } from '../dist-server/directory-monitoring.js'
import { handleSiteManagement } from '../dist-server/site-management.js'

const at = Date.parse('2026-10-30T06:00:00Z')
const config = { enabled: true, origins: ['https://api.example.com'] }
const task = { id: 'task-uuid', siteId: 7, monitor_id: 99, endpoint: 'https://api.example.com/v1/chat/completions', interval_seconds: 900, website: 'https://api.example.com' }
const monitor = { name: 'Lab:task-uuid', url: task.endpoint, type: 'json-query', active: true, parent: null, maxredirects: 0, interval: 900, headers: 'private-key', body: 'private-body' }
const beat = (status, ping, time = '2026-10-30 05:59:00') => ({ time, status, ping, msg: 'private-error', response: 'private-response' })
function fixture({ tasks = [task], beats = [beat(1, 123)], change = {}, fail, enabled = true } = {}) {
  let connections = 0, clock = at
  const calls = [], queries = []
  const db = { all: async sql => { queries.push(sql); return tasks } }
  const connect = async (_config, action) => {
    connections++
    if (fail === 'connect') throw new Error('private-token')
    return action(async (event, ...args) => {
      calls.push([event, ...args])
      if (fail === event) throw new Error('private-key')
      return event === 'getMonitor' ? { monitor: { ...monitor, ...change } } : { data: beats }
    })
  }
  return { load: createDirectoryMonitoring(db, { ...config, enabled }, connect, () => clock), calls, queries, connections: () => connections, tick: () => { clock += 60001 } }
}

test('real bounded UTC samples determine uptime and successful-response latency; errors never escape', async () => {
  const f = fixture({ beats: [beat(1, 100), beat(0, 999), beat(1, 300), beat(2, 888), beat(3, 777), beat(1, -1), beat(1, '999'), beat(1, 1, '2026-10-28 00:00:00'), beat(1, 2, '2026-10-31 00:00:00'), beat(1, 100, 'invalid')] })
  const value = (await f.load()).get(7)
  const { history, ...summary } = value
  assert.deepEqual(summary, { status: 'up', uptime: 80, latency: 200, samples: 5, monitors: 1, checkedAt: '2026-10-30T05:59:00.000Z', hours: 24 })
  assert.equal(history.length, 24)
  assert.deepEqual(history.at(-2), { time: '2026-10-30T05:00:00.000Z', status: 'down', samples: 5, uptime: 80, complete: true })
  assert.deepEqual(history.at(-1), { time: '2026-10-30T06:00:00.000Z', status: 'unknown', samples: 0, uptime: null, complete: false })
  assert.ok(history.slice(0, -2).every(period => period.status === 'unknown' && period.samples === 0))
  assert.equal(JSON.stringify(value).includes('private'), false)
  assert.deepEqual(f.calls, [['getMonitor', 99], ['getMonitorBeats', 99, 24]])
  assert.match(f.queries[0], /m.submission_id/)
  for (const filter of ["m.state = 'active'", "s.status = 'approved'", 's.directory_listed = 1', 'p.active = 1', 'BINARY p.website = BINARY s.website', 'LIMIT 200']) assert.ok(f.queries[0].includes(filter))
})

test('hourly status bars preserve chronological successes, failures and missing hours', async () => {
  const value = (await fixture({ beats: [beat(1, 100, '2026-10-30 03:10:00'), beat(0, 900, '2026-10-30 04:10:00'), beat(1, 100, '2026-10-30 05:59:00')] }).load()).get(7)
  assert.deepEqual(value.history.slice(-4).map(period => period.status), ['up', 'down', 'up', 'unknown'])
  assert.ok(value.history.every((period, index, history) => !index || Date.parse(period.time) - Date.parse(history[index - 1].time) === 3600000))
})

test('latest failure is red and all-failed samples have 0% uptime without fabricated latency', async () => {
  const value = (await fixture({ beats: [beat(0, 800)] }).load()).get(7)
  assert.equal(value.status, 'down'); assert.equal(value.uptime, 0); assert.equal(value.latency, null)
})

test('missing, stale, future, pending and maintenance histories stay unknown', async () => {
  for (const beats of [[], [beat(1, 100, '2026-10-30 02:00:00')], [beat(1, 100, '2026-10-31 00:00:00')], [beat(2, 0)], [beat(3, null)], [beat(null, 100)], [beat('1', 100)]]) {
    const value = (await fixture({ beats }).load()).get(7)
    assert.equal(value.status, 'unknown'); assert.equal(value.uptime, null); assert.equal(value.latency, null)
  }
})

test('identity, endpoint, active state and safe configuration must match exact saved monitor', async () => {
  for (const change of [{ name: 'Lab:other' }, { url: 'https://other.example.com' }, { type: 'http' }, { active: false }, { parent: 1 }, { maxredirects: 1 }, { interval: 60 }]) {
    const f = fixture({ change })
    assert.equal((await f.load()).get(7).status, 'unknown')
    assert.deepEqual(f.calls, [['getMonitor', 99]])
  }
  for (const overrides of [{ website: 'https://changed.example.com' }, { endpoint: 'https://api.example.com/v1/chat/completions?key=private' }, { endpoint: 'https://api.example.com/wrong' }, { monitor_id: null }]) {
    const f = fixture({ tasks: [{ ...task, ...overrides }] })
    assert.equal((await f.load()).get(7).status, 'unknown'); assert.equal(f.calls.length, 0)
  }
})

test('disabled and unreachable monitoring degrades safely, cache coalesces requests and expires', async () => {
  const disabled = fixture({ enabled: false })
  assert.equal((await disabled.load()).size, 0); assert.equal(disabled.connections(), 0)
  for (const fail of ['connect', 'getMonitor', 'getMonitorBeats']) {
    const f = fixture({ fail })
    const result = await f.load()
    assert.equal(result.get(7)?.status ?? 'unknown', 'unknown'); assert.equal(JSON.stringify([...result]).includes('private'), false)
  }
  const f = fixture()
  await Promise.all([f.load(), f.load(), f.load()]); await f.load()
  assert.equal(f.connections(), 1)
  f.tick(); await f.load(); assert.equal(f.connections(), 2)
})

test('multiple exact bindings aggregate samples rather than averaging monitor percentages', async () => {
  const tasks = [task, { ...task, id: 'second', monitor_id: 100 }]
  const db = { all: async () => tasks }
  const load = createDirectoryMonitoring(db, config, async (_config, action) => action(async (event, id) => event === 'getMonitor'
    ? { monitor: { ...monitor, name: id === 99 ? 'Lab:task-uuid' : 'Lab:second' } }
    : { data: id === 99 ? [beat(1, 100), beat(1, 300), beat(0, 999)] : [beat(0, null)] }), () => at)
  const result = (await load()).get(7)
  assert.equal(result.status, 'down'); assert.equal(result.uptime, 50); assert.equal(result.latency, 200); assert.equal(result.samples, 4); assert.equal(result.monitors, 2)
  const empty = fixture({ tasks: [] })
  assert.equal((await empty.load()).size, 0); assert.equal(empty.connections(), 0)
})

test('incomplete coverage cannot claim green; known failed bindings still make a site red', async () => {
  const tasks = [task, { ...task, id: 'other', monitor_id: 100 }]
  const partial = (await fixture({ tasks }).load()).get(7)
  assert.equal(partial.status, 'unknown'); assert.equal(partial.samples, 1)
  assert.equal((await fixture({ tasks, beats: [beat(0, null)] }).load()).get(7).status, 'down')
})

test('anonymous directory attaches only public summaries by submission ID, keeps existing fields and gracefully handles missing monitoring', async () => {
  const site = { id: 'managed-42', submissionId: 7, name: 'Site', invoice: 0, website: task.website }
  const summary = { ...unknownMonitoring(), status: 'up', uptime: 100, latency: 12, samples: 1, monitors: 1 }
  const context = { database: { prepare: () => ({ all: async () => [site] }) }, request: { method: 'GET' }, response: { setHeader() {} }, url: new URL('http://lab/api/directory'), user: null, localUserId: null, json: (_res, status, payload) => ({ status, payload }) }
  const result = await handleSiteManagement({ ...context, monitoring: async () => new Map([[7, summary]]) })
  assert.equal(result.status, 200)
  assert.deepEqual(result.payload.sites, [{ id: 'managed-42', name: 'Site', invoice: false, website: task.website, monitoring: summary }])
  const failed = await handleSiteManagement({ ...context, monitoring: async () => { throw new Error('private') } })
  assert.deepEqual(failed.payload.sites[0].monitoring, unknownMonitoring())
})
