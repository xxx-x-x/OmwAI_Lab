export type PriceRow = {
  providerId: string
  modelId: string
  name: string
  providerName: string
  providerIconUrl: string
  releaseDate?: string | null
  capabilityMetadata?: string | null
  inputPrice: number | null
  outputPrice: number | null
  cacheReadPrice: number | null
  reasoning: number
  openWeights: number
  sourceUrl: string
  modality?: 'image' | 'video'
  billingUnit?: string
  pricingDetails?: string
  sourceName?: string
  priceCheckedAt?: string
}

export type CapabilityMetadata = {
  type?: string
  modalities?: { input?: string[]; output?: string[] }
  limit?: { context?: number }
}

export function modelCapabilities(row: PriceRow) {
  let metadata: CapabilityMetadata = {}
  try { metadata = JSON.parse(row.capabilityMetadata || '{}') ?? {} } catch { /* Older rows may not have valid metadata. */ }
  const input = metadata.modalities?.input ?? []
  const output = metadata.modalities?.output ?? []
  const type = row.modality ?? metadata.type
  const capabilities: { label: string; description: string }[] = []
  const add = (label: string, description = label) => capabilities.push({ label, description })
  if ((input.includes('text') && output.includes('text') && (!type || type === 'text')) || (!type && !input.length && !output.length)) add('对话')
  if (row.reasoning) add('深度思考')
  if (input.includes('image') && output.includes('text') && (!type || type === 'text')) add('识图')
  if (input.includes('audio') || output.includes('audio') || type === 'audio') add('语音')
  if (input.includes('video') && output.includes('text') && (!type || type === 'text')) add('视频理解')
  if (output.includes('image') || type === 'image') add('图片生成')
  if (output.includes('video') || type === 'video') add('视频生成')
  const context = metadata.limit?.context
  if (typeof context === 'number' && Number.isFinite(context) && context >= 200_000) add('长文本', `上下文窗口：${context.toLocaleString('zh-CN')} Tokens`)
  return capabilities
}

export const VOLCENGINE_CNY_PER_USD = 6.67

export function priceInUsd(value: number | undefined, providerId: string) {
  if (value == null) return null
  return providerId === 'volcengine' ? value / VOLCENGINE_CNY_PER_USD : value
}

const excludedProviders = new Set([
  'arcee', 'cohere', 'inception', 'mistral', 'morph', 'nova',
  'poolside', 'sakana', 'sarvam', 'stepfun-ai', 'thinkingmachines', 'upstage',
])

const versionSuffix = /(?:\s*\((?:latest|preview|non[- ]?reasoning|reasoning|thinking|\d{4}[-/]\d{2}[-/]\d{2})\)|\s+\d{4}[-/]\d{2}[-/]\d{2}|\s+\d{8})$/i

function baseName(name: string) {
  let result = name.trim()
  while (versionSuffix.test(result)) result = result.replace(versionSuffix, '').trim()
  return result
}

function displayName(row: PriceRow) {
  if (row.providerId === 'volcengine' && row.modelId.startsWith('doubao-')) {
    return row.modelId.replace(/-\d{6}$/, '').replace(/^(doubao-seed(?:ance)?-)(\d+)-(\d+)(?=-|$)/, '$1$2.$3')
  }
  return baseName(row.name)
}

function priority(row: PriceRow) {
  const id = row.modelId.toLowerCase()
  return [row.inputPrice != null || row.outputPrice != null ? 0 : 1,
    /(?:[-_](?:preview|latest|reasoning|non-reasoning|thinking|\d{4}[-/]?\d{2}(?:[-/]?\d{2})?|\d{8}))$/.test(id) ? 1 : 0,
    id.length]
}

function preferred(a: PriceRow, b: PriceRow) {
  const left = priority(a)
  const right = priority(b)
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] < right[i]
  return a.modelId.localeCompare(b.modelId) < 0
}

export function mergePrices(rows: PriceRow[]) {
  const groups = new Map<string, PriceRow>()
  for (const row of rows) {
    if (excludedProviders.has(row.providerId.toLowerCase())) continue
    const key = `${row.providerId.toLowerCase()}:${baseName(row.name).toLowerCase()}`
    const existing = groups.get(key)
    if (!existing || preferred(row, existing)) groups.set(key, row)
  }
  return [...groups.values()].map(row => ({
    id: `${row.providerId}:${row.modelId}`,
    modelId: row.modelId,
    name: displayName(row),
    company: row.providerName,
    family: row.providerName,
    providerIconUrl: row.providerIconUrl,
    releaseDate: row.releaseDate || null,
    capabilities: modelCapabilities(row),
    modality: row.modality ?? 'text',
    billingUnit: row.billingUnit ?? '百万 Tokens',
    pricingDetails: row.pricingDetails ?? '',
    priceCheckedAt: row.priceCheckedAt,
    priceSource: row.inputPrice != null || row.outputPrice != null
      ? row.providerId === 'volcengine' ? `${row.sourceName ?? 'BaseLLM'} 人民币报价折算（1 USD = ${VOLCENGINE_CNY_PER_USD} CNY）` : row.sourceName ? `${row.sourceName}价格` : 'BaseLLM 价格'
      : 'BaseLLM 暂无报价',
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    cacheReadPrice: row.cacheReadPrice,
    reasoning: row.reasoning,
    openWeights: row.openWeights,
    sourceUrl: row.inputPrice != null || row.outputPrice != null ? row.sourceUrl : '',
  })).sort((a, b) => a.family.localeCompare(b.family, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'))
}
