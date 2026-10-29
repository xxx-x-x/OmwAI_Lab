import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TTL = 24 * 60 * 60_000
const messages: Record<string, string> = {
  invalid_input: '检测参数无效', invalid_public_https_base_url: '仅支持公网 HTTPS API 地址',
  submission_rate_limited: '检测服务繁忙，请稍后再试', queue_unavailable: '检测队列暂不可用',
  unsupported_baseline_model: '该型号暂无对应行为基准', fingerprint_scorer_unavailable: '行为评分服务尚未启用',
  request_budget_confirmation_required: '请求预算已变化，请刷新后重新确认',
  credential_in_public_configuration: '地址或模型名称不能包含 API Key',
  unsupported_collection_contract: '该型号暂不支持在线采样',
}

export function createDetector(env: Record<string, string | undefined>, transport: typeof fetch = fetch) {
  const endpoint = env.DETECTOR_URL
  const adminToken = env.DETECTOR_ADMIN_TOKEN
  const secret = env.DETECTOR_ACCESS_SECRET
  let origin = ''
  if (endpoint) {
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid DETECTOR_URL')
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('DETECTOR_URL requires HTTPS outside loopback')
    origin = url.origin
  }
  const enabled = Boolean(origin && adminToken && adminToken.length >= 32 && secret && secret.length >= 32)
  const limits = new Map<string, { count: number; reset: number }>()
  let lastSubmit = 0
  const allow = (key: string, max: number, window: number) => {
    const now = Date.now()
    for (const [id, value] of limits) if (value.reset <= now) limits.delete(id)
    let entry = limits.get(key)
    if (!entry) {
      if (limits.size >= 10_000) return false
      entry = { count: 0, reset: now + window }; limits.set(key, entry)
    }
    return ++entry.count <= max
  }
  const signature = (value: string) => createHmac('sha256', secret!).update(value).digest('base64url')
  const access = (id: string) => { const value = `${id}.${Date.now() + TTL}`; return `${value}.${signature(value)}` }
  const authorized = (id: string, request: IncomingMessage) => {
    const token = String(request.headers['x-detector-access'] || '')
    const [task, expires, mac, extra] = token.split('.')
    if (task !== id || !/^\d{13}$/.test(expires || '') || Number(expires) <= Date.now() || extra !== undefined || !mac) return false
    const expected = Buffer.from(signature(`${task}.${expires}`)); const actual = Buffer.from(mac)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  const upstream = async (path: string, method = 'GET', body?: unknown) => {
    const result = await transport(origin + path, { method, headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(12_000) })
    const chunks: Uint8Array[] = []; let bytes = 0
    if (result.body) for await (const chunk of result.body) {
      bytes += chunk.byteLength
      if (bytes > 512 * 1024) { await result.body.cancel().catch(() => {}); throw new Error('oversized_response') }
      chunks.push(chunk)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
    return { status: result.status, data }
  }
  return async (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, payload: unknown) => {
      response.statusCode = status; response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store'); response.end(JSON.stringify(payload))
    }
    if (!enabled) return send(503, { error: '模型检测服务尚未配置，请稍后再试' })
    const path = new URL(request.url || '/', 'http://localhost').pathname
    const ip = env.TRUST_PROXY === 'true' ? String(request.headers['x-forwarded-for'] || request.socket.remoteAddress).split(',')[0].trim() : request.socket.remoteAddress || 'unknown'
    if (!allow(`read:${ip}`, 120, 60_000)) return send(429, { error: '访问过于频繁，请稍后再试' })
    try {
      if (path === '/api/detector/capabilities' && request.method === 'GET') {
        const result = await upstream('/v1/capabilities')
        if (result.status !== 200) return send(503, { error: '检测服务暂不可用' })
        return send(200, { detection: result.data.detection, fingerprint: result.data.fingerprint })
      }
      if (['/api/detector/tasks', '/api/detector/fingerprint-tasks'].includes(path) && request.method === 'POST') {
        let text = ''; for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 8192) return send(413, { error: '请求内容过大' }) }
        let body: Record<string, unknown>
        try { body = JSON.parse(text) } catch { return send(400, { error: '请求必须是 JSON' }) }
        if (!body || typeof body !== 'object' || Array.isArray(body) || body.consent !== true) return send(400, { error: '请先确认真实请求费用与检测限制' })
        const { consent: _consent, ...input } = body
        if (!allow(`submit:${ip}`, 5, 60 * 60_000) || !allow('submit:global', 100, 60 * 60_000) || Date.now() - lastSubmit < 5500) return send(429, { error: '提交过于频繁，每 IP 每小时最多 5 次；请稍后重试' })
        lastSubmit = Date.now()
        const result = await upstream(path.replace('/api/detector', '/v1'), 'POST', input)
        if (result.status !== 202) return send([400, 429, 503].includes(result.status) ? result.status : 502, { error: messages[String(result.data.error)] || '检测服务暂不可用，请检查参数或稍后重试' })
        if (typeof result.data.id !== 'string' || !UUID.test(result.data.id)) throw new Error('invalid_task')
        return send(202, { id: result.data.id, state: result.data.state, accessToken: access(result.data.id) })
      }
      const match = path.match(/^\/api\/detector\/tasks\/([^/]+)$/)
      if (match && UUID.test(match[1]) && ['GET', 'DELETE'].includes(request.method || '')) {
        if (!authorized(match[1], request)) return send(404, { error: '任务不存在或访问凭证已过期' })
        const result = await upstream(`/v1/tasks/${match[1]}`, request.method)
        if (![200, 202].includes(result.status)) return send(result.status === 404 ? 404 : 502, { error: '无法读取或取消检测任务' })
        // Do not expose the submitted endpoint or internal task configuration.
        return send(result.status, { id: result.data.id, state: result.data.state, report: result.data.report, cancellationRequested: result.data.cancellationRequested, createdAt: result.data.createdAt, expiresAt: result.data.expiresAt })
      }
      return send(404, { error: '接口不存在' })
    } catch { return send(502, { error: '检测服务连接失败或超时，请稍后查询任务状态；不要立即重复提交' }) }
  }
}
