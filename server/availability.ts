import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.js'
import { ownerIdentity, type SiteOwner } from './site-management.js'
import { monitorPayload, requireUptimeEncryption, safeBeats, validateMonitorTarget, withUptime, type UptimeConfig, type UptimeRpc } from './uptime.js'
import { fetchAvailabilityModels, validMonitorKey } from './availability-models.js'

type Context = { database: Database; request: IncomingMessage; response: ServerResponse; url: URL; user: SiteOwner | null; localUserId: number | null; config: UptimeConfig; readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>; json: (res: ServerResponse, status: number, payload: unknown) => void; connect?: typeof withUptime; models?: typeof fetchAvailabilityModels }
const fields = 'id, COALESCE(task_group_id, id) AS taskGroupId, submission_id AS siteId, group_name AS groupName, model, interval_seconds AS intervalSeconds, endpoint, state, created_at AS createdAt'
const safeError = (error: unknown) => error instanceof Error && /^(请选择|分组不存在|任务配额|API 地址|API address|基址仅|请填写|绑定配置|任务绑定|监控服务|DNS 校验|模型列表获取失败)/.test(error.message) ? error.message : '监控操作未完成，请刷新核对；待绑定任务请联系管理员，不要重复创建'
const requests = new Map<string, { at: number; reads: number; mutations: number }>()
let inFlight = 0
const limitedConnect: typeof withUptime = async (config, action) => {
  if (inFlight >= 4) throw new Error('监控服务繁忙，请稍后重试')
  inFlight++
  try { return await withUptime(config, action) } finally { inFlight-- }
}
export async function handleAvailability(c: Context) {
  const { database: db, request: req, response: res, config } = c
  const send = (status: number, payload: unknown) => c.json(res, status, payload)
  res.setHeader('cache-control', 'no-store')
  if (!c.user) return send(401, { error: '请先登录' })
  const owner = ownerIdentity(c.user, c.localUserId)
  const connect = c.connect || limitedConnect
  const now = Date.now()
  for (const [id, entry] of requests) if (now - entry.at >= 60000) requests.delete(id)
  const quota = requests.get(owner) || { at: now, reads: 0, mutations: 0 }
  const bucket = req.method === 'GET' ? 'reads' : 'mutations'
  const limit = bucket === 'reads' ? 120 : 60
  quota[bucket]++; requests.set(owner, quota)
  if (quota[bucket] > limit) return send(429, { error: '监控请求过于频繁，请稍后重试' })
  try {
    if (req.method === 'GET' && c.url.pathname === '/api/user/availability') {
      const tasks = await db.all(`SELECT ${fields} FROM lab_monitors WHERE BINARY owner_identity = BINARY ? AND state <> 'deleted' ORDER BY created_at DESC LIMIT 100`, [owner])
      const sites = await db.all(`SELECT s.id, s.name, s.website, g.group_name AS groupName FROM submissions s LEFT JOIN site_public_groups g ON g.submission_id = s.id AND BINARY g.website = BINARY s.website WHERE s.status = 'approved' AND (BINARY s.owner_identity = BINARY ? OR (? IS NOT NULL AND s.user_id = ?)) ORDER BY s.id`, [owner, c.localUserId, c.localUserId])
      return send(200, { enabled: config.enabled, tasks, sites, minInterval: 900, maxTasks: 5, maxModels: 5 })
    }
    if (!config.enabled) return send(503, { error: '持续监控尚未启用（需配置服务端凭证、源站白名单及 Uptime 出站隔离）' })
    if (req.method === 'POST' && c.url.pathname === '/api/user/availability/models') {
      const body = await c.readJson(req)
      if (!validMonitorKey(body.key) || !Number.isInteger(body.siteId) || typeof body.groupName !== 'string' || body.groupName.length > 191) return send(400, { error: '站点、分组或 KEY 格式无效' })
      const endpoint = await validateMonitorTarget(body.baseUrl, config)
      const site = await db.get(`SELECT s.id, s.website FROM submissions s WHERE s.id = ? AND s.status = 'approved' AND (BINARY s.owner_identity = BINARY ? OR (? IS NOT NULL AND s.user_id = ?))`, [Number(body.siteId), owner, c.localUserId, c.localUserId])
      if (!site || new URL(String(site.website)).origin !== new URL(endpoint).origin) throw new Error('请选择自己已审核站点的 API 源站')
      if (body.groupName && !await db.get('SELECT submission_id FROM site_public_groups WHERE submission_id = ? AND BINARY group_name = BINARY ? AND BINARY website = BINARY ?', [Number(body.siteId), body.groupName, String(site.website)])) throw new Error('分组不存在，请刷新')
      return send(200, { models: await (c.models || fetchAvailabilityModels)(String(body.baseUrl), body.key, config) })
    }
    if (req.method === 'POST' && c.url.pathname === '/api/user/availability') {
      const body = await c.readJson(req)
      if (body.costConfirmed !== true || body.keyConfirmed !== true) return send(400, { error: '请确认持续费用及专用低额度 KEY 风险' })
      const selected: unknown = body.models === undefined ? [body.model] : body.models
      const key = body.key, group = body.groupName, interval = body.intervalSeconds, siteId = body.siteId
      if (!Array.isArray(selected) || selected.length < 1 || selected.length > 5 || selected.some(model => typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,190}$/.test(model)) || new Set(selected).size !== selected.length || !validMonitorKey(key) || typeof group !== 'string' || group.length > 191 || !Number.isInteger(siteId) || !Number.isInteger(interval) || Number(interval) < 900 || Number(interval) > 86400) return send(400, { error: '站点、分组、模型、KEY 或间隔格式无效（模型须为 1–5 个不重复 ID）' })
      const endpoint = await validateMonitorTarget(body.baseUrl, config)
      const taskGroupId = randomUUID()
      const tasks = (selected as string[]).map(model => ({ id: randomUUID(), model, state: 'pending' as 'pending' | 'paused' }))
      await db.transaction(async connection => {
        await db.get('SELECT id FROM lab_monitor_lock WHERE id = 1 FOR UPDATE', [], connection)
        const site = await db.get(`SELECT s.id, s.website FROM submissions s WHERE s.id = ? AND s.status = 'approved' AND (BINARY s.owner_identity = BINARY ? OR (? IS NOT NULL AND s.user_id = ?)) FOR UPDATE`, [Number(siteId), owner, c.localUserId, c.localUserId], connection)
        if (!site || new URL(String(site.website)).origin !== new URL(endpoint).origin) throw new Error('请选择自己已审核站点的 API 源站')
        if (group && !await db.get('SELECT submission_id FROM site_public_groups WHERE submission_id = ? AND BINARY group_name = BINARY ? AND BINARY website = BINARY ?', [Number(siteId), group, String(site.website)], connection)) throw new Error('分组不存在，请刷新；无公开分组时可选择未指定')
        const models = await (c.models || fetchAvailabilityModels)(String(body.baseUrl), key, config)
        if (tasks.some(task => !models.includes(task.model))) throw new Error('请选择当前 KEY 的上游模型列表中的模型，刷新列表后重试')
        const quota = await db.get(`SELECT SUM(state <> 'deleted') AS total, COUNT(DISTINCT CASE WHEN BINARY owner_identity = BINARY ? AND state <> 'deleted' THEN COALESCE(task_group_id, id) END) AS owned, COUNT(DISTINCT CASE WHEN BINARY owner_identity = BINARY ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY THEN COALESCE(task_group_id, id) END) AS daily FROM lab_monitors`, [owner, owner], connection)
        if (Number(quota?.total) + tasks.length > 200 || Number(quota?.owned) >= 5 || Number(quota?.daily) >= 10) throw new Error('任务配额已满（每人 5 组，每组最多 5 个模型，每日 10 次组创建，全局 200 个探测）')
        for (const task of tasks) await db.run(`INSERT INTO lab_monitors (id, task_group_id, owner_identity, submission_id, group_name, model, interval_seconds, endpoint, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, [task.id, taskGroupId, owner, Number(siteId), group, task.model, Number(interval), endpoint], connection)
      })
      // Reserve the entire group atomically. Stop on uncertainty; never retry, delete or adopt remote monitors.
      try {
        await connect(config, async rpc => {
          await requireUptimeEncryption(rpc)
          for (const task of tasks) {
            const added = await rpc('add', monitorPayload(`Lab:${task.id}`, endpoint, task.model, key, Number(interval)))
            if (!Number.isSafeInteger(added.monitorID) || Number(added.monitorID) <= 0) throw new Error('任务绑定失败，请联系管理员检查待绑定任务')
            await db.run("UPDATE lab_monitors SET monitor_id = ?, state = 'paused' WHERE id = ? AND BINARY owner_identity = BINARY ?", [Number(added.monitorID), task.id, owner])
            task.state = 'paused'
          }
        })
      } catch (error) {
        return send(tasks.some(task => task.state === 'paused') ? 207 : 400, { ok: false, partial: true, id: tasks[0].id, taskGroupId, models: tasks, error: safeError(error) })
      }
      return send(201, { ok: true, id: tasks[0].id, taskGroupId, models: tasks, message: '任务已创建为暂停状态，请核对费用后启用' })
    }
    const match = c.url.pathname.match(/^\/api\/user\/availability\/([\da-f-]{36})(?:\/(history|pause|resume))?$/)
    if (!match) return send(404, { error: '接口不存在' })
    const task = await db.get("SELECT * FROM lab_monitors WHERE id = ? AND BINARY owner_identity = BINARY ? AND state <> 'deleted'", [match[1], owner])
    if (!task) return send(404, { error: '任务不存在' })
    if (!task.monitor_id) return send(409, { error: '任务绑定结果不确定；管理员需按任务 UUID 核对 Uptime 与数据库，禁止自动重建' })
    const action = match[2]
    if (!(req.method === 'GET' && action === 'history') && !(req.method === 'POST' && ['pause', 'resume'].includes(action || '')) && !(req.method === 'DELETE' && !action)) return send(405, { error: '不支持的操作' })
    return await db.transaction(async connection => {
      const current = await db.get("SELECT id FROM lab_monitors WHERE id = ? AND BINARY owner_identity = BINARY ? AND state <> 'deleted' FOR UPDATE", [String(task.id), owner], connection)
      if (!current) return send(404, { error: '任务不存在' })
      return await connect(config, async (rpc: UptimeRpc) => {
      const monitorId = Number(task.monitor_id)
      const { monitor } = await rpc('getMonitor', monitorId)
      if (!monitor || monitor.name !== `Lab:${task.id}` || monitor.url !== task.endpoint || monitor.type !== 'json-query' || monitor.parent != null || Number(monitor.maxredirects) !== 0 || Number(monitor.interval) !== Number(task.interval_seconds)) throw new Error('绑定配置已在 Uptime 改动，操作已拒绝，请管理员核对')
      if (action === 'resume') {
        await requireUptimeEncryption(rpc)
        if (monitor.labCredentialEncrypted !== true) throw new Error('监控服务中的旧 Lab 凭证尚未迁移，禁止启用')
        const expected = monitorPayload(`Lab:${task.id}`, String(task.endpoint), String(task.model), '', Number(task.interval_seconds))
        if (monitor.method !== expected.method || monitor.body !== expected.body || monitor.jsonPath !== expected.jsonPath || monitor.jsonPathOperator !== expected.jsonPathOperator || String(monitor.expectedValue) !== expected.expectedValue || Number(monitor.timeout) !== 30 || Number(monitor.maxretries) !== 0 || monitor.ignoreTls || monitor.upsideDown || !Array.isArray(monitor.accepted_statuscodes) || monitor.accepted_statuscodes.join(',') !== '200') throw new Error('绑定配置已在 Uptime 改动，启用已拒绝，请管理员核对')
      }
      if (req.method === 'GET') {
        const beats = await rpc('getMonitorBeats', monitorId, 24)
        return send(200, { active: Boolean(monitor.active), beats: safeBeats(beats.data || []), hours: 24 })
      }
      if (action === 'resume') {
        const body = await c.readJson(req)
        if (body.costConfirmed !== true) return send(400, { error: '启用前须重新确认持续调用费用' })
        await validateMonitorTarget(new URL(String(task.endpoint)).origin, config)
      }
      if (req.method === 'DELETE') {
        const body = await c.readJson(req)
        if (body.deleteConfirmed !== true) return send(400, { error: '请确认删除该 Lab 任务及其 Uptime 历史' })
        await rpc('deleteMonitor', monitorId, false)
      } else await rpc(action === 'resume' ? 'resumeMonitor' : 'pauseMonitor', monitorId)
      await db.run('UPDATE lab_monitors SET state = ? WHERE id = ? AND BINARY owner_identity = BINARY ?', [req.method === 'DELETE' ? 'deleted' : action === 'resume' ? 'active' : 'paused',       String(task.id), owner], connection)
      return send(200, { ok: true })
            })
          })
  } catch (error) {
    // Never forward upstream errors, request/response bodies or credential-bearing monitor objects.
    return send(400, { error: safeError(error) })
  }
}
