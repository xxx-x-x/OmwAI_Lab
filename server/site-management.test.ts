import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'
import type { Database } from './mysql.ts'
import { initializeDatabase } from './mysql.ts'
import { handleSiteManagement, ownerIdentity, validateSubmission } from './site-management.ts'

const key = 'ab'.repeat(32)
const submission = { name: 'Site', website: 'https://example.com', foundedAt: '2020-02-29', description: 'Description', models: 'OpenAI', informationValid: true }
const user = { id: 7, login: 'same-login', html_url: 'https://github.com/same-login' }
type Call = { sql: string; values: unknown[] }
function fixture() {
  const calls: Call[] = []
  let rows: Record<string, unknown>[] = []
  let getResult: Record<string, unknown> | undefined = { id: 1, ...submission, notes: '', pricing: 'price' }
  let failOn = '', committed = false, rolledBack = false, logoRefreshes = 0
  const record = (sql: string, values: unknown[]) => { calls.push({ sql, values }); if (failOn && sql.startsWith(failOn)) throw Object.assign(new Error('private database details'), { code: 'ER_DUP_ENTRY' }) }
  const db = {
    prepare: (sql: string) => ({
      all: async (...values: unknown[]) => { record(sql, values); return rows },
      run: async (...values: unknown[]) => { record(sql, values); return { insertId: 1 } },
    }),
    get: async (sql: string, values: unknown[]) => { record(sql, values); return sql.includes('FROM managed_providers') ? undefined : getResult },
    run: async (sql: string, values: unknown[]) => { record(sql, values); return { affectedRows: 1 } },
    transaction: async (fn: (connection: unknown) => Promise<unknown>) => { try { const result = await fn({}); committed = true; return result } catch (error) { rolledBack = true; throw error } },
  } as unknown as Database
  async function request(path: string, method = 'GET', body: Record<string, unknown> = {}, options: { local?: number | null; signedIn?: boolean; key?: string; adminId?: number } = {}) {
    let status = 0, payload: unknown
    await handleSiteManagement({ database: db, request: { method } as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL(`http://localhost${path}`), user: options.signedIn === false ? null : user, localUserId: options.local ?? null, key: options.key ?? key, adminId: options.adminId, onApproved: () => { assert.equal(committed, true); logoRefreshes++ }, readJson: async () => body, json: (_res, code, value) => { status = code; payload = value } })
    return { status, payload: payload as Record<string, unknown> }
  }
  return { calls, request, setRows: (value: Record<string, unknown>[]) => { rows = value }, setOwned: (value: typeof getResult) => { getResult = value }, fail: (prefix: string) => { failOn = prefix }, logoRefreshes: () => logoRefreshes, state: () => ({ committed, rolledBack }) }
}

test('submission validates required strings, limits, HTTP URLs and real nonfuture dates', () => {
  assert.equal(validateSubmission(submission).pricing, '以站点公开价格为准')
  assert.equal(validateSubmission({ ...submission, pricing: 'legacy', website: 'http://example.com' }).pricing, 'legacy')
  for (const field of ['name', 'website', 'foundedAt', 'description', 'models']) {
    for (const value of [undefined, '', ' ', 5, null]) assert.throws(() => validateSubmission({ ...submission, [field]: value }), field)
  }
  for (const change of [{ website: 'ftp://example.com' }, { website: 'https://user:password@example.com' }, { website: 'not-url' }, { foundedAt: '2025-02-29' }, { foundedAt: '2999-01-01' }, { foundedAt: '2020-2-29' }, { name: 'a'.repeat(256) }, { description: 'a'.repeat(10001) }, { pricing: 3 }]) assert.throws(() => validateSubmission({ ...submission, ...change }))
})

test('submission requires only explicit public-information confirmation', () => {
  for (const value of [false, undefined, 'true', 1]) assert.throws(() => validateSubmission({ ...submission, informationValid: value }))
  assert.equal(validateSubmission(submission).name, 'Site')
})

test('stable namespaced ownership never uses login and preserves full OAuth IDs', () => {
  assert.equal(ownerIdentity(user, 7), 'local:7')
  assert.equal(ownerIdentity(user, null), 'github:7')
  assert.equal(ownerIdentity({ ...user, html_url: '', id: '123456789012345678901' }, null), 'google:123456789012345678901')
  assert.equal(ownerIdentity({ ...user, login: 'renamed' }, null), 'github:7')
})

test('public submission succeeds without encryption and ignores legacy credential fields', async () => {
  for (const configured of ['', 'invalid', key]) {
    const f = fixture()
    const result = await f.request('/api/submissions', 'POST', { ...submission, probeKey: 'must-not-save', probeGroup: 'private-group', probeNotes: 'private-note' }, { local: 8, key: configured })
    assert.equal(result.status, 201)
    const call = f.calls[0]
    assert.deepEqual(call.values.slice(0, 4), [8, 1, 'local:8', user.login])
    assert.match(call.sql, /review_note/)
    assert.doesNotMatch(call.sql, /probe_credential|probe_group|probe_consent/)
    assert.ok(!call.values.includes('must-not-save') && !call.values.includes('private-group') && !call.values.includes('private-note'))
    assert.ok(call.values.includes('以站点公开价格为准'))
  }
})

test('invalid or unauthenticated submissions do not write to the database', async () => {
  const f = fixture()
  assert.equal((await f.request('/api/submissions', 'POST', {})).status, 400)
  assert.equal((await f.request('/api/submissions', 'POST', submission, { signedIn: false })).status, 401)
  assert.equal(f.calls.length, 0)
})

test('owner listing retains legacy fields, boolean flags, OAuth scope and legacy local user_id access', async () => {
  const f = fixture()
  f.setRows([{ id: 1, status: 'approved', review_note: '', created_at: 'date', active: 1, foundedAt: '2020-02-29', description: 'description', probeNotes: 'private', hasCredential: 1, directoryListed: 0 }])
  const result = await f.request('/api/user/sites')
  assert.deepEqual(result.payload.stats, { total: 1, pending: 0, approved: 1 })
  assert.deepEqual(f.calls[0].values, ['github:7', null, null])
  assert.match(f.calls[0].sql, /s.user_id = \?/)
  assert.match(f.calls[0].sql, /BINARY s.owner_identity/)
  assert.doesNotMatch(f.calls[0].sql, /SELECT \*|s\.probe_credential,/)
  assert.equal((result.payload.sites as Record<string, unknown>[])[0].hasCredential, true)
  assert.equal((result.payload.sites as Record<string, unknown>[])[0].directoryListed, false)
  await f.request('/api/user/sites', 'GET', {}, { local: 8 })
  assert.deepEqual(f.calls[1].values, ['local:8', 8, 8])
})

test('listing consent is strictly boolean and requires a locked approved owned record', async () => {
  for (const listed of ['true', 1, null, undefined]) {
    const f = fixture()
    assert.equal((await f.request('/api/user/sites/1/listing', 'PATCH', { listed })).status, 400)
    assert.equal(f.calls.length, 0)
  }
  for (const local of [null, 8]) {
    const f = fixture()
    assert.equal((await f.request('/api/user/sites/1/listing', 'PATCH', { listed: true }, { local })).status, 200)
    assert.match(f.calls[0].sql, /s.status = 'approved'.*FOR UPDATE/)
    assert.deepEqual(f.calls[0].values, [1, local ? 'local:8' : 'github:7', local, local])
    assert.deepEqual(f.calls[1].values, [true, 1])
    assert.equal(f.state().committed, true)
    f.setOwned(undefined)
    assert.equal((await f.request('/api/user/sites/1/listing', 'PATCH', { listed: false }, { local })).status, 404)
  }
})

test('public directory projects only public fields and requires active approved opt-in', async () => {
  const f = fixture()
  assert.equal((await f.request('/api/directory', 'GET', {}, { signedIn: false })).status, 200)
  const sql = f.calls[0].sql
  assert.match(sql, /CONCAT\('managed-', p.id\)/)
  assert.match(sql, /p.active = 1 AND s.status = 'approved' AND s.directory_listed = 1/)
  assert.doesNotMatch(sql, /credential|probe_notes|notes|owner_identity|user_id|submitter_login|SELECT \*/)
})

test('admin listing excludes encrypted secret and exposes probe notes and credential presence', async () => {
  const f = fixture()
  assert.equal((await f.request('/api/admin/submissions', 'GET', {}, { adminId: 8 })).status, 200)
  assert.match(f.calls[0].sql, /s.probe_notes AS probeNotes/)
  assert.match(f.calls[0].sql, /AS founded_at, s.probe_notes FROM/)
  assert.match(f.calls[0].sql, /s.probe_credential IS NOT NULL AS hasCredential/)
  assert.doesNotMatch(f.calls[0].sql, /SELECT \*|s\.probe_credential,/)
})

test('approval and rejection change providers and audit in the same transaction without auto listing', async () => {
  for (const status of ['approved', 'rejected']) {
    const f = fixture()
    assert.equal((await f.request('/api/admin/submissions/1', 'PATCH', { status }, { adminId: 8 })).status, 200)
    assert.equal(f.state().committed, true)
    assert.equal(f.logoRefreshes(), status === 'approved' ? 1 : 0)
    assert.match(f.calls[0].sql, /FOR UPDATE/)
    assert.ok(f.calls.some(c => c.sql.startsWith(status === 'approved' ? 'INSERT INTO managed_providers' : 'UPDATE managed_providers SET active = 0')))
    assert.ok(f.calls.some(c => c.sql.startsWith('UPDATE submissions SET status')))
    assert.ok(f.calls.some(c => c.sql.startsWith('INSERT INTO audit_logs')))
    assert.ok(f.calls.every(c => !/ON DUPLICATE|directory_listed/.test(c.sql)))
  }
})

test('website uniqueness conflicts roll back review without provider takeover or leaking DB errors', async () => {
  const f = fixture()
  f.fail('INSERT INTO managed_providers')
  const response = await f.request('/api/admin/submissions/1', 'PATCH', { status: 'approved' }, { adminId: 8 })
  assert.equal(response.status, 409)
  assert.deepEqual(f.state(), { committed: false, rolledBack: true })
  assert.ok(!f.calls.some(c => c.sql.startsWith('UPDATE submissions')))
  assert.ok(!JSON.stringify(response).includes('private database details'))
})

test('automatic additive migration creates nullable site columns and default-off directory consent idempotently', async () => {
  const columns = new Set(['local_owner_verified', 'email_verified_at', 'source_id', 'capability_metadata', 'release_date', 'provider_icon_url'])
  const alters: string[] = []
  const database = {
    all: async () => [...columns].map(Field => ({ Field })),
    run: async (sql: string) => { if (sql.startsWith('ALTER TABLE')) { alters.push(sql); columns.add(sql.match(/ADD COLUMN (\w+)/)![1]) } },
  } as unknown as Database
  await initializeDatabase(database)
  assert.equal(alters.length, 12)
  assert.ok(alters.includes('ALTER TABLE submissions ADD COLUMN founded_at DATE NULL'))
  assert.ok(alters.includes('ALTER TABLE submissions ADD COLUMN directory_listed TINYINT(1) NOT NULL DEFAULT 0'))
  await initializeDatabase(database)
  assert.equal(alters.length, 12)
})


test('logo routes enforce authentication, approved ownership and admin scope before fetching', async () => {
  const f = fixture()
  assert.equal((await f.request('/api/user/sites/1/logo/preview', 'POST', { url: 'https://example.com/a.png' }, { signedIn: false })).status, 401)
  assert.equal((await f.request('/api/admin/providers/1/logo', 'GET')).status, 403)
  assert.equal((await f.request('/api/user/sites/1/logo', 'GET')).status, 404)
  assert.match(f.calls[0].sql, /s.status = 'approved'/)
  assert.match(f.calls[0].sql, /BINARY s.owner_identity/)
  assert.deepEqual(f.calls[0].values, [1, 'github:7', null, null])
  assert.equal((await f.request('/api/admin/providers/1/logo', 'GET', {}, { adminId: 8 })).status, 404)
  assert.doesNotMatch(f.calls[1].sql, /owner_identity/)
})
