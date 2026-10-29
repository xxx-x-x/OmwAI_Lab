import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database } from './mysql.js'

export const MFA_RECENT_MS = 5 * 60_000
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function encodeSecret(bytes: Buffer) {
  let bits = 0, value = 0, result = ''
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31]
  return result
}
function decodeSecret(secret: string) {
  let bits = 0, value = 0
  const bytes: number[] = []
  for (const char of secret) { const digit = alphabet.indexOf(char); if (digit < 0) throw new Error('Invalid secret'); value = (value << 5) | digit; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  return Buffer.from(bytes)
}
export function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', decodeSecret(secret)).update(counter).digest()
  const offset = digest[19] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
export function matchStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null
  const step = Math.floor(now / 30_000)
  for (const candidate of [step, step - 1, step + 1]) if (timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code))) return candidate
  return null
}
export function encryptionKey(raw: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error('MFA_ENCRYPTION_KEY 必须为独立的 32 字节 base64 密钥')
  const key = Buffer.from(raw, 'base64'); if (key.length !== 32) throw new Error('MFA 密钥无效'); return key
}
export function seal(secret: string, key: Buffer, userId: number) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`omwai-mfa:${userId}`))
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.')
}
export function unseal(value: string, key: Buffer, userId: number) {
  const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(Buffer.from(`omwai-mfa:${userId}`)); decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
export function recoveryHash(userId: number, code: string) { return createHash('sha256').update(`omwai-mfa-recovery:${userId}:${code.replaceAll('-', '').toUpperCase()}`).digest('hex') }
function recoveryCodes() { return Array.from({ length: 10 }, () => randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')) }
export class MfaError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }
export function createMfa(database: Database, rawKey: string) {
  const key = () => encryptionKey(rawKey)
  const status = async (id: number) => {
    const row = await database.get('SELECT enabled, (SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL) AS remaining FROM admin_mfa WHERE user_id = ?', [id, id])
    return { enabled: Boolean(row?.enabled), recoveryCodesRemaining: Number(row?.remaining ?? 0), configured: Boolean(rawKey) }
  }
  const begin = async (id: number, login: string) => {
    const secret = encodeSecret(randomBytes(20)), encrypted = seal(secret, key(), id)
    const result = await database.run('INSERT INTO admin_mfa (user_id, pending_secret, pending_expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE pending_secret = IF(enabled = 0, VALUES(pending_secret), pending_secret), pending_expires_at = IF(enabled = 0, VALUES(pending_expires_at), pending_expires_at)', [id, encrypted, Date.now() + 10 * 60_000])
    void result
    if ((await status(id)).enabled) throw new MfaError(409, 'MFA 已绑定')
    return { secret, uri: `otpauth://totp/${encodeURIComponent(`OmwAI_Lab:${login}`)}?secret=${secret}&issuer=OmwAI_Lab&algorithm=SHA1&digits=6&period=30` }
  }
  const verify = async (id: number, code: string, enrolling = false) => {
    const result = await database.transaction(async connection => {
      const row = await database.get('SELECT * FROM admin_mfa WHERE user_id = ? FOR UPDATE', [id], connection)
      if (!row || (enrolling ? Boolean(row.enabled) || Number(row.pending_expires_at) < Date.now() || !row.pending_secret : !row.enabled)) return { error: 'MFA 尚未绑定或绑定请求已失效', status: 400 }
      if (Number(row.locked_until) > Date.now()) return { error: '验证过于频繁，请 5 分钟后再试', status: 429 }
      const secret = unseal(String(enrolling ? row.pending_secret : row.secret), key(), id)
      const step = matchStep(secret, code)
      let valid = step !== null && step > Number(row.last_step)
      if (!valid && !enrolling && /^[a-fA-F0-9-]{32,39}$/.test(code)) {
        const used = await database.run('UPDATE mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [id, recoveryHash(id, code)], connection)
        valid = used.affectedRows === 1
      }
      if (!valid) {
        const failures = Number(row.failures) + 1
        await database.run('UPDATE admin_mfa SET failures = ?, locked_until = ? WHERE user_id = ?', [failures >= 5 ? 0 : failures, failures >= 5 ? Date.now() + 5 * 60_000 : 0, id], connection)
        return { error: '验证码无效、已使用或已过期', status: 401 }
      }
      await database.run('UPDATE admin_mfa SET last_step = ?, failures = 0, locked_until = 0 WHERE user_id = ?', [step !== null && step > Number(row.last_step) ? step : Number(row.last_step), id], connection)
      if (enrolling) {
        await database.run('UPDATE admin_mfa SET enabled = 1, secret = pending_secret, pending_secret = NULL, pending_expires_at = NULL WHERE user_id = ?', [id], connection)
        const codes = recoveryCodes()
        await database.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [id], connection)
        for (const value of codes) await database.run('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)', [id, recoveryHash(id, value)], connection)
        return { codes }
      }
      return {}
    })
    if ('error' in result) throw new MfaError(result.status!, result.error!)
    return result
  }
  const regenerate = async (id: number) => database.transaction(async connection => {
    const row = await database.get('SELECT enabled FROM admin_mfa WHERE user_id = ? FOR UPDATE', [id], connection)
    if (!row?.enabled) throw new MfaError(400, 'MFA 尚未绑定')
    const codes = recoveryCodes(); await database.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [id], connection)
    for (const code of codes) await database.run('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)', [id, recoveryHash(id, code)], connection)
    return codes
  })
  const disable = async (id: number) => database.transaction(async connection => {
    await database.get('SELECT user_id FROM admin_mfa WHERE user_id = ? FOR UPDATE', [id], connection)
    await database.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [id], connection)
    await database.run('DELETE FROM admin_mfa WHERE user_id = ?', [id], connection)
  })
  return { status, begin, verify, regenerate, disable }
}
