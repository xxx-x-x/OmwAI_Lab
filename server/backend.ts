import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createDatabase, initializeDatabase, type DatabaseRow } from './mysql.js'
import { mergePrices, type PriceRow } from './pricing.js'
import { volcengineMediaPrices } from './volcengine-media-prices.js'
import { withOpenaiPrices } from './openai-prices.js'
import { handleSiteGroups } from './site-groups.js'
import { handlePublicPricing } from './public-pricing.js'
import { handleSiteManagement } from './site-management.js'
import { createSiteLogoCache, serveSiteLogo } from './site-logo-cache.js'
import { createEmailService, type EmailConfig } from './email.js'
import { AuthRedisUnavailableError, CODE_COOLDOWN_MS, createAuthRedis } from './auth-redis.js'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const PROBE_TIMEOUT_MS = 10_000
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

type AuthUser = { id: number | string; login: string; name: string | null; avatar_url: string; html_url: string; role: 'user' | 'admin' }
type Session = { user: AuthUser; expiresAt: number; localUserId: number | null }
type TurnstileResult = { success: boolean; action?: string; hostname?: string; 'error-codes'?: string[] }
type SourceModel = Record<string, unknown>

const LEADERBOARD_URL = 'https://artificialanalysis.ai/leaderboards/models'

async function fetchModelLeaderboard() {
  const response = await fetch(LEADERBOARD_URL, { headers: { accept: 'text/html', 'user-agent': 'OmwAI-Lab-Leaderboard-Sync/1.0' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`排行榜源站返回 HTTP ${response.status}`)
  const html = await response.text()
  if (Buffer.byteLength(html) > MAX_RESPONSE_BYTES) throw new Error('排行榜源站响应过大')
  const markerIndex = html.indexOf('initialModels\\":')
  const start = html.indexOf('[', markerIndex)
  const end = html.indexOf('}],\\"', start) + 2
  if (markerIndex < 0 || start < 0 || end < 2) throw new Error('未能识别排行榜数据格式')
  try {
    return JSON.parse(html.slice(start, end).replaceAll('\\"', '"').replaceAll('\\\\', '\\')) as SourceModel[]
  } catch {
    throw new Error('排行榜数据解析失败，源站格式可能已变更')
  }
}

function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function passwordMatches(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const actual = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function localUser(row: Record<string, unknown>): AuthUser {
  const login = String(row.username)
  return { id: Number(row.id), login, name: login, avatar_url: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(login)}`, html_url: '', role: row.role === 'admin' ? 'admin' : 'user' }
}

function parseCookies(request: IncomingMessage) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').flatMap(part => {
    const index = part.indexOf('=')
    return index < 0 ? [] : [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]]
  }))
}

function json(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

async function readJson(request: IncomingMessage) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error('请求内容过大')
  }
  return JSON.parse(body || '{}') as Record<string, unknown>
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase()
  if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized)) return true
  const match = normalized.match(/^172\.(\d+)\./)
  return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false
}

async function probeGroups(siteUrl: string) {
  const site = new URL(siteUrl)
  const normalizedHostname = site.hostname.toLowerCase()
  if (site.protocol !== 'https:' || site.username || site.password || normalizedHostname === 'localhost' || normalizedHostname.endsWith('.local')) {
    throw new Error('仅支持不含凭据的公网 HTTPS 站点')
  }
  const addresses = await lookup(site.hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => isIP(address) === 0 || isPrivateAddress(address))) {
    throw new Error('站点地址不能指向私有网络')
  }

  const endpoint = new URL('/api/pricing', site.origin)
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json', 'user-agent': 'OmwAI-Lab-Group-Probe/1.0' },
    redirect: 'error',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`站点返回 HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('站点响应过大')
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('站点响应过大')
  if (!text.trim()) throw new Error('该站点暂无开放 /api/pricing 接口，无法获取分组信息')
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('站点的公开计价接口未返回有效 JSON，无法获取分组信息')
  }
  if (payload.success !== true || typeof payload.group_ratio !== 'object' || payload.group_ratio === null) {
    throw new Error('未发现兼容的公开分组接口')
  }

  const ratios = payload.group_ratio as Record<string, unknown>
  const descriptions = (payload.usable_group && typeof payload.usable_group === 'object' ? payload.usable_group : {}) as Record<string, unknown>
  const userGroups = (payload.user_groups && typeof payload.user_groups === 'object' ? payload.user_groups : {}) as Record<string, unknown>
  const autoGroups = new Set(Array.isArray(payload.auto_groups) ? payload.auto_groups.filter((item): item is string => typeof item === 'string') : [])
  const models = Array.isArray(payload.data) ? payload.data : []
  const modelCounts = new Map<string, number>()
  for (const model of models) {
    if (!model || typeof model !== 'object') continue
    const enabled = (model as Record<string, unknown>).enable_groups
    if (!Array.isArray(enabled)) continue
    for (const group of new Set(enabled.filter((item): item is string => typeof item === 'string'))) {
      modelCounts.set(group, (modelCounts.get(group) ?? 0) + 1)
    }
  }

  const groups = Object.entries(ratios).flatMap(([name, ratio]) => typeof ratio === 'number' && Number.isFinite(ratio) ? [{
    name,
    ratio,
    type: autoGroups.has(name) ? '自动分组' : userGroups[name] === true ? '用户等级' : '模型分组',
    description: typeof descriptions[name] === 'string' ? descriptions[name] : '',
    modelCount: modelCounts.get(name) ?? 0,
  }] : []).sort((a, b) => a.type.localeCompare(b.type, 'zh-CN') || a.ratio - b.ratio || a.name.localeCompare(b.name, 'zh-CN'))

  return { groups, detectedAt: new Date().toISOString(), source: endpoint.toString() }
}

const probeMiddleware: Middleware = async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8')
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost')
      const site = requestUrl.searchParams.get('site')
      if (!site) {
        response.statusCode = 400
        response.end(JSON.stringify({ error: '缺少站点地址' }))
        return
      }
      response.end(JSON.stringify(await probeGroups(site)))
    } catch (error) {
      response.statusCode = 502
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : '探测失败' }))
    }
}

function createAuthMiddleware(clientId: string, clientSecret: string, googleClientId: string, googleClientSecret: string, databaseUrl: string, siteKey: string, emailConfig: EmailConfig, verificationSecret: string, secureCookies: boolean, turnstileSiteKey: string, turnstileSecretKey: string, redisUrl: string, redisPrefix: string, trustProxy: boolean, publicOrigin: string) {
  const authStore = createAuthRedis(redisUrl, redisPrefix, verificationSecret)
  let databaseInstance: ReturnType<typeof createDatabase> | undefined
  const database = new Proxy({} as ReturnType<typeof createDatabase>, { get: (_target, property) => Reflect.get(databaseInstance ??= createDatabase(databaseUrl), property) })
  const emailService = createEmailService(emailConfig)
  const siteLogos = createSiteLogoCache(database)
  let ready: Promise<void> | undefined
  const syncModelRankings = async () => {
    const models = await fetchModelLeaderboard()
    if (models.length < 50) throw new Error('源站返回的模型数量异常，已保留原有数据')
    const syncedAt = new Date()
    const sql = `INSERT INTO model_rankings (slug, name, creator, creator_color, creator_logo, context_window_tokens, intelligence_index, intelligence_estimated, cost_per_task, input_price, output_price, median_tokens_per_second, latency_seconds, total_response_seconds, is_reasoning, is_open_weights, deprecated, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    await database.transaction(async connection => {
      await database.run('DELETE FROM model_rankings', [], connection)
      for (const model of models) await database.run(sql, [String(model.slug ?? ''), String(model.name ?? model.shortName ?? ''), String(model.modelCreatorName ?? 'Unknown'), String(model.modelCreatorColor ?? '#625bf6'), String(model.modelCreatorLogo ?? ''), Number(model.contextWindowTokens ?? 0), model.intelligenceIndex == null ? null : Number(model.intelligenceIndex), model.intelligenceIndexIsEstimated ? 1 : 0, model.intelligenceIndexCostPerTask == null ? null : Number(model.intelligenceIndexCostPerTask), model.price1mInputTokens == null ? null : Number(model.price1mInputTokens), model.price1mOutputTokens == null ? null : Number(model.price1mOutputTokens), model.medianOutputTokensPerSecond == null ? null : Number(model.medianOutputTokensPerSecond), model.medianTimeToFirstTokenSeconds == null ? null : Number(model.medianTimeToFirstTokenSeconds), model.medianEndToEndResponseTimeSeconds == null ? null : Number(model.medianEndToEndResponseTimeSeconds), model.isReasoning ? 1 : 0, model.isOpenWeights ? 1 : 0, model.deprecated ? 1 : 0, syncedAt], connection)
      await database.run('INSERT INTO model_ranking_syncs (source_url, model_count, synced_at) VALUES (?, ?, ?)', [LEADERBOARD_URL, models.length, syncedAt], connection)
    })
    return { count: models.length, syncedAt: syncedAt.toISOString() }
  }
  const sessions = new Map<string, Session>()
  const oauthStates = new Map<string, number>()
  const verifyTurnstile = async (request: IncomingMessage, token: unknown, expectedAction: string) => {
    if (!turnstileSecretKey) return false
    const value = String(token ?? '')
    if (!value || value.length > 2048) return false
    const forwarded = trustProxy ? request.headers['x-forwarded-for'] : undefined
    const remoteip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || request.socket.remoteAddress
    try {
      const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: turnstileSecretKey, response: value, remoteip, idempotency_key: randomUUID() }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!verification.ok) return false
      const result = await verification.json() as TurnstileResult
      return result.success && result.action === expectedAction
    } catch {
      return false
    }
  }
  const cookieSecurity = secureCookies ? '; Secure' : ''
  const createSession = (response: ServerResponse, user: AuthUser, localUserId: number | null = null) => {
    const id = randomBytes(32).toString('hex')
    sessions.set(id, { user, localUserId, expiresAt: Date.now() + SESSION_TTL_MS })
    response.setHeader('set-cookie', `omwai_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${cookieSecurity}`)
  }

  const handle: Middleware = async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'POST' && ['/api/auth/email-code', '/api/auth/register', '/api/auth/login', '/api/auth/reset-password'].includes(url.pathname)) {
      const forwarded = trustProxy ? request.headers['x-forwarded-for'] : undefined
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || request.socket.remoteAddress || 'unknown'
      try {
        if (!await authStore.allowRequest(ip)) return json(response, 429, { error: '请求过于频繁，请稍后再试' })
      } catch {
        return json(response, 503, { error: '认证存储服务暂不可用，请稍后再试' })
      }
    }
    if (!url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/submissions') && !url.pathname.startsWith('/api/admin/') && !url.pathname.startsWith('/api/user/') && !url.pathname.startsWith('/api/model-rankings') && !url.pathname.startsWith('/api/model-prices') && url.pathname !== '/api/site-comparison' && url.pathname !== '/api/directory' && !/^\/api\/site-logos\/\d+$/.test(url.pathname)) return next()
    if (!['/api/auth/me', '/api/auth/turnstile-config', '/api/auth/github', '/api/auth/github/callback', '/api/auth/google', '/api/auth/google/callback', '/api/auth/logout'].includes(url.pathname)) {
      try {
        ready ??= initializeDatabase(database).catch(() => { ready = undefined; throw new Error('数据库服务暂不可用') })
        await ready
        siteLogos.start()
      } catch { return json(response, 503, { error: '数据库服务暂不可用' }) }
    }


    const logoMatch = url.pathname.match(/^\/api\/site-logos\/(\d+)$/)
    if (logoMatch) return serveSiteLogo(database, request, response, Number(logoMatch[1]))

    if (url.pathname === '/api/model-rankings' && request.method === 'GET') {
      const models = await database.prepare(`SELECT slug AS id, name, creator, creator_color AS color, creator_logo AS logo, context_window_tokens AS contextWindowTokens, intelligence_index AS score, intelligence_estimated AS scoreEstimated, cost_per_task AS costPerTask, input_price AS inputPrice, output_price AS outputPrice, median_tokens_per_second AS speed, latency_seconds AS latency, total_response_seconds AS totalResponse, is_reasoning AS reasoning, is_open_weights AS openWeights FROM model_rankings WHERE deprecated = 0 AND intelligence_index IS NOT NULL ORDER BY intelligence_index DESC`).all()
      const latest = await database.prepare('SELECT model_count AS modelCount, synced_at AS syncedAt, source_url AS sourceUrl FROM model_ranking_syncs ORDER BY id DESC LIMIT 1').get() ?? null
      return json(response, 200, { models, latest })
    }
    if (url.pathname === '/api/model-prices' && request.method === 'GET') {
      const prices = await database.prepare("SELECT provider_id AS providerId, model_id AS modelId, name, provider_name AS providerName, provider_icon_url AS providerIconUrl, release_date AS releaseDate, capability_metadata AS capabilityMetadata, reasoning, open_weights AS openWeights, input_price AS inputPrice, output_price AS outputPrice, cached_input_price AS cacheReadPrice, source_url AS sourceUrl FROM model_prices WHERE source_id = 'official'").all<DatabaseRow & PriceRow>()
      const models = mergePrices([...withOpenaiPrices(prices), ...volcengineMediaPrices])
      const latest = await database.prepare('SELECT model_count AS modelCount, provider_count AS providerCount, synced_at AS syncedAt, source_url AS sourceUrl FROM model_price_syncs ORDER BY id DESC LIMIT 1').get() ?? null
      return json(response, 200, { models, latest })
    }

    const sessionId = parseCookies(request).omwai_session
    const session = sessionId ? sessions.get(sessionId) : undefined
    const user = session && session.expiresAt > Date.now() ? session.user : null
    if (sessionId && !user) sessions.delete(sessionId)

    if (/^\/api\/user\/sites\/\d+\/pricing(?:\/sync)?$/.test(url.pathname)) {
      return handlePublicPricing({ database, request, response, url, user, localUserId: user ? session?.localUserId ?? null : null, readJson, json })
    }

    if (url.pathname === '/api/site-comparison' || /^\/api\/user\/sites\/\d+\/(?:authorizations(?:\/[^/]+)?|quotes)$/.test(url.pathname) || /^\/api\/admin\/site-quotes(?:\/\d+)?$/.test(url.pathname)) {
      const localUserId = user ? session?.localUserId ?? null : null
      const admin = localUserId && user?.role === 'admin' ? await database.prepare("SELECT id FROM users WHERE id = ? AND role = 'admin'").get(localUserId) : null
      return handleSiteGroups({ database, request, response, url, localUserId, adminId: admin ? localUserId : null, key: siteKey, readJson, json })
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') return json(response, 200, { user })
    if (url.pathname === '/api/auth/turnstile-config' && request.method === 'GET') return json(response, turnstileSiteKey ? 200 : 503, turnstileSiteKey ? { siteKey: turnstileSiteKey } : { error: '人机验证尚未配置' })
    if (url.pathname === '/api/auth/email-code' && request.method === 'POST') {
      try {
        if (!emailService.configured || !verificationSecret) return json(response, 503, { error: '邮件验证码服务尚未配置' })
        const body = await readJson(request)
        const email = String(body.email ?? '').trim().toLowerCase()
        const purpose = String(body.purpose ?? '') as 'register' | 'reset-password'
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(response, 400, { error: '请输入有效邮箱地址' })
        if (purpose !== 'register' && purpose !== 'reset-password') return json(response, 400, { error: '验证码用途无效' })
        if (!await verifyTurnstile(request, body.turnstileToken, purpose === 'register' ? 'register' : 'reset_password')) return json(response, 400, { error: '人机验证失败或已过期，请重试' })
        const existing = await database.prepare('SELECT id FROM users WHERE email = ?').get(email)
        if (purpose === 'register' && existing) return json(response, 409, { error: '该邮箱已被注册' })
        if (purpose === 'reset-password' && !existing) return json(response, 200, { ok: true, cooldown: CODE_COOLDOWN_MS / 1000 })
        const code = randomInt(100000, 1000000).toString()
        const token = await authStore.issueCode(email, purpose, code)
        if (!token) return json(response, 429, { error: '验证码发送过于频繁，请稍后再试' })
        try {
          await emailService.sendVerificationCode(email, code, purpose)
        } catch (error) {
          await authStore.cancelCode(email, purpose, token)
          throw error
        }
        return json(response, 201, { ok: true, cooldown: CODE_COOLDOWN_MS / 1000 })
      } catch (error) {
        if (error instanceof AuthRedisUnavailableError) return json(response, 503, { error: error.message })
        console.error('Failed to send verification email')
        return json(response, 502, { error: '验证码发送失败，请稍后重试' })
      }
    }
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      try {
        const body = await readJson(request)
        const username = String(body.username ?? '').trim()
        const email = String(body.email ?? '').trim().toLowerCase()
        const password = String(body.password ?? '')
        const code = String(body.code ?? '').trim()
        if (!await verifyTurnstile(request, body.turnstileToken, 'register')) return json(response, 400, { error: '人机验证失败或已过期，请重试' })
        if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) return json(response, 400, { error: '用户名需为 2–24 个字符，可使用文字、数字、_ 或 -' })
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(response, 400, { error: '请输入有效邮箱地址' })
        if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return json(response, 400, { error: '密码需为 8–128 位，并同时包含字母和数字' })
        if (!/^\d{6}$/.test(code)) return json(response, 400, { error: '请输入 6 位邮箱验证码' })
        if (!await authStore.consumeCode(email, 'register', code)) return json(response, 400, { error: '邮箱验证码错误或已失效' })
        const result = await database.run('INSERT INTO users (username, email, password_hash, email_verified_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [username, email, passwordHash(password)])
        const registeredUser = localUser({ id: result.insertId, username, role: 'user' })
        createSession(response, registeredUser, Number(result.insertId))
        return json(response, 201, { user: registeredUser })
      } catch (error) {
        if (error instanceof AuthRedisUnavailableError) return json(response, 503, { error: error.message })
        if (error instanceof Error && (error.message.includes('UNIQUE') || error.message.includes('Duplicate'))) return json(response, 409, { error: '用户名或邮箱已被注册' })
        return json(response, 400, { error: '注册失败，请检查填写信息' })
      }
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await readJson(request)
        const account = String(body.account ?? '').trim()
        const password = String(body.password ?? '')
        if (body.acceptedTerms !== true) return json(response, 400, { error: '请先阅读并同意用户协议和隐私条款' })
        if (!await verifyTurnstile(request, body.turnstileToken, 'login')) return json(response, 400, { error: '人机验证失败或已过期，请重试' })
        const row = await database.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ? OR email = ?').get(account, account) as Record<string, unknown> | undefined
        if (!row || !passwordMatches(password, String(row.password_hash))) return json(response, 401, { error: '账号或密码错误' })
        const signedInUser = localUser(row)
        createSession(response, signedInUser, Number(signedInUser.id))
        return json(response, 200, { user: signedInUser })
      } catch {
        return json(response, 400, { error: '登录请求无效' })
      }
    }
    if (url.pathname === '/api/auth/reset-password' && request.method === 'POST') {
      try {
        const body = await readJson(request)
        const email = String(body.email ?? '').trim().toLowerCase()
        if (!verificationSecret) return json(response, 503, { error: '邮件验证码服务尚未配置' })
        const code = String(body.code ?? '').trim()
        const password = String(body.password ?? '')
        if (!await verifyTurnstile(request, body.turnstileToken, 'reset_password')) return json(response, 400, { error: '人机验证失败或已过期，请重试' })
        if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return json(response, 400, { error: '密码需为 8–128 位，并同时包含字母和数字' })
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return json(response, 400, { error: '邮箱验证码错误或已失效' })
        const account = await database.prepare('SELECT id FROM users WHERE email = ?').get(email)
        if (!account || !await authStore.consumeCode(email, 'reset-password', code)) return json(response, 400, { error: '邮箱验证码错误或已失效' })
        await database.run('UPDATE users SET password_hash = ? WHERE email = ?', [passwordHash(password), email])
        return json(response, 200, { ok: true })
      } catch (error) {
        if (error instanceof AuthRedisUnavailableError) return json(response, 503, { error: error.message })
        return json(response, 400, { error: '密码重置失败，请检查填写信息' })
      }
    }
    if (url.pathname === '/api/auth/github' && request.method === 'GET') {
      if (!clientId || !clientSecret) return json(response, 503, { error: 'GitHub 登录尚未配置，请设置 GITHUB_CLIENT_ID 和 GITHUB_CLIENT_SECRET' })
      const state = randomBytes(24).toString('hex')
      oauthStates.set(state, Date.now() + 10 * 60 * 1000)
      response.statusCode = 302
      response.setHeader('set-cookie', `omwai_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${cookieSecurity}`)
      response.setHeader('location', `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=read%3Auser&state=${state}`)
      return response.end()
    }
    if (url.pathname === '/api/auth/github/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state') ?? ''
      const expectedState = parseCookies(request).omwai_oauth_state
      const expiresAt = oauthStates.get(state) ?? 0
      oauthStates.delete(state)
      if (!state || state !== expectedState || expiresAt < Date.now()) return json(response, 400, { error: '登录请求已失效，请重试' })
      const code = url.searchParams.get('code')
      if (!code) return json(response, 400, { error: 'GitHub 未返回授权码' })
      try {
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, state }),
        })
        const tokenPayload = await tokenResponse.json() as { access_token?: string; error_description?: string }
        if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description ?? '无法获取访问令牌')
        const userResponse = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'OmwAI-Lab' } })
        if (!userResponse.ok) throw new Error('无法获取 GitHub 用户信息')
        const githubProfile = await userResponse.json() as Omit<AuthUser, 'role'>
        createSession(response, { ...githubProfile, role: 'user' })
        response.statusCode = 302
        response.setHeader('location', '/submit')
        return response.end()
      } catch (error) {
        return json(response, 502, { error: error instanceof Error ? error.message : 'GitHub 登录失败' })
      }
    }
    if (url.pathname === '/api/auth/google' && request.method === 'GET') {
      if (!googleClientId || !googleClientSecret) return json(response, 503, { error: 'Google 登录尚未配置，请设置 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET' })
      const state = randomBytes(24).toString('hex')
      oauthStates.set(state, Date.now() + 10 * 60 * 1000)
      const redirectUri = `${publicOrigin || `http://${request.headers.host}`}/api/auth/google/callback`
      response.statusCode = 302
      response.setHeader('set-cookie', `omwai_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${cookieSecurity}`)
      response.setHeader('location', `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20profile%20email&state=${state}`)
      return response.end()
    }
    if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state') ?? ''
      const expectedState = parseCookies(request).omwai_oauth_state
      const expiresAt = oauthStates.get(state) ?? 0
      oauthStates.delete(state)
      if (!state || state !== expectedState || expiresAt < Date.now()) return json(response, 400, { error: '登录请求已失效，请重试' })
      const code = url.searchParams.get('code')
      if (!code) return json(response, 400, { error: 'Google 未返回授权码' })
      try {
        const redirectUri = `${publicOrigin || `http://${request.headers.host}`}/api/auth/google/callback`
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: googleClientId, client_secret: googleClientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }) })
        const token = await tokenResponse.json() as { access_token?: string }
        if (!tokenResponse.ok || !token.access_token) throw new Error('无法获取访问令牌')
        const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } })
        const profile = await profileResponse.json() as { sub: string; name?: string; email?: string; picture?: string }
        if (!profileResponse.ok || !profile.sub) throw new Error('无法获取 Google 用户信息')
        createSession(response, { id: profile.sub, login: profile.email ?? profile.sub, name: profile.name ?? null, avatar_url: profile.picture ?? '', html_url: '', role: 'user' })
        response.statusCode = 302
        response.setHeader('location', '/submit')
        return response.end()
      } catch (error) {
        return json(response, 502, { error: error instanceof Error ? error.message : 'Google 登录失败' })
      }
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      if (sessionId) sessions.delete(sessionId)
      response.setHeader('set-cookie', 'omwai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
      return json(response, 200, { ok: true })
    }
    if (url.pathname === '/api/directory' || url.pathname === '/api/submissions' || url.pathname === '/api/user/sites' || /^\/api\/user\/sites\/\d+\/(listing|invoice|billing|revision|logo(?:\/(preview|refetch|image))?)$/.test(url.pathname)) {
      return handleSiteManagement({ database, request, response, url, user, localUserId: user ? session?.localUserId ?? null : null, key: siteKey, readJson, json })
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!user) return json(response, 401, { error: '请先登录' })
      if (user.role !== 'admin') return json(response, 403, { error: '无权访问管理员后台' })
      const adminAccount = await database.prepare('SELECT id FROM users WHERE username = ? AND role = \'admin\'').get(user.login) as { id: number } | undefined
      if (!adminAccount) return json(response, 403, { error: '管理员身份已失效，请重新登录' })
      const log = async (action: string, targetType: string, targetId: number | null, details = '') => await database.prepare('INSERT INTO audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)').run(adminAccount.id, action, targetType, targetId, details)

      if (url.pathname === '/api/admin/model-rankings/sync' && request.method === 'POST') {
        try {
          const result = await syncModelRankings()
          await log('model-rankings.sync', 'model-ranking', null, `${result.count} models from ${LEADERBOARD_URL}`)
          return json(response, 200, { ok: true, ...result })
        } catch (error) {
          return json(response, 502, { error: error instanceof Error ? error.message : '排行榜同步失败' })
        }
      }
      if (url.pathname === '/api/admin/dashboard' && request.method === 'GET') {
        const counts = await database.prepare("SELECT (SELECT COUNT(*) FROM submissions WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM managed_providers WHERE active = 1) AS providers, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM audit_logs) AS logs").get()
        return json(response, 200, { counts })
      }
      if (/^\/api\/admin\/providers\/\d+\/logo(?:\/(preview|refetch|image))?$/.test(url.pathname) || url.pathname === '/api/admin/submissions' || /^\/api\/admin\/submissions\/\d+$/.test(url.pathname) || /^\/api\/admin\/site-revisions(?:\/\d+)?$/.test(url.pathname)) {
        return handleSiteManagement({ database, request, response, url, user, localUserId: session?.localUserId ?? null, adminId: adminAccount.id, key: siteKey, readJson, json, onApproved: siteLogos.schedule })
      }
      if (url.pathname === '/api/admin/providers' && request.method === 'GET') return json(response, 200, { providers: await database.prepare('SELECT p.*, s.submitter_login, s.status AS submission_status FROM managed_providers p LEFT JOIN submissions s ON s.id = p.submission_id ORDER BY p.created_at DESC').all() })
      if (url.pathname === '/api/admin/providers' && request.method === 'POST') {
        const body = await readJson(request)
        if (!body.name || !body.website || !body.models || !body.pricing) return json(response, 400, { error: '请完整填写站点信息' })
        const result = await database.prepare('INSERT INTO managed_providers (name, website, models, pricing, notes) VALUES (?, ?, ?, ?, ?)').run(String(body.name).trim(), String(body.website).trim(), String(body.models).trim(), String(body.pricing).trim(), String(body.notes ?? '').trim())
        await log('provider.create', 'provider', Number(result.insertId), String(body.name))
        return json(response, 201, { ok: true })
      }
      const providerMatch = url.pathname.match(/^\/api\/admin\/providers\/(\d+)$/)
      if (providerMatch && request.method === 'PATCH') {
        const body = await readJson(request); const id = Number(providerMatch[1])
        const existing = await database.prepare('SELECT * FROM managed_providers WHERE id = ?').get(id) as Record<string, unknown> | undefined
        if (!existing) return json(response, 404, { error: '站点不存在' })
        await database.prepare('UPDATE managed_providers SET name = ?, website = ?, models = ?, pricing = ?, notes = ?, active = ? WHERE id = ?').run(String(body.name ?? existing.name).trim(), String(body.website ?? existing.website).trim(), String(body.models ?? existing.models).trim(), String(body.pricing ?? existing.pricing).trim(), String(body.notes ?? existing.notes).trim(), body.active === undefined ? Number(existing.active) : body.active ? 1 : 0, id)
        await log('provider.update', 'provider', id)
        return json(response, 200, { ok: true })
      }
      if (providerMatch && request.method === 'DELETE') {
        const id = Number(providerMatch[1]); await database.prepare('DELETE FROM managed_providers WHERE id = ?').run(id); await log('provider.delete', 'provider', id)
        return json(response, 200, { ok: true })
      }
      if (url.pathname === '/api/admin/users' && request.method === 'GET') return json(response, 200, { users: await database.prepare('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC').all() })
      const userMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/)
      if (userMatch && request.method === 'PATCH') {
        const body = await readJson(request); const id = Number(userMatch[1]); const role = String(body.role ?? '')
        if (!['user', 'admin'].includes(role)) return json(response, 400, { error: '角色无效' })
        const target = await database.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: string } | undefined
        if (!target) return json(response, 404, { error: '用户不存在' })
        if (target.role === 'admin' && role === 'user') {
          const adminCount = await database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as { count: number }
          if (adminCount.count <= 1) return json(response, 409, { error: '不能移除唯一管理员的权限' })
        }
        await database.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id); await log('user.role', 'user', id, role)
        return json(response, 200, { ok: true })
      }
      if (url.pathname === '/api/admin/audit-logs' && request.method === 'GET') return json(response, 200, { logs: await database.prepare('SELECT audit_logs.*, users.username AS admin_name FROM audit_logs JOIN users ON users.id = audit_logs.admin_id ORDER BY audit_logs.created_at DESC LIMIT 200').all() })
    }
    return json(response, 404, { error: '接口不存在' })
  }

  return { handle, close: async () => { authStore.close(); emailService.close(); await siteLogos.close(); await databaseInstance?.pool.end() } }
}

export type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => unknown | Promise<unknown>

export function createBackend(env: Record<string, string | undefined>) {
  const auth = createAuthMiddleware(env.GITHUB_CLIENT_ID || '', env.GITHUB_CLIENT_SECRET || '', env.GOOGLE_CLIENT_ID || '', env.GOOGLE_CLIENT_SECRET || '', env.DATABASE_URL || '', env.SITE_CREDENTIAL_ENCRYPTION_KEY || '', { host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', user: env.SMTP_USER || '', password: env.SMTP_PASSWORD || '', from: env.SMTP_FROM || '' }, env.EMAIL_VERIFICATION_SECRET || '', env.COOKIE_SECURE === 'true', env.TURNSTILE_SITE_KEY || '', env.TURNSTILE_SECRET_KEY || '', env.REDIS_URL || '', env.REDIS_KEY_PREFIX || 'omwai:auth:', env.TRUST_PROXY === 'true', env.PUBLIC_ORIGIN || '')
  const handle: Middleware = async (request, response, next) => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname
      if (path === '/api/health' && (request.method === 'GET' || request.method === 'HEAD')) return json(response, 200, { status: 'ok' })
      if (path === '/api/probe/groups' || path.startsWith('/api/probe/groups/')) return await probeMiddleware(request, response, next)
      await auth.handle(request, response, next)
    } catch {
      if (!response.headersSent) json(response, 500, { error: '服务暂不可用，请稍后重试' })
      else response.destroy()
    }
  }
  return { handle, close: auth.close }
}
