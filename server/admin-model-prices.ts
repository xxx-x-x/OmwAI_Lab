import type { Database } from './mysql.ts'
import { EFFECTIVE_PRICE_ROWS, PRICE_INSERT } from './price-store.ts'

export function validateManualModel(body: Record<string, unknown>) {
  const text = (key: string, max: number, identifier = false) => {
    const value = body[key]
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || hasControlCharacters(value, identifier)) throw new Error(`${key} 无效（最多 ${max} 字符，不得包含控制字符或首尾空格）`)
    return value
  }
  if (body.sourceId !== undefined && body.sourceId !== 'manual') throw new Error('新增模型只能使用 manual 来源')
  const providerId = text('providerId', 100, true)
  const modelId = text('modelId', 191, true)
  if (/^ranking:/i.test(modelId)) throw new Error('请填写真实 API 模型 ID，不接受排行榜命名空间')
  const name = text('name', 255)
  const providerName = text('providerName', 255)
  const billingUnit = text('billingUnit', 128)
  if (!['text', 'image', 'video', 'audio'].includes(String(body.modality))) throw new Error('模型模态无效')
  for (const key of ['reasoning', 'openWeights']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new Error(`${key} 必须为布尔值`)
  return { ...validatePriceOverride(body), providerId, modelId, name, providerName, billingUnit, modality: String(body.modality), reasoning: body.reasoning === true, openWeights: body.openWeights === true }
}

export async function createAdminModelPrice(db: Database, body: Record<string, unknown>, adminId: number) {
  const model = validateManualModel(body)
  try {
    return await db.transaction(async connection => {
      const identity = ['manual', model.providerId, model.modelId]
      const existing = await db.get('SELECT model_id FROM model_prices WHERE source_id = ? AND provider_id = ? AND model_id = ?', identity, connection)
      if (existing) return { status: 409, error: '该提供商 / 模型 ID 的人工记录已存在，请编辑现有记录' }
      const now = new Date()
      await db.run(PRICE_INSERT, [...identity, model.modelId, model.name, model.providerName, '', model.releaseDate, JSON.stringify({ type: model.modality, modalities: { input: ['text'], output: [model.modality] } }), model.inputPrice, model.outputPrice, model.cacheReadPrice, model.reasoning, model.openWeights, model.sourceUrl, model.modality, model.billingUnit, null, model.sourceName, now.toISOString().slice(0, 10), now], connection)
      await db.run('INSERT INTO audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [adminId, 'model-price.create', 'model-price', null, JSON.stringify({ identity, before: null, after: model })], connection)
      return { status: 201, ok: true }
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') return { status: 409, error: '模型记录已存在，请刷新后编辑' }
    throw error
  }
}

const hasControlCharacters = (value: string, spaces = false) => [...value].some(char => char.charCodeAt(0) < (spaces ? 33 : 32) || char.charCodeAt(0) === 127)

export function validatePriceOverride(body: Record<string, unknown>) {
  const price = (key: string) => {
    const value = body[key]
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${key} 必须为非负有限数字或 null`)
    return value
  }
  const releaseDate = body.releaseDate
  if (releaseDate !== null && (typeof releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || releaseDate < '1000-01-01' || !Number.isFinite(Date.parse(`${releaseDate}T00:00:00Z`)) || new Date(`${releaseDate}T00:00:00Z`).toISOString().slice(0, 10) !== releaseDate)) throw new Error('发布日期必须为真实 YYYY-MM-DD 日期或 null')
  if (typeof body.sourceName !== 'string' || !body.sourceName.trim() || body.sourceName.length > 255 || hasControlCharacters(body.sourceName)) throw new Error('请填写有效的价格核验来源（最多 255 字符）')
  if (typeof body.sourceUrl !== 'string' || body.sourceUrl.length > 2048) throw new Error('请填写有效的来源 URL')
  let url: URL
  try { url = new URL(body.sourceUrl) } catch { throw new Error('来源必须为完整 HTTP(S) URL') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || hasControlCharacters(body.sourceUrl, true)) throw new Error('来源必须为无凭据的 HTTP(S) URL')
  return { inputPrice: price('inputPrice'), outputPrice: price('outputPrice'), cacheReadPrice: price('cacheReadPrice'), releaseDate: releaseDate as string | null, sourceUrl: url.href, sourceName: body.sourceName.trim() }
}

export function priceIdentity(body: Record<string, unknown>) {
  if (!['official', 'curated', 'manual'].includes(String(body.sourceId))) throw new Error('不支持的价格来源')
  return ['sourceId', 'providerId', 'modelId'].map((key, index) => {
    const value = body[key]
    if (typeof value !== 'string' || !value.trim() || value.length > (index === 2 ? 191 : 100) || hasControlCharacters(value)) throw new Error('模型来源 / 提供商 / 模型标识无效')
    return value
  })
}

export async function listAdminModelPrices(db: Database, params: URLSearchParams) {
  const query = (params.get('q') ?? '').trim()
  const page = Number(params.get('page') ?? 1)
  const pageSize = Number(params.get('pageSize') ?? 25)
  if (query.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('搜索或分页参数无效')
  const where = `WHERE source_id IN ('official', 'curated', 'manual') AND (? = '' OR LOCATE(?, CONCAT_WS(' ', source_id, provider_id, model_id, name, provider_name)) > 0)`
  const total = await db.get(`SELECT COUNT(*) AS total FROM model_prices ${where}`, [query, query])
  const rows = await db.all(`SELECT * FROM (${EFFECTIVE_PRICE_ROWS}) prices ${where} ORDER BY release_date IS NULL, release_date DESC, provider_name, name, BINARY source_id, BINARY provider_id, BINARY model_id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, [query, query])
  return { rows, total: Number(total?.total ?? 0), page, pageSize }
}

export async function editAdminModelPrice(db: Database, body: Record<string, unknown>, adminId: number, reset = false) {
  const identity = priceIdentity(body)
  const override = reset ? null : validatePriceOverride(body)
  return db.transaction(async connection => {
    const row = await db.get(`SELECT * FROM model_prices WHERE BINARY source_id = BINARY ? AND BINARY provider_id = BINARY ? AND BINARY model_id = BINARY ? FOR UPDATE`, identity, connection)
    if (!row) return { status: 404, error: '模型记录不存在，请刷新列表' }
    const previous = await db.get('SELECT * FROM model_price_overrides WHERE source_id = ? AND provider_id = ? AND model_id = ? FOR UPDATE', identity, connection)
    if (override) {
      await db.run(`INSERT INTO model_price_overrides (source_id, provider_id, model_id, input_price, output_price, cached_input_price, release_date, source_url, source_name, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE input_price = VALUES(input_price), output_price = VALUES(output_price), cached_input_price = VALUES(cached_input_price), release_date = VALUES(release_date), source_url = VALUES(source_url), source_name = VALUES(source_name), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`, [...identity, override.inputPrice, override.outputPrice, override.cacheReadPrice, override.releaseDate, override.sourceUrl, override.sourceName, adminId], connection)
    } else await db.run('DELETE FROM model_price_overrides WHERE source_id = ? AND provider_id = ? AND model_id = ?', identity, connection)
    await db.run('INSERT INTO audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [adminId, reset ? 'model-price.reset' : 'model-price.override', 'model-price', null, JSON.stringify({ identity, before: previous ?? null, after: override })], connection)
    return { status: 200, ok: true }
  })
}
