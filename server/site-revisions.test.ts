import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.js'
import { handleSiteManagement } from './site-management.ts'

const proposal = { name: 'New', website: 'https://new.example.com', foundedAt: '2020-01-01', description: 'New description', models: 'New models', pricing: 'New prices', notes: 'New notes', invoice: true, billingType: '其他', billingDetails: 'New billing', informationValid: true, logoUrl: 'https://new.example.com/logo.png' }
function fixture() {
  let site: Record<string, unknown> = { id: 1, providerId: 2, website: 'https://old.example.com', name: 'Old', custom_url: null }
  let provider: Record<string, unknown> = { name: 'Old' }, logo: unknown = 'old-logo'
  let revisions: Record<string, unknown>[] = []
  let allowed = true, fail = '', refreshes = 0, active = Promise.resolve()
  const calls: string[] = []
  const db = {
    get: async (sql: string, values: unknown[]) => {
      calls.push(sql)
      if (sql.startsWith('SELECT submission_id')) return revisions.find(r => r.id === values[0])
      if (sql.includes('FROM submissions s')) return allowed ? { ...site } : undefined
      if (sql.startsWith('SELECT id FROM site_revisions')) return revisions.find(r => r.status === 'pending')
      if (sql.startsWith('SELECT * FROM site_revisions')) return revisions.find(r => r.id === values[0])
      throw new Error(sql)
    },
    run: async (sql: string, values: unknown[]) => {
      calls.push(sql)
      if (fail && sql.startsWith(fail)) throw Object.assign(new Error('DB failure'), { code: 'ER_DUP_ENTRY' })
      if (sql.startsWith('INSERT INTO site_revisions')) revisions.push({ id: revisions.length + 1, submission_id: values[0], proposal: values[1], status: 'pending', review_note: null })
      if (sql.startsWith('UPDATE submissions SET name')) site = { ...site, name: values[0], website: values[1] }
      if (sql.startsWith('UPDATE managed_providers')) provider = { name: values[0], website: values[1] }
      if (sql.startsWith('UPDATE site_logos')) logo = values[1]
      if (sql.startsWith('UPDATE site_revisions')) {
        const withdrawn = sql.includes("status = 'withdrawn'")
        const row = revisions.find(r => r.id === (withdrawn ? values[0] : values[3]))!
        row.status = withdrawn ? 'withdrawn' : values[0]
      }
      return { insertId: revisions.length }
    },
    all: async () => revisions,
    prepare: () => ({ all: async () => [] }),
    transaction: async (operation: (connection: unknown) => Promise<unknown>) => {
      const previous = active
      let release!: () => void
      active = new Promise<void>(resolve => { release = resolve })
      await previous
      const before = structuredClone({ site, provider, logo, revisions })
      try { return await operation({}) } catch (error) { ({ site, provider, logo, revisions } = before); throw error } finally { release() }
    },
  } as unknown as Database
  async function request(path: string, method: string, body: Record<string, unknown> = {}, adminId?: number, signedIn = true) {
    let status = 0, payload: unknown
    await handleSiteManagement({ database: db, request: { method } as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL('http://localhost' + path), user: signedIn ? { id: 7, login: 'owner', html_url: 'https://github.com/owner' } : null, localUserId: null, key: '', adminId, onApproved: () => { refreshes++ }, readJson: async () => body, json: (_res, code, value) => { status = code; payload = value } })
    return { status, payload }
  }
  return { request, calls, state: () => ({ site, provider, logo, revisions, refreshes }), deny: () => { allowed = false }, fail: (prefix: string) => { fail = prefix } }
}
const ownerPath = '/api/user/sites/1/revision'
const reviewPath = '/api/admin/site-revisions/1'

test('proposal submission writes only private revision data and serializes concurrent pending creation', async () => {
  const f = fixture()
  const responses = await Promise.all([f.request(ownerPath, 'POST', proposal), f.request(ownerPath, 'POST', proposal)])
  assert.deepEqual(responses.map(r => r.status), [201, 409])
  assert.equal(f.state().revisions.length, 1)
  assert.equal(f.state().site.name, 'Old')
  assert.equal(f.state().provider.name, 'Old')
  assert.equal(f.state().logo, 'old-logo')
  assert.equal(f.state().refreshes, 0)
  assert.match(f.calls[0], /s.status = 'approved'.*BINARY s.owner_identity.*FOR UPDATE/)
  assert.ok(!f.calls.some(sql => /UPDATE submissions|UPDATE managed_providers|site_logos SET/.test(sql)))
})

test('withdrawal leaves public data unchanged, permits resubmission, and prevents stale approval', async () => {
  const f = fixture()
  await f.request(ownerPath, 'POST', proposal)
  assert.equal((await f.request(ownerPath, 'DELETE')).status, 200)
  assert.equal((await f.request(reviewPath, 'PATCH', { status: 'approved' }, 3)).status, 409)
  assert.equal((await f.request(ownerPath, 'DELETE')).status, 409)
  assert.equal(f.state().site.name, 'Old')
  assert.equal(f.state().logo, 'old-logo')
  assert.equal((await f.request(ownerPath, 'POST', proposal)).status, 201)
})

test('rejection keeps approved public snapshot intact and allows new revision', async () => {
  const f = fixture()
  await f.request(ownerPath, 'POST', proposal)
  assert.equal((await f.request(reviewPath, 'PATCH', { status: 'rejected', review_note: 'No' }, 3)).status, 200)
  assert.equal(f.state().site.name, 'Old')
  assert.equal(f.state().provider.name, 'Old')
  assert.equal(f.state().logo, 'old-logo')
  assert.equal(f.state().refreshes, 0)
  assert.equal((await f.request(ownerPath, 'POST', proposal)).status, 201)
})

test('approval atomically updates both approved snapshots and logo configuration then schedules fetch', async () => {
  const f = fixture()
  await f.request(ownerPath, 'POST', proposal)
  assert.equal((await f.request(reviewPath, 'PATCH', { status: 'approved' }, 3)).status, 200)
  assert.equal(f.state().site.name, 'New')
  assert.equal(f.state().provider.name, 'New')
  assert.equal(f.state().logo, proposal.logoUrl)
  assert.equal(f.state().revisions[0].status, 'approved')
  assert.equal(f.state().refreshes, 1)
  assert.match(f.calls.find(sql => sql.startsWith('UPDATE submissions SET name'))!, /founded_at.*description.*invoice_supported.*billing_type.*billing_details/)
  assert.equal((await f.request(reviewPath, 'PATCH', { status: 'rejected' }, 3)).status, 409)
})

test('provider uniqueness and audit failure roll back all snapshots, logo, and review', async () => {
  for (const fail of ['UPDATE managed_providers', 'INSERT INTO audit_logs']) {
    const f = fixture()
    await f.request(ownerPath, 'POST', proposal)
    f.fail(fail)
    assert.equal((await f.request(reviewPath, 'PATCH', { status: 'approved' }, 3)).status, 409)
    assert.equal(f.state().site.name, 'Old')
    assert.equal(f.state().provider.name, 'Old')
    assert.equal(f.state().logo, 'old-logo')
    assert.equal(f.state().revisions[0].status, 'pending')
    assert.equal(f.state().refreshes, 0)
  }
})

test('validation and authorization fail closed without exposing or mutating public data', async () => {
  for (const change of [{ invoice: 'yes' }, { foundedAt: '2099-01-01' }, { name: '' }, { website: 'ftp://example.com' }, { logoUrl: 'http://127.0.0.1/logo.png' }, { logoUrl: 3 }, { billingType: 'bad' }]) {
    const f = fixture()
    assert.equal((await f.request(ownerPath, 'POST', { ...proposal, ...change })).status, 400)
    assert.equal(f.calls.length, 0)
  }
  const f = fixture()
  assert.equal((await f.request(ownerPath, 'POST', proposal, undefined, false)).status, 401)
  assert.equal((await f.request(reviewPath, 'PATCH', { status: 'approved' })).status, 403)
  assert.equal((await f.request('/api/admin/site-revisions', 'GET')).status, 403)
  f.deny()
  assert.equal((await f.request(ownerPath, 'POST', proposal)).status, 404)
  assert.equal((await f.request(ownerPath, 'DELETE')).status, 404)
})

test('logo omission preserves approved config and empty string selects website discovery', async () => {
  for (const logoUrl of [undefined, '']) {
    const f = fixture()
    assert.equal((await f.request(ownerPath, 'POST', { ...proposal, logoUrl })).status, 201)
    assert.equal(JSON.parse(String(f.state().revisions[0].proposal)).logoUrl, null)
  }
})
