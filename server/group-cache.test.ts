import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Database } from './mysql.ts'
import { readGroupSnapshot, createGroupCache } from './group-cache.ts'

 test('detail reads full stored metadata without writes or network requests', async () => {
  const groups = [{ name: 'standard', ratio: 0, type: '用户等级', description: 'test', modelCount: 5 }]
  const calls: string[] = []
  const db = { get: async (sql: string) => { calls.push(sql); return sql.includes('FROM submissions') ? { id: 1 } : { groupsJson: JSON.stringify(groups), detectedAt: '2026-10-29', source: 'https://example.com/api/pricing' } } } as unknown as Database
  const result = await readGroupSnapshot(db, 'https://example.com')
  assert.deepEqual(result?.groups, groups)
  assert.equal(result?.cacheStatus, 'saved')
  assert.ok(calls.every(sql => sql.startsWith('SELECT')))
})

test('empty successful snapshot is distinct from pending collection', async () => {
  const db = { get: async (sql: string) => sql.includes('FROM submissions') ? { id: 1 } : { groupsJson: [], detectedAt: '2026-10-29', source: 'https://example.com/api/pricing' } } as unknown as Database
  assert.equal((await readGroupSnapshot(db, 'https://example.com'))?.cacheStatus, 'saved')
  const missing = { get: async (sql: string) => sql.includes('FROM submissions') ? { id: 1 } : undefined, prepare: () => ({ all: async () => [] }) } as unknown as Database
  assert.deepEqual(await readGroupSnapshot(missing, 'https://example.com'), { groups: [], detectedAt: null, source: null, cacheStatus: 'pending' })
  assert.equal(await readGroupSnapshot({ get: async () => undefined } as unknown as Database, 'https://unlisted.example'), null)
})

test('background collection restricts eligibility and daily interval before any fetch', async () => {
  let sql = '', fetched = 0
  const db = { prepare: (query: string) => { sql = query; return { all: async () => [] } } } as unknown as Database
  const cache = createGroupCache(db, async () => { fetched++; return {} })
  cache.start()
  await cache.close()
  assert.equal(fetched, 0)
  assert.match(sql, /INTERVAL 1 DAY/)
  assert.match(sql, /directory_listed = 1 AND p.active = 1/)
  assert.match(sql, /LIMIT 4/)
})
