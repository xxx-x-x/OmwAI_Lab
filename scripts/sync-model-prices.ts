import { createDatabase, initializeDatabase } from '../server/mysql.ts'
import { modelKey } from '../server/model-key.ts'
import { priceInUsd, type CapabilityMetadata } from '../server/pricing.ts'

const INDEX_URL = 'https://basellm.github.io/llm-metadata/api/index.json'
const PROVIDER_URL = 'https://basellm.github.io/llm-metadata/api/providers/'
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('缺少 DATABASE_URL')

type IndexProvider = { id: string; name: string; iconURL?: string; currency?: string; subscription?: boolean }
type Price = { input?: number; output?: number; cache_read?: number }
type ProviderModel = CapabilityMetadata & { id: string; name: string; cost?: Price; reasoning?: boolean; open_weights?: boolean; status?: string; release_date?: string }
type ProviderPayload = { id: string; name?: string; doc?: string; models: Record<string, ProviderModel> }

async function getJson<T>(url: string) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'OmwAI-Lab-Pricing-Sync/1.0' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`)
  return response.json() as Promise<T>
}

const index = await getJson<{ providers: IndexProvider[] }>(INDEX_URL)
const providers = index.providers.filter(provider => (!provider.currency || provider.id === 'volcengine' && provider.currency === 'CNY') && !provider.subscription)
const rows: Array<{ providerId: string; modelId: string; key: string; name: string; providerName: string; providerIconUrl: string; releaseDate: string | null; capabilityMetadata: string; input: number | null; output: number | null; cacheRead: number | null; reasoning: number; openWeights: number; source: string }> = []
for (const provider of providers) {
  const payload = await getJson<ProviderPayload>(`${PROVIDER_URL}${encodeURIComponent(provider.id)}.json`)
  for (const model of Object.values(payload.models)) {
    if (model.status === 'deprecated') continue
    if (!model.cost && !['openai', 'anthropic', 'google', 'xai', 'deepseek', 'moonshotai', 'minimax', 'xiaomi', 'zai', 'alibaba'].includes(provider.id)) continue
    rows.push({ providerId: provider.id, modelId: model.id, key: modelKey(model.id || model.name), name: model.name, providerName: provider.id === 'volcengine' ? '火山引擎' : provider.name, providerIconUrl: provider.iconURL ?? '', releaseDate: model.release_date || null, capabilityMetadata: JSON.stringify({ type: model.type, modalities: model.modalities, limit: model.limit }), input: priceInUsd(model.cost?.input, provider.id), output: priceInUsd(model.cost?.output, provider.id), cacheRead: priceInUsd(model.cost?.cache_read, provider.id), reasoning: model.reasoning ? 1 : 0, openWeights: model.open_weights ? 1 : 0, source: provider.id === 'volcengine' ? 'https://docs.volcengine.com/docs/ark/model-pricing?lang=zh' : payload.doc ?? `${PROVIDER_URL}${provider.id}.json` })
  }
}
if (rows.length < 100) throw new Error(`BaseLLM 仅返回 ${rows.length} 个有效模型条目，已保留原数据`)

const database = createDatabase(databaseUrl)
await initializeDatabase(database)
const syncedAt = new Date()
await database.transaction(async connection => {
  await database.run("DELETE FROM model_prices WHERE source_id = 'official'", [], connection)
  const sql = `INSERT INTO model_prices (source_id, provider_id, model_id, model_key, name, provider_name, provider_icon_url, release_date, capability_metadata, input_price, output_price, cached_input_price, reasoning, open_weights, source_url, synced_at) VALUES ('official', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  for (const row of rows) await database.run(sql, [row.providerId, row.modelId, row.key, row.name, row.providerName, row.providerIconUrl, row.releaseDate, row.capabilityMetadata, row.input, row.output, row.cacheRead, row.reasoning, row.openWeights, row.source, syncedAt], connection)
  await database.run('INSERT INTO model_price_syncs (source_url, model_count, provider_count, synced_at) VALUES (?, ?, ?, ?)', [INDEX_URL, rows.length, providers.length, syncedAt], connection)
})
await database.pool.end()
console.log(JSON.stringify({ models: rows.length, providers: providers.length, syncedAt: syncedAt.toISOString(), source: INDEX_URL }, null, 2))
