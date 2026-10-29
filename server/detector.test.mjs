import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createDetector } from '../dist-server/detector.js'
import { createBackend } from '../dist-server/backend.js'

const id = '01234567-0123-4123-8123-0123456789ab'
const env = { DETECTOR_URL: 'http://127.0.0.1:8787', DETECTOR_ADMIN_TOKEN: 'a'.repeat(32), DETECTOR_ACCESS_SECRET: 'b'.repeat(32) }
async function serve(t, handle) {
  const server = createServer((req, res) => { void handle(req, res) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done) }))
  return `http://127.0.0.1:${server.address().port}`
}
test('anonymous proxy creates isolated tasks without exposing operator token or input', async t => {
  const calls = []
  const handler = createDetector(env, async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/capabilities')) return Response.json({ detection: {}, fingerprint: { models: [] }, csrfToken: 'private' })
    if (options.method === 'POST') return Response.json({ id, state: 'queued' }, { status: 202 })
    if (options.method === 'DELETE') return Response.json({ id, cancellationRequested: true }, { status: 202 })
    return Response.json({ id, state: 'completed', input: { baseUrl: 'private endpoint' }, report: { identityStatus: 'not_evaluated' } })
  })
  const base = await serve(t, handler)
  const caps = await fetch(base + '/api/detector/capabilities')
  assert.equal(caps.status, 200); assert.equal((await caps.json()).csrfToken, undefined)
  const post = (body, route = 'tasks') => fetch(base + '/api/detector/' + route, { method: 'POST', body: JSON.stringify(body) })
  assert.equal((await post({})).status, 400)
  const created = await post({ consent: true, apiKey: 'visitor-key', baseUrl: 'https://example.com/v1', model: 'test', protocol: 'responses' })
  assert.equal(created.status, 202)
  const task = await created.json()
  assert.ok(task.accessToken); assert.ok(!JSON.stringify(task).includes(env.DETECTOR_ADMIN_TOKEN))
  assert.equal(calls.at(-1).options.headers.authorization, `Bearer ${env.DETECTOR_ADMIN_TOKEN}`)
  assert.equal(JSON.parse(calls.at(-1).options.body).consent, undefined)
  const path = base + '/api/detector/tasks/' + id
  for (const method of ['GET', 'DELETE']) {
    assert.equal((await fetch(path, { method })).status, 404)
    assert.equal((await fetch(path, { method, headers: { 'x-detector-access': task.accessToken + 'x' } })).status, 404)
  }
  const report = await fetch(path, { headers: { 'x-detector-access': task.accessToken } })
  assert.equal(report.headers.get('cache-control'), 'no-store')
  const data = await report.json(); assert.equal(data.input, undefined); assert.equal(data.report.identityStatus, 'not_evaluated')
  assert.equal((await fetch(path, { method: 'DELETE', headers: { 'x-detector-access': task.accessToken } })).status, 202)
  assert.equal((await post({ consent: true })).status, 429)
})
test('fingerprint budget is forwarded unchanged and upstream errors are sanitized', async t => {
  const base = await serve(t, createDetector(env, async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.confirmRequests, 30); assert.equal(body.tier, 'low'); assert.equal(body.requestModel, 'fixed-model')
    return Response.json({ error: 'private-upstream-secret' }, { status: 500 })
  }))
  const response = await fetch(base + '/api/detector/fingerprint-tasks', { method: 'POST', body: JSON.stringify({ consent: true, confirmRequests: 30, tier: 'low', requestModel: 'fixed-model' }) })
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('private-upstream-secret'))
})
test('public backend requires no login but enforces write origin and fails closed when disabled', async t => {
  const backend = createBackend({})
  t.after(() => backend.close())
  const base = await serve(t, (req, res) => backend.handle(req, res, () => { res.statusCode = 404; res.end() }))
  assert.equal((await fetch(base + '/api/detector/capabilities')).status, 503)
  assert.equal((await fetch(base + '/api/detector/tasks', { method: 'POST' })).status, 403)
  assert.equal((await fetch(base + '/api/detector/tasks', { method: 'POST', headers: { origin: base } })).status, 503)
})
test('proxy rejects plaintext remote detector and credential-bearing URLs', () => {
  for (const url of ['http://remote.example', 'https://user:password@example.com', 'https://example.com/private']) assert.throws(() => createDetector({ ...env, DETECTOR_URL: url }))
})
