import { io, type Socket } from 'socket.io-client'
import { lookup } from 'node:dns/promises'
import { isPublicAddress, validateLogoUrl } from './site-logo.js'

export type UptimeConfig = { enabled: boolean; url: string; token: string; username: string; password: string; origins: string[] }
export function uptimeConfig(env: Record<string, string | undefined>): UptimeConfig {
  const origins = (env.UPTIME_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const enabled = env.UPTIME_ENABLED === 'true' && env.UPTIME_EGRESS_ENFORCED === 'true'
  if (enabled) {
    const url = new URL(env.UPTIME_URL || '')
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid Uptime configuration')
    for (const origin of origins) if (validateLogoUrl(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('Invalid monitoring allowlist')
    if (!origins.length || !(env.UPTIME_TOKEN || (env.UPTIME_USERNAME && env.UPTIME_PASSWORD))) throw new Error('Missing Uptime configuration')
  }
  return { enabled, url: env.UPTIME_URL || '', token: env.UPTIME_TOKEN || '', username: env.UPTIME_USERNAME || '', password: env.UPTIME_PASSWORD || '', origins }
}

export async function validateMonitorTarget(value: unknown, config: UptimeConfig, resolve = (host: string) => lookup(host, { all: true })) {
  if (typeof value !== 'string') throw new Error('请填写 HTTPS API 基址')
  if (new URL(value).hash) throw new Error('API 地址不能包含片段')
  const url = validateLogoUrl(value)
  if (url.protocol !== 'https:' || url.search || url.hash || !config.origins.includes(url.origin)) throw new Error('API 地址不在管理员允许的 HTTPS 源站范围内')
  if (!/^\/(?:v1\/?)?$/.test(url.pathname)) throw new Error('基址仅支持源站或 /v1')
  const records = await Promise.race([resolve(url.hostname.replace(/^\[|\]$/g, '')), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS 校验超时')), 3000); timer.unref() })])
  if (!records.length || records.some(r => !isPublicAddress(r.address))) throw new Error('API 地址必须全部解析到公网')
  return `${url.origin}/v1/chat/completions`
}

export function monitorPayload(marker: string, url: string, model: string, key: string, interval: number) {
  return { name: marker, type: 'json-query', url, method: 'POST', active: false, interval, retryInterval: interval, maxretries: 0, timeout: 30, maxredirects: 0, ignoreTls: false, upsideDown: false, accepted_statuscodes: ['200'], httpBodyEncoding: 'json', headers: JSON.stringify({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }), body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 16, stream: false }), jsonPath: '$exists(choices[0].message.content) and $type(choices[0].message.content) = "string" and $length(choices[0].message.content) > 0 and $not($exists(error))', jsonPathOperator: '==', expectedValue: 'true', notificationIDList: {}, parent: null, proxyId: null, resendInterval: 0 }
}

type Reply = { ok?: boolean; monitorID?: number; monitor?: Record<string, unknown>; data?: Record<string, unknown>[]; labEncryption?: { version?: number; algorithm?: string; encryptedAtRest?: boolean; redactedManagement?: boolean } }
export async function requireUptimeEncryption(rpc: UptimeRpc) {
  try {
    const { labEncryption: capability } = await rpc('labEncryptionCapabilities')
    if (capability?.version !== 1 || capability.algorithm !== 'AES-256-GCM' || capability.encryptedAtRest !== true || capability.redactedManagement !== true) throw new Error('Unsupported encryption')
  } catch { throw new Error('监控服务未确认支持 Lab 凭证加密；已拒绝发送 KEY，请先升级并配置 Uptime') }
}
export type UptimeRpc = (event: string, ...args: unknown[]) => Promise<Reply>
export async function withUptime<T>(config: UptimeConfig, action: (rpc: UptimeRpc) => Promise<T>): Promise<T> {
  const socket: Socket = io(config.url, { autoConnect: false, reconnection: false, transports: ['websocket'], timeout: 5000, rejectUnauthorized: true })
  const rpc: UptimeRpc = (event, ...args) => new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, ...args, (error: Error | null, reply: Reply) => {
      if (error || !reply?.ok) reject(new Error('监控服务暂不可用；请刷新确认状态，勿重复创建'))
      else resolve(reply)
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', () => reject(new Error('监控服务连接失败')))
      socket.connect()
    })
    if (config.token) await rpc('loginByToken', config.token)
    else await rpc('login', { username: config.username, password: config.password })
    return await action(rpc)
  } finally { socket.disconnect(); socket.removeAllListeners() }
}

export function safeBeats(rows: Record<string, unknown>[]) {
  return rows.slice(-300).map(row => ({ time: String(row.time ?? '').slice(0, 40), status: [0, 1, 2, 3].includes(Number(row.status)) ? Number(row.status) : null, ping: typeof row.ping === 'number' && Number.isFinite(row.ping) && row.ping >= 0 ? row.ping : null }))
}
