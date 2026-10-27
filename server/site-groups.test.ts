import assert from 'node:assert/strict'
import { createDecipheriv } from 'node:crypto'
import { test } from 'node:test'
import { encryptCredential, validateQuote, handleSiteGroups } from './site-groups.ts'
import type { Database } from './mysql.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

const quote = { authorizationId: 1, modelId: 'GPT-4o', currency: 'USD', billingUnit: '1M tokens', inputPrice: '0', outputPrice: '10.25', sourceUrl: 'https://example.com/pricing' }

test('AES-GCM encrypts with fresh nonces and rejects missing or invalid keys', () => {
  const key = 'ab'.repeat(32)
  const value = encryptCredential('secret', key)
  assert.notEqual(value, encryptCredential('secret', key))
  assert.ok(!value.includes('secret'))
  const [, iv, tag, ciphertext] = value.split(':')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  assert.equal(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString(), 'secret')
  assert.throws(() => encryptCredential('secret', ''))
})

test('manual quotes require exact IDs, source and bounded decimal prices', () => {
  assert.equal(validateQuote(quote).model, 'GPT-4o')
  for (const change of [{ modelId: ' GPT-4o' }, { inputPrice: -1 }, { inputPrice: '1e3' }, { sourceUrl: 'https://example.com/?key=secret' }, { inputPrice: null, outputPrice: null }]) assert.throws(() => validateQuote({ ...quote, ...change }))
})

test('public comparison binds exact model and enforces reviewed active ownership', async () => {
  let sql = '', values: unknown[] = [], status = 0
  const database = { prepare: (query: string) => ({ all: async (...args: unknown[]) => { sql = query; values = args; return [] } }) } as unknown as Database
  await handleSiteGroups({ database, request: { method: 'GET' } as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL('http://localhost/api/site-comparison?modelId=GPT-4o'), localUserId: null, adminId: null, key: '', readJson: async () => ({}), json: (_res, code) => { status = code } })
  assert.equal(status, 200)
  assert.deepEqual(values, ['GPT-4o'])
  assert.match(sql, /BINARY q\.model_id = BINARY \?/)
  assert.match(sql, /q\.status = 'approved'/)
  assert.match(sql, /s\.status = 'approved'/)
  assert.match(sql, /a\.user_id = s\.user_id/)
  assert.match(sql, /a\.id = q\.authorization_id/)
  assert.match(sql, /s\.local_owner_verified = 1/)
  assert.match(sql, /a\.revoked_at IS NULL/)
})

test('quote submission binds authorization to the owned site and active group', async () => {
  let sql = '', values: unknown[] = [], status = 0
  const database = { prepare: (query: string) => ({ get: async () => ({ id: 1 }), run: async (...args: unknown[]) => { sql = query; values = args; return { affectedRows: 0 } } }) } as unknown as Database
  await handleSiteGroups({ database, request: { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, socket: {} } as unknown as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL('http://localhost/api/user/sites/1/quotes'), localUserId: 2, adminId: null, key: '', readJson: async () => ({ ...quote, authorizationId: 42 }), json: (_res, code) => { status = code } })
  assert.equal(status, 409)
  assert.match(sql, /a.id = \? AND s.id = \? AND s.user_id = \?/)
  assert.match(sql, /a.revoked_at IS NULL AND a.credential IS NOT NULL/)
  assert.deepEqual(values.slice(-3), [42, 1, 2])
})

test('revocation targets only the named group and its quotes', async () => {
  const calls: { sql: string; values: unknown[] }[] = []
  const database = {
    prepare: () => ({ get: async () => ({ id: 1 }) }),
    transaction: async (fn: (connection: unknown) => Promise<void>) => fn({}),
    run: async (sql: string, values: unknown[]) => { calls.push({ sql, values }) },
  } as unknown as Database
  let status = 0
  await handleSiteGroups({ database, request: { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost' }, socket: {} } as unknown as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL('http://localhost/api/user/sites/1/authorizations/group%20A'), localUserId: 2, adminId: null, key: '', readJson: async () => ({}), json: (_res, code) => { status = code } })
  assert.equal(status, 200)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.match(call.sql, /BINARY (?:a\.)?group_name = BINARY \?/)
    assert.deepEqual(call.values, [1, 2, 'group A'])
  }
  assert.match(calls[0].sql, /credential = NULL/)
  assert.match(calls[1].sql, /q.authorization_id/)
})

test('owner endpoints reject OAuth-only sessions before database access', async () => {
  let status = 0
  await handleSiteGroups({ database: {} as Database, request: { method: 'GET' } as IncomingMessage, response: { setHeader() {} } as unknown as ServerResponse, url: new URL('http://localhost/api/user/sites/1/quotes'), localUserId: null, adminId: null, key: '', readJson: async () => ({}), json: (_res, code) => { status = code } })
  assert.equal(status, 401)
})
