import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergePrices, modelCapabilities, priceInUsd, VOLCENGINE_CNY_PER_USD, type PriceRow } from './pricing.ts'

function price(overrides: Partial<PriceRow>): PriceRow {
  return { providerId: 'openai', modelId: 'gpt-4o', name: 'GPT-4o', providerName: 'OpenAI', providerIconUrl: '', inputPrice: 2.5, outputPrice: 10, cacheReadPrice: null, reasoning: 0, openWeights: 0, sourceUrl: 'https://basellm.github.io', ...overrides }
}

test('returns the selected model release date, not its dated variant or price check date', () => {
  const [model] = mergePrices([
    price({ modelId: 'gpt-4o-2024-08-06', name: 'GPT-4o (2024-08-06)', releaseDate: '2024-08-06' }),
    price({ releaseDate: '2024-05-13', priceCheckedAt: '2026-10-27' }),
  ])
  assert.equal(model.releaseDate, '2024-05-13')
})

test('leaves missing release dates unknown rather than inferring them from IDs or quote dates', () => {
  for (const releaseDate of [undefined, null, '']) {
    const [model] = mergePrices([price({ modelId: 'model-2025-01-01', releaseDate, priceCheckedAt: '2026-10-27' })])
    assert.equal(model.releaseDate, null)
  }
})

test('converts only Volcengine CNY prices at the agreed fixed rate', () => {
  assert.equal(VOLCENGINE_CNY_PER_USD, 6.67)
  assert.equal(priceInUsd(0.6, 'volcengine'), 0.6 / 6.67)
  assert.equal(priceInUsd(3.6, 'volcengine'), 3.6 / 6.67)
  assert.equal(priceInUsd(0.12, 'volcengine'), 0.12 / 6.67)
  assert.equal(priceInUsd(0, 'volcengine'), 0)
  assert.equal(priceInUsd(undefined, 'volcengine'), null)
  assert.equal(priceInUsd(3.6, 'openai'), 3.6)
})

test('keeps Volcengine separate and identifies the converted quote without converting twice', () => {
  const [model] = mergePrices([price({ providerId: 'volcengine', providerName: '火山引擎', inputPrice: priceInUsd(0.6, 'volcengine') })])
  assert.equal(model.family, '火山引擎')
  assert.equal(model.inputPrice, 0.6 / 6.67)
  assert.match(model.priceSource, /1 USD = 6\.67 CNY/)
})

test('preserves raw model IDs including provider-specific separators and version suffixes', () => {
  const modelId = 'doubao-seed-2-0-lite-260428'
  const [model] = mergePrices([price({ providerId: 'volcengine', modelId, name: 'Seed 2.0 Lite' })])
  assert.equal(model.modelId, modelId)
  assert.equal(model.id, `volcengine:${modelId}`)
  assert.notEqual(model.modelId, model.name)
})

test('uses official Doubao model names rather than invented display titles', () => {
  const models = mergePrices([
    price({ providerId: 'volcengine', modelId: 'doubao-seed-2-0-lite-260428', name: 'Seed 2.0 Lite' }),
    price({ providerId: 'volcengine', modelId: 'doubao-seed-evolving', name: 'Seed Evolving' }),
    price({ providerId: 'volcengine', modelId: 'doubao-seed-character-260628', name: 'Seed Character' }),
  ])
  assert.deepEqual(models.map(model => model.name).sort(), ['doubao-seed-2.0-lite', 'doubao-seed-character', 'doubao-seed-evolving'])
})

test('merges dated variants and prefers the priced default model', () => {
  const models = mergePrices([
    price({ modelId: 'gpt-4o-2024-08-06', name: 'GPT-4o (2024-08-06)', inputPrice: 3 }),
    price({ modelId: 'gpt-4o', name: 'GPT-4o', inputPrice: 2.5 }),
    price({ modelId: 'gpt-4o-2024-11-20', name: 'GPT-4o (2024-11-20)', inputPrice: 4 }),
  ])
  assert.equal(models.length, 1)
  assert.equal(models[0].id, 'openai:gpt-4o')
  assert.equal(models[0].modelId, 'gpt-4o')
  assert.equal(models[0].inputPrice, 2.5)
})

test('returns cache read prices independently of input prices, preserving zero and missing values', () => {
  for (const cacheReadPrice of [0.25, 0, null]) {
    const [model] = mergePrices([price({ inputPrice: 10, cacheReadPrice })])
    assert.equal(model.cacheReadPrice, cacheReadPrice)
    assert.equal(model.inputPrice, 10)
    assert.equal('cachedInputPrice' in model, false)
  }
})

test('keeps providers and distinct model variants separate', () => {
  const models = mergePrices([
    price({}),
    price({ providerId: 'another', providerName: 'Another', inputPrice: 4 }),
    price({ modelId: 'gpt-4o-mini', name: 'GPT-4o mini' }),
  ])
  assert.equal(models.length, 3)
})

test('excludes requested providers without filtering other providers or model names', () => {
  const excluded = ['arcee', 'cohere', 'inception', 'mistral', 'morph', 'nova', 'poolside', 'sakana', 'sarvam', 'stepfun-ai', 'thinkingmachines', 'upstage']
  const models = mergePrices([
    ...excluded.map(providerId => price({ providerId, providerName: providerId, modelId: 'model' })),
    price({ providerId: 'openai', modelId: 'cohere-like', name: 'Cohere-compatible model' }),
    price({ providerId: 'deepseek', modelId: 'flash', name: 'DeepSeek Flash' }),
  ])
  assert.equal(models.length, 2)
  assert.deepEqual(models.map(model => model.id).sort(), ['deepseek:flash', 'openai:cohere-like'])
})

test('retains models without a quoted price and prefers priced variants', () => {
  const models = mergePrices([
    price({ modelId: 'gpt-4o-latest', name: 'GPT-4o (latest)', inputPrice: null, outputPrice: null }),
    price({ modelId: 'gpt-4o', name: 'GPT-4o', inputPrice: 2.5 }),
    price({ modelId: 'unpriced', name: 'Unpriced', inputPrice: null, outputPrice: null }),
  ])
  assert.equal(models.find(model => model.name === 'GPT-4o')?.inputPrice, 2.5)
  assert.equal(models.find(model => model.name === 'Unpriced')?.priceSource, 'BaseLLM 暂无报价')
})


test('classifies capabilities using metadata instead of model names or open weights', () => {
  const row = price({ reasoning: 1, openWeights: 1, capabilityMetadata: JSON.stringify({ type: 'text', modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text', 'audio'] }, limit: { context: 200000 } }) })
  const [model] = mergePrices([row])
  assert.deepEqual(model.capabilities.map(item => item.label), ['对话', '深度思考', '识图', '语音', '视频理解', '长文本'])
  assert.equal(model.capabilities.at(-1)?.description, '上下文窗口：200,000 Tokens')
})

test('uses the 200K context boundary without guessing missing capabilities', () => {
  for (const context of [128000, 199999, 200000, 1048576]) {
    const labels = modelCapabilities(price({ capabilityMetadata: JSON.stringify({ limit: { context } }) })).map(item => item.label)
    assert.equal(labels.includes('长文本'), context >= 200000)
  }
  for (const capabilityMetadata of [undefined, null, '', '{invalid', 'null']) {
    assert.deepEqual(modelCapabilities(price({ capabilityMetadata, openWeights: 1 })).map(item => item.label), ['对话'])
  }
})

test('keeps media generation distinct from image and video understanding', () => {
  for (const modality of ['image', 'video'] as const) {
    assert.deepEqual(modelCapabilities(price({ modality })).map(item => item.label), [modality === 'image' ? '图片生成' : '视频生成'])
    assert.deepEqual(modelCapabilities(price({ capabilityMetadata: JSON.stringify({ type: modality, modalities: { input: ['text', 'image', 'video'], output: ['text', modality] } }) })).map(item => item.label), [modality === 'image' ? '图片生成' : '视频生成'])
  }
  assert.deepEqual(modelCapabilities(price({ capabilityMetadata: JSON.stringify({ type: 'embedding', modalities: { input: ['text'], output: [] } }) })), [])
  assert.deepEqual(modelCapabilities(price({ capabilityMetadata: JSON.stringify({ type: 'audio', modalities: { input: ['text'], output: ['audio'] } }) })).map(item => item.label), ['语音'])
})
