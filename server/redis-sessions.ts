import { createHash } from 'node:crypto'
import { ADMIN_SESSION_IDLE_MS, SESSION_IDLE_MS } from './session-security.js'

export type AuthUser = { id: number | string; login: string; name: string | null; avatar_url: string; html_url: string; role: 'user' | 'admin' }
export type Session = { user: AuthUser; expiresAt: number; lastSeenAt: number; localUserId: number | null; mfaVerifiedAt?: number }
type Evaluate = (script: string, keys: string[], args: (string | number)[]) => Promise<unknown>

const SAVE = `
local session = cjson.decode(ARGV[1])
local ttl = session.expiresAt - tonumber(ARGV[2])
if ttl <= 0 then return 0 end
local version = '0'
if session.localUserId ~= cjson.null then
  version = redis.call('GET', ARGV[3] .. session.localUserId) or '0'
end
redis.call('SET', KEYS[1], cjson.encode({session=session, version=version}), 'PX', ttl)
return 1`
const READ = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local record = cjson.decode(raw)
local session = record.session
local now = tonumber(ARGV[1])
local idle = tonumber(ARGV[2])
if session.user.role == 'admin' then idle = tonumber(ARGV[3]) end
local version = '0'
if session.localUserId ~= cjson.null then
  version = redis.call('GET', ARGV[4] .. session.localUserId) or '0'
end
if session.expiresAt <= now or session.lastSeenAt + idle <= now or record.version ~= version then
  redis.call('DEL', KEYS[1])
  return nil
end
if ARGV[5] == '1' then
  session.lastSeenAt = math.max(session.lastSeenAt, now)
  redis.call('SET', KEYS[1], cjson.encode(record), 'PX', session.expiresAt - now)
end
return cjson.encode(session)`

export function createRedisSessions(evaluate: Evaluate, prefix: string) {
  // All session keys share a cluster slot so validation and revocation are atomic.
  const base = `${prefix}{sessions}:`
  const versions = `${base}user:`
  const key = (id: string) => `${base}token:${createHash('sha256').update(id).digest('hex')}`
  return {
    async create(id: string, session: Session) {
      await evaluate(SAVE, [key(id)], [JSON.stringify(session), Date.now(), versions])
    },
    async get(id: string, touch = true): Promise<Session | undefined> {
      if (!/^[a-f0-9]{64}$/.test(id)) return undefined
      const raw = await evaluate(READ, [key(id)], [Date.now(), SESSION_IDLE_MS, ADMIN_SESSION_IDLE_MS, versions, touch ? '1' : '0'])
      return typeof raw === 'string' ? JSON.parse(raw) as Session : undefined
    },
    async delete(id: string) {
      await evaluate("return redis.call('DEL', KEYS[1])", [key(id)], [])
    },
    async revokeUser(localUserId: number) {
      await evaluate("return redis.call('INCR', KEYS[1])", [`${versions}${localUserId}`], [])
    },
  }
}
