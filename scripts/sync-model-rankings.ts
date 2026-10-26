import { createDatabase, initializeDatabase } from '../server/mysql.ts'

const LEADERBOARD_URL = 'https://artificialanalysis.ai/leaderboards/models'
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('缺少 DATABASE_URL')

const response = await fetch(LEADERBOARD_URL, {
  headers: { accept: 'text/html', 'user-agent': 'OmwAI-Lab-Leaderboard-Sync/1.0' },
  signal: AbortSignal.timeout(30_000),
})
if (!response.ok) throw new Error(`排行榜源站返回 HTTP ${response.status}`)
const html = await response.text()
if (Buffer.byteLength(html) > MAX_RESPONSE_BYTES) throw new Error('排行榜源站响应过大')
const markerIndex = html.indexOf('initialModels\\":')
const start = html.indexOf('[', markerIndex)
const end = html.indexOf('}],\\"', start) + 2
if (markerIndex < 0 || start < 0 || end < 2) throw new Error('未能识别排行榜数据格式')
const models = JSON.parse(html.slice(start, end).replaceAll('\\"', '"').replaceAll('\\\\', '\\')) as Record<string, unknown>[]
if (models.length < 50) throw new Error(`源站仅返回 ${models.length} 个模型，已保留原有数据`)

const database = createDatabase(databaseUrl)
await initializeDatabase(database)
const syncedAt = new Date()
const syncedAtIso = syncedAt.toISOString()
const sql = `INSERT INTO model_rankings (slug, name, creator, creator_color, creator_logo, context_window_tokens, intelligence_index, intelligence_estimated, cost_per_task, input_price, output_price, median_tokens_per_second, latency_seconds, total_response_seconds, is_reasoning, is_open_weights, deprecated, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
await database.transaction(async connection => {
  await database.run('DELETE FROM model_rankings', [], connection)
  for (const model of models) {
    await database.run(sql, [String(model.slug ?? ''), String(model.name ?? model.shortName ?? ''), String(model.modelCreatorName ?? 'Unknown'), String(model.modelCreatorColor ?? '#625bf6'), String(model.modelCreatorLogo ?? ''), Number(model.contextWindowTokens ?? 0), model.intelligenceIndex == null ? null : Number(model.intelligenceIndex), model.intelligenceIndexIsEstimated ? 1 : 0, model.intelligenceIndexCostPerTask == null ? null : Number(model.intelligenceIndexCostPerTask), model.price1mInputTokens == null ? null : Number(model.price1mInputTokens), model.price1mOutputTokens == null ? null : Number(model.price1mOutputTokens), model.medianOutputTokensPerSecond == null ? null : Number(model.medianOutputTokensPerSecond), model.medianTimeToFirstTokenSeconds == null ? null : Number(model.medianTimeToFirstTokenSeconds), model.medianEndToEndResponseTimeSeconds == null ? null : Number(model.medianEndToEndResponseTimeSeconds), model.isReasoning ? 1 : 0, model.isOpenWeights ? 1 : 0, model.deprecated ? 1 : 0, syncedAt], connection)
  }
  await database.run('INSERT INTO model_ranking_syncs (source_url, model_count, synced_at) VALUES (?, ?, ?)', [LEADERBOARD_URL, models.length, syncedAt], connection)
})
await database.pool.end()
console.log(JSON.stringify({ count: models.length, syncedAt: syncedAtIso, source: LEADERBOARD_URL }, null, 2))
