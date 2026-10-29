import type { Database, DatabaseRow } from './mysql.ts'
import type { PriceRow } from './pricing.ts'

// Overrides are independent of replace-all syncs. Presence (not COALESCE) preserves explicit unknown/null values.
export const EFFECTIVE_PRICE_ROWS = `SELECT p.source_id, p.provider_id, p.model_id, p.name, p.provider_name, p.provider_icon_url, p.capability_metadata, p.reasoning, p.open_weights, p.modality, p.billing_unit, p.pricing_details, p.synced_at,
  IF(o.model_id IS NULL, p.input_price, o.input_price) AS input_price,
  IF(o.model_id IS NULL, p.output_price, o.output_price) AS output_price,
  IF(o.model_id IS NULL, p.cached_input_price, o.cached_input_price) AS cached_input_price,
  IF(o.model_id IS NULL, p.release_date, o.release_date) AS release_date,
  IF(o.model_id IS NULL, p.source_url, o.source_url) AS source_url,
  IF(o.model_id IS NULL, p.source_name, o.source_name) AS source_name,
  IF(o.model_id IS NULL, p.price_checked_at, DATE_FORMAT(o.updated_at, '%Y-%m-%d')) AS price_checked_at,
  o.model_id IS NOT NULL AS has_override, o.updated_by, o.updated_at,
  p.input_price AS synced_input_price, p.output_price AS synced_output_price, p.cached_input_price AS synced_cached_input_price, p.release_date AS synced_release_date, p.source_url AS synced_source_url, p.source_name AS synced_source_name
  FROM model_prices p LEFT JOIN model_price_overrides o ON BINARY p.source_id = BINARY o.source_id AND BINARY p.provider_id = BINARY o.provider_id AND BINARY p.model_id = BINARY o.model_id`

export const PRICE_SELECT = `SELECT source_id AS sourceId, provider_id AS providerId, model_id AS modelId, name, provider_name AS providerName, provider_icon_url AS providerIconUrl, release_date AS releaseDate, capability_metadata AS capabilityMetadata, reasoning, open_weights AS openWeights, input_price AS inputPrice, output_price AS outputPrice, cached_input_price AS cacheReadPrice, source_url AS sourceUrl, modality, billing_unit AS billingUnit, pricing_details AS pricingDetails, source_name AS sourceName, price_checked_at AS priceCheckedAt FROM (${EFFECTIVE_PRICE_ROWS}) model_prices WHERE source_id IN ('official', 'curated', 'manual')`

export async function loadPrices(database: Database) {
  return database.all<DatabaseRow & PriceRow>(PRICE_SELECT)
}

export const PRICE_INSERT = `INSERT INTO model_prices (source_id, provider_id, model_id, model_key, name, provider_name, provider_icon_url, release_date, capability_metadata, input_price, output_price, cached_input_price, reasoning, open_weights, source_url, modality, billing_unit, pricing_details, source_name, price_checked_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
