import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Database } from './mysql.ts'
import { updateAdminProvider } from './admin-providers.ts'

const details = { name: 'Example', website: 'https://new.example.com', foundedAt: '2020-01-01', description: 'Description', models: 'OpenAI、Anthropic', pricing: '公开价格', notes: 'Notes', invoice: true, billingType: '按量计费', billingDetails: 'Details' }
function fixture(options: { pending?: boolean; missing?: boolean; unlinked?: boolean; fail?: boolean } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  let committed = false
  let rolledBack = false
  const connection = {}
  const db = {
    get: async (sql: string, values: unknown[], executor: unknown) => {
      assert.equal(executor, connection)
      calls.push({ sql, values })
      if (sql.includes('FROM managed_providers')) return options.missing ? undefined : { id: 1, submission_id: options.unlinked ? null : 2, website: 'https://old.example.com' }
      if (sql.includes('FROM site_revisions')) return options.pending ? { id: 3 } : undefined
      return { id: 2 }
    },
    run: async (sql: string, values: unknown[], executor: unknown) => {
      assert.equal(executor, connection)
      calls.push({ sql, values })
      if (options.fail && sql.startsWith('UPDATE submissions')) throw new Error('database write failed')
      return { affectedRows: 1 }
    },
    transaction: async (operation: (connection: unknown) => Promise<unknown>) => {
      try { const result = await operation(connection); committed = true; return result }
      catch (error) { rolledBack = true; throw error }
    },
  } as unknown as Database
  return { db, calls, state: () => ({ committed, rolledBack }) }
}

test('admin editing synchronizes both snapshots, invalidates logo and audits in one transaction', async () => {
  const f = fixture()
  assert.equal((await updateAdminProvider(f.db, 1, details, 9)).status, 200)
  const writes = f.calls.filter(call => call.sql.startsWith('UPDATE'))
  assert.equal(writes.length, 3)
  assert.match(writes[0].sql, /UPDATE managed_providers/)
  assert.deepEqual(writes[0].values, [details.name, details.website, details.models, details.pricing, details.notes, 1])
  assert.match(writes[1].sql, /UPDATE submissions/)
  assert.deepEqual(writes[1].values, [details.name, details.website, details.models, details.pricing, details.notes, details.foundedAt, details.description, true, details.billingType, details.billingDetails, 2])
  assert.match(writes[2].sql, /revision = revision \+ 1/)
  assert.equal(f.calls.some(call => call.sql.includes('directory_listed =') || call.sql.includes('status = ?')), false)
  assert.equal(f.state().committed, true)
  assert.match(f.calls.at(-1)!.sql, /INSERT INTO audit_logs/)
})

test('admin editing rejects invalid public fields without any database calls', async () => {
  for (const body of [{ ...details, website: 'javascript:alert(1)' }, { ...details, foundedAt: '2999-01-01' }, { ...details, invoice: 'true' }, { ...details, name: ' ' }, { active: 'false' }]) {
    const f = fixture()
    assert.equal((await updateAdminProvider(f.db, 1, body, 9)).status, 400)
    assert.equal(f.calls.length, 0)
  }
})

test('pending revisions block editing but allow toggling without overwriting snapshots', async () => {
  const f = fixture({ pending: true })
  assert.equal((await updateAdminProvider(f.db, 1, details, 9)).status, 409)
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false)
  const toggle = fixture({ pending: true })
  assert.equal((await updateAdminProvider(toggle.db, 1, { active: false }, 9)).status, 200)
  const writes = toggle.calls.filter(call => call.sql.startsWith('UPDATE'))
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].values, [0, 1])
  assert.match(writes[0].sql, /SET active/)
})

test('missing and legacy unlinked sites do not silently discard public fields', async () => {
  const missing = fixture({ missing: true })
  assert.equal((await updateAdminProvider(missing.db, 1, details, 9)).status, 404)
  const legacy = fixture({ unlinked: true })
  assert.equal((await updateAdminProvider(legacy.db, 1, details, 9)).status, 409)
  assert.equal(legacy.calls.some(call => call.sql.startsWith('UPDATE')), false)
})

test('snapshot write failures roll back instead of reporting success', async () => {
  const f = fixture({ fail: true })
  await assert.rejects(updateAdminProvider(f.db, 1, details, 9), /database write failed/)
  assert.equal(f.state().rolledBack, true)
  assert.equal(f.state().committed, false)
})
