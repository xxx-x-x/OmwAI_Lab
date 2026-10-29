import type { Database } from './mysql.ts'
import type { PriceRow } from './pricing.ts'
import { PRICE_INSERT } from './price-store.ts'

export function validatePriceImport(data: unknown): PriceRow[] {
  if (!Array.isArray(data) || !data.length) throw new Error('Expected a nonempty price array')
  const identities = new Set<string>()
  for (const row of data) {
    if (!row || typeof row !== 'object') throw new Error('Invalid price row')
    for (const key of ['providerId', 'modelId', 'name', 'providerName', 'sourceName', 'sourceUrl', 'priceCheckedAt']) {
      if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error(`Missing ${key}`)
    }
    if (!['http:', 'https:'].includes(new URL(row.sourceUrl).protocol) || !Number.isFinite(Date.parse(row.priceCheckedAt))) throw new Error('Invalid price provenance')
    for (const key of ['inputPrice', 'outputPrice', 'cacheReadPrice']) {
      if (row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0)) throw new Error(`Invalid ${key}`)
    }
    if (![0, 1].includes(row.reasoning) || ![0, 1].includes(row.openWeights)) throw new Error('Invalid model flags')
    const identity = `${row.providerId}:${row.modelId}`
    if (identities.has(identity)) throw new Error('Duplicate price identity')
    identities.add(identity)
  }
  return data as PriceRow[]
}

export async function importPrices(database: Database, data: unknown, importedAt = new Date()) {
  const rows = validatePriceImport(data)
  await database.transaction(async connection => {
    for (const row of rows) {
      await database.run(`${PRICE_INSERT} ON DUPLICATE KEY UPDATE model_id = model_id`, ['curated', row.providerId, row.modelId, row.modelId, row.name, row.providerName, row.providerIconUrl ?? '', row.releaseDate ?? null, row.capabilityMetadata ?? null, row.inputPrice, row.outputPrice, row.cacheReadPrice, row.reasoning, row.openWeights, row.sourceUrl, row.modality ?? 'text', row.billingUnit ?? '百万 Tokens', row.pricingDetails ?? '', row.sourceName!, row.priceCheckedAt!, importedAt], connection)
    }
  })
  return rows.length
}
