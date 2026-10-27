import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import mysql from 'mysql2/promise'
import { createDatabase, initializeDatabase } from './mysql.ts'
import { handleSiteGroups } from './site-groups.ts'

// Explicit opt-in: the account must be able to create and drop a disposable database.
const databaseUrl = process.env.SITE_GROUPS_TEST_DATABASE_URL

test('MySQL group ownership, review, exact models and revocation', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!)
  assert.equal(url.protocol, 'mysql:')
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) || process.env.SITE_GROUPS_ALLOW_REMOTE_TEST === '1', 'Remote integration database requires explicit opt-in')
  const name = `site_groups_test_${randomBytes(8).toString('hex')}`
  const admin = await mysql.createConnection(databaseUrl!)
  let db: ReturnType<typeof createDatabase> | undefined
  try {
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`)
    url.pathname = `/${name}`
    db = createDatabase(url.toString())
    await initializeDatabase(db)
    const user = await db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, '')").run('owner', 'owner@example.test')
    const other = await db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, '')").run('other', 'other@example.test')
    const site = await db.prepare("INSERT INTO submissions (user_id, local_owner_verified, submitter_login, name, website, models, pricing, notes, status, review_note) VALUES (?, 1, 'owner', 'site', 'https://example.test', '', '', '', 'approved', '')").run(user.insertId)
    const call = async (method: string, path: string, body: Record<string, unknown> = {}, userId: number | null = user.insertId, adminId: number | null = null) => {
      let result: { status: number; payload: any } | undefined
      await handleSiteGroups({ database: db!, request: { method, headers: { origin: 'http://localhost', host: 'localhost' }, socket: {} } as unknown as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL(path, 'http://localhost'), localUserId: userId, adminId, key: 'ab'.repeat(32), readJson: async () => body, json: (_response, status, payload) => { result = { status, payload } } })
      assert.ok(result)
      return result
    }
    const base = `/api/user/sites/${site.insertId}`
    for (const group of ['Group A', 'Group B']) assert.equal((await call('PUT', `${base}/authorizations/${encodeURIComponent(group)}`, { consent: true, key: 'test-only' })).status, 200)
    assert.equal((await call('GET', `${base}/authorizations`, {}, other.insertId)).status, 404)
    const auths = (await call('GET', `${base}/authorizations`)).payload.authorizations
    assert.equal(auths.length, 2)
    const quote = { modelId: 'GPT-4o', currency: 'USD', billingUnit: '1M tokens', inputPrice: '1', outputPrice: '2', sourceUrl: 'https://example.test/pricing' }
    const ids: number[] = []
    for (const auth of auths) {
      const response = await call('POST', `${base}/quotes`, { ...quote, authorizationId: auth.id })
      assert.equal(response.status, 201)
      ids.push(response.payload.id)
    }
    const comparison = async (model: string) => (await call('GET', `/api/site-comparison?modelId=${encodeURIComponent(model)}`, {}, null)).payload.quotes
    assert.equal((await comparison('GPT-4o')).length, 0)
    assert.equal((await call('PATCH', `/api/admin/site-quotes/${ids[0]}`, { status: 'approved' })).status, 403)
    for (const id of ids) assert.equal((await call('PATCH', `/api/admin/site-quotes/${id}`, { status: 'approved' }, user.insertId, user.insertId)).status, 200)
    assert.equal((await comparison('GPT-4o')).length, 2)
    assert.equal((await comparison('gpt-4o')).length, 0)
    assert.equal((await call('DELETE', `${base}/authorizations/Group%20A`)).status, 200)
    assert.deepEqual((await comparison('GPT-4o')).map((q: { groupName: string }) => q.groupName), ['Group B'])
    assert.equal((await call('POST', `${base}/quotes`, { ...quote, authorizationId: auths[0].id })).status, 409)
    assert.equal((await call('PATCH', `/api/admin/site-quotes/${ids[0]}`, { status: 'approved' }, user.insertId, user.insertId)).status, 409)
    assert.equal((await call('PUT', `${base}/authorizations/Group%20A`, { consent: true, key: 'replacement' })).status, 200)
    assert.equal((await comparison('GPT-4o')).length, 1)
    assert.equal((await call('PATCH', `/api/admin/site-quotes/${ids[0]}`, { status: 'approved' }, user.insertId, user.insertId)).status, 200)
    assert.equal((await comparison('GPT-4o')).length, 2)
  } finally {
    if (db) await db.pool.end()
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
    await admin.end()
  }
})
