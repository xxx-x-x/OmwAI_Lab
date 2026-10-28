import { createHash, createHmac, randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'

export type CodePurpose = 'register' | 'reset-password'
export const CODE_TTL_MS = 10 * 60 * 1000
export const CODE_COOLDOWN_MS = 60 * 1000

const ISSUE_CODE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
redis.call('HSET', KEYS[2], 'hash', ARGV[2], 'attempts', 0, 'token', ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1`
const CANCEL_CODE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
if redis.call('HGET', KEYS[2], 'token') == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1`
const CONSUME_CODE = `
local hash = redis.call('HGET', KEYS[1], 'hash')
if not hash then return 0 end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if hash == ARGV[1] and attempts <= 5 then
  redis.call('DEL', KEYS[1])
  return 1
end
if attempts >= 5 then redis.call('DEL', KEYS[1]) end
return 0`
const RATE_LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count`

export class AuthRedisUnavailableError extends Error {
  constructor() { super('认证存储服务暂不可用，请稍后再试'); this.name = 'AuthRedisUnavailableError' }
}

export function createAuthRedis(url: string, prefix = 'omwai:auth:', secret = '') {
  if (url && !/^rediss?:\/\//.test(url)) throw new Error('REDIS_URL 必须使用 redis:// 或 rediss://')
  const client = url ? new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    commandTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: times => Math.min(times * 250, 5000),
  }) : undefined
  // Connection errors must not expose URLs or credentials in logs.
  client?.on('error', () => {})
  let connecting: Promise<void> | undefined

  async function evaluate(script: string, keys: string[], args: (string | number)[]) {
    try {
      if (!client) throw new AuthRedisUnavailableError()
      if (client.status === 'wait') {
        connecting ??= client.connect().then(() => {}).finally(() => { connecting = undefined })
      }
      if (connecting) await connecting
      if (client.status !== 'ready') throw new AuthRedisUnavailableError()
      return Number(await client.eval(script, keys.length, ...keys, ...args))
    } catch {
      throw new AuthRedisUnavailableError()
    }
  }
  function keys(email: string, purpose: CodePurpose) {
    const id = createHash('sha256').update(`${purpose}:${email.trim().toLowerCase()}`).digest('hex')
    // Both keys share a Redis Cluster slot, allowing atomic multi-key scripts.
    return [`${prefix}{${id}}:cooldown`, `${prefix}{${id}}:code`]
  }
  function hash(email: string, purpose: CodePurpose, code: string) {
    if (!secret) throw new AuthRedisUnavailableError()
    return createHmac('sha256', secret).update(`${email.trim().toLowerCase()}:${purpose}:${code}`).digest('hex')
  }

  return {
    async issueCode(email: string, purpose: CodePurpose, code: string) {
      const token = randomUUID()
      const issued = await evaluate(ISSUE_CODE, keys(email, purpose), [token, hash(email, purpose, code), CODE_COOLDOWN_MS, CODE_TTL_MS])
      return issued === 1 ? token : null
    },
    async cancelCode(email: string, purpose: CodePurpose, token: string) {
      await evaluate(CANCEL_CODE, keys(email, purpose), [token])
    },
    async consumeCode(email: string, purpose: CodePurpose, code: string) {
      return await evaluate(CONSUME_CODE, [keys(email, purpose)[1]!], [hash(email, purpose, code)]) === 1
    },
    async allowRequest(ip: string) {
      const id = createHash('sha256').update(ip).digest('hex')
      return await evaluate(RATE_LIMIT, [`${prefix}rate:${id}`], [15 * 60 * 1000]) <= 20
    },
    close() { client?.disconnect() },
  }
}
