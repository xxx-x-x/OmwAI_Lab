import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createMfa, encodeSecret, encryptionKey, matchStep, recoveryHash, seal, totp, unseal } from '../dist-server/mfa.js'

test('TOTP RFC 6238 SHA1 vectors and time-window validation', () => {
  const secret = encodeSecret(Buffer.from('12345678901234567890'))
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) assert.equal(totp(secret, Math.floor(seconds / 30)), expected)
  assert.equal(matchStep(secret, totp(secret, 100), 100 * 30000), 100)
  assert.equal(matchStep(secret, totp(secret, 98), 100 * 30000), null)
  assert.equal(matchStep(secret, '12345'), null)
})

test('MFA secrets use authenticated encryption bound to account and independent key', () => {
  const key = encryptionKey(randomBytes(32).toString('base64'))
  assert.throws(() => encryptionKey(''))
  const secret = encodeSecret(randomBytes(20)), encrypted = seal(secret, key, 1)
  assert.equal(unseal(encrypted, key, 1), secret)
  assert.throws(() => unseal(encrypted, key, 2))
  assert.throws(() => unseal(encrypted, randomBytes(32), 1))
  assert.equal(recoveryHash(1, 'ABCD-EF01'), recoveryHash(1, 'abcdef01'))
  assert.notEqual(recoveryHash(1, 'ABCDEF01'), recoveryHash(2, 'ABCDEF01'))
})

function fixture() {
  const key = randomBytes(32).toString('base64'), secret = encodeSecret(randomBytes(20))
  let row = { enabled: 1, secret: seal(secret, encryptionKey(key), 1), last_step: -1, failures: 0, locked_until: 0 }
  const codes = new Set([recoveryHash(1, 'ABCD'.repeat(8))])
  let queue = Promise.resolve()
  const database = {
    transaction(fn) { const result = queue.then(() => fn({})); queue = result.catch(() => {}); return result },
    async get(sql) { assert.match(sql, /FOR UPDATE/); return { ...row } },
    async run(sql, args) {
      if (sql.startsWith('UPDATE mfa_recovery_codes')) { const found = codes.delete(args[1]); return { affectedRows: found ? 1 : 0 } }
      if (sql.includes('SET last_step')) { row = { ...row, last_step: args[0], failures: 0, locked_until: 0 }; return {} }
      if (sql.includes('SET failures')) { row = { ...row, failures: args[0], locked_until: args[1] }; return {} }
      throw new Error(sql)
    },
  }
  return { mfa: createMfa(database, key), secret }
}
test('TOTP time steps and recovery codes are consumed once under concurrent verification', async () => {
  const { mfa, secret } = fixture()
  const results = await Promise.allSettled([mfa.verify(1, totp(secret, Math.floor(Date.now() / 30000))), mfa.verify(1, totp(secret, Math.floor(Date.now() / 30000)))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const recovery = await Promise.allSettled([mfa.verify(1, 'ABCD'.repeat(8)), mfa.verify(1, 'ABCD'.repeat(8))])
  assert.equal(recovery.filter(result => result.status === 'fulfilled').length, 1)
})
test('failed attempts commit lockout and valid codes cannot bypass it', async () => {
  const { mfa, secret } = fixture()
  for (let index = 0; index < 5; index++) await assert.rejects(mfa.verify(1, 'invalid'), error => error.status === 401)
  await assert.rejects(mfa.verify(1, totp(secret, Math.floor(Date.now() / 30000))), error => error.status === 429)
})
