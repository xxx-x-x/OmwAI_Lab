import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.ts'
import { handleSiteGroups, isRetiredSiteGroupsRoute } from './site-groups.ts'

async function call(database: Database, path: string, method = 'GET') {
  let result: { status: number; payload: any } | undefined
  const headers: Record<string, unknown> = {}
  await handleSiteGroups({ database, request: { method } as IncomingMessage, response: { setHeader: (name: string, value: unknown) => { headers[name] = value } } as unknown as ServerResponse, url: new URL(path, 'http://localhost'), json: (_response, status, payload) => { result = { status, payload } } })
  assert.ok(result)
  assert.equal(headers['cache-control'], 'no-store')
  return result
}

const inaccessibleDatabase = new Proxy({} as Database, { get() { assert.fail('Retired or invalid requests must not access the database') } })

test('public comparison returns only automatically synced public quotes with exact model binding', async () => {
  const calls: { sql: string; values: unknown[] }[] = []
  const rows = [{ id: 7, modelId: 'GPT-4o', sourceType: 'public', sourceStatus: 'synced', syncedAt: new Date().toISOString() }]
  const database = { prepare: (sql: string) => ({ all: async (...values: unknown[]) => { calls.push({ sql, values }); return rows } }) } as unknown as Database
  const result = await call(database, '/api/site-comparison?modelId=GPT-4o')
  assert.equal(result.status, 200)
  assert.deepEqual(result.payload.quotes, [{ ...rows[0], stale: false }])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].values, ['GPT-4o'])
  assert.match(calls[0].sql, /FROM site_public_quotes q/)
  assert.match(calls[0].sql, /BINARY q\.model_id = BINARY \?/)
  for (const condition of ["s.status = 'approved'", 's.directory_listed = 1', 'p.active = 1', 'ps.enabled = 1']) assert.ok(calls[0].sql.includes(condition))
  assert.doesNotMatch(calls[0].sql, /group_authorization/)
})

test('public comparison handles empty synced results without querying historical quotes', async () => {
  let queries = 0
  const database = { prepare: () => ({ all: async () => { queries++; return [] } }) } as unknown as Database
  assert.deepEqual(await call(database, '/api/site-comparison?modelId=GPT-4o'), { status: 200, payload: { quotes: [] } })
  assert.equal(queries, 1)
})

test('invalid public comparison models and methods never query the database', async () => {
  for (const query of ['', '?modelId=', `?modelId=${'x'.repeat(192)}`]) assert.equal((await call(inaccessibleDatabase, `/api/site-comparison${query}`)).status, 400)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await call(inaccessibleDatabase, '/api/site-comparison?modelId=GPT-4o', method)).status, 404)
})

test('all historical authorization, submission and review endpoints are gone without database access', async () => {
  const paths = ['/api/user/sites/1/authorizations', '/api/user/sites/1/authorizations/Group%20A', '/api/user/sites/1/quotes', '/api/user/sites/1/quotes/42', '/api/admin/site-quotes', '/api/admin/site-quotes/42']
  for (const path of paths) {
    assert.equal(isRetiredSiteGroupsRoute(path), true)
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) assert.equal((await call(inaccessibleDatabase, path, method)).status, 410)
  }
})

test('automatic pricing and group sync routes are not retired', () => {
  for (const path of ['/api/site-comparison', '/api/user/sites/1/pricing', '/api/user/sites/1/pricing/sync', '/api/user/sites/1/groups', '/api/user/sites/1/groups/sync']) assert.equal(isRetiredSiteGroupsRoute(path), false)
})
