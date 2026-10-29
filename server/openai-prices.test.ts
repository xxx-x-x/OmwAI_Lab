import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { validatePriceImport } from './price-import.ts'
const openaiPrices = validatePriceImport(JSON.parse(readFileSync(new URL('../data/curated-model-prices.json', import.meta.url), 'utf8'))).filter(row => row.providerId === 'openai')
import { mergePrices } from './pricing.ts'

test('includes verified GPT-6.1 Terra standard pricing and capabilities without upstream data', () => {
  const [model] = mergePrices(openaiPrices)
  assert.equal(model.modelId, 'gpt-6.1-terra')
  assert.equal(model.name, 'GPT-6.1 Terra')
  assert.equal(model.family, 'OpenAI')
  assert.equal(model.releaseDate, '2026-10-27')
  assert.equal(model.inputPrice, 1)
  assert.equal(model.outputPrice, 5)
  assert.equal(model.cacheReadPrice, 0.05)
  assert.equal(model.billingUnit, '百万 Tokens')
  assert.deepEqual(model.capabilities.map(capability => capability.label), ['对话', '深度思考', '识图', '长文本'])
  assert.equal(model.priceSource, 'OpenAI 官方价格')
  assert.equal(model.sourceUrl, 'https://developers.openai.com/api/docs/models/gpt-6.1-terra')
  assert.match(model.pricingDetails, /272K/)
})

