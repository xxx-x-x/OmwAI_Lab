import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createMfa, encryptionKey, seal, totp } from '../dist-server/mfa.js'

test('enrollment confirms pending secret and only persists recovery code hashes', async () => {
  const key = randomBytes(32).toString('base64')
  const secret = 'JBSWY3DPEHPK3PXP'
  let row = { enabled: 0, pending_secret: seal(secret, encryptionKey(key), 7), pending_expires_at: Date.now() + 60000, last_step: -1, failures: 0, locked_until: 0 }
  const hashes = []
  const database = {
    async transaction(fn) { return fn({}) },
    async get() { return { ...row } },
    async run(sql, args) {
      if (sql.includes('SET last_step')) row.last_step = args[0]
      if (sql.includes('SET enabled = 1')) row = { ...row, enabled: 1, secret: row.pending_secret, pending_secret: null, pending_expires_at: null }
      if (sql.startsWith('DELETE FROM mfa_recovery_codes')) hashes.length = 0
      if (sql.startsWith('INSERT INTO mfa_recovery_codes')) hashes.push(args[1])
      if (sql.startsWith('DELETE FROM admin_mfa')) row = undefined
      return { affectedRows: 1 }
    },
  }
  const mfa = createMfa(database, key)
  const { codes } = await mfa.verify(7, totp(secret, Math.floor(Date.now() / 30000)), true)
  assert.equal(row.enabled, 1)
  assert.equal(row.pending_secret, null)
  assert.equal(codes.length, 10)
  assert.equal(new Set(codes).size, 10)
  assert.equal(hashes.length, 10)
  for (const hash of hashes) { assert.match(hash, /^[a-f0-9]{64}$/); assert.equal(codes.includes(hash), false) }
  await assert.rejects(mfa.verify(7, codes[0], true))
  const oldHashes = [...hashes]
  const regenerated = await mfa.regenerate(7)
  assert.equal(regenerated.length, 10)
  assert.equal(hashes.some(hash => oldHashes.includes(hash)), false)
  await mfa.disable(7)
  assert.equal(hashes.length, 0)
  assert.equal(row, undefined)
})

test('expired enrollment and unconfirmed MFA cannot authenticate', async () => {
  const key = randomBytes(32).toString('base64')
  const database = { async transaction(fn) { return fn({}) }, async get() { return { enabled: 0, pending_secret: 'unused', pending_expires_at: 1 } } }
  const mfa = createMfa(database, key)
  await assert.rejects(mfa.verify(1, '123456', true), error => error.status === 400)
  await assert.rejects(mfa.verify(1, '123456'), error => error.status === 400)
})
