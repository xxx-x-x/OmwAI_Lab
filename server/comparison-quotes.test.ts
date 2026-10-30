import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lowestPerSite, compareMultipliers, multiplier } from '../src/comparisonQuotes.ts'
import { parseNewApiPricing, parseSub2ApiPricing } from './public-pricing.ts'

function assertPerModelGroups(quotes: { modelId: string; groupName: string; groupMultiplier: number }[]) {
  const selected = lowestPerSite(quotes.map((quote, id) => ({ ...quote, id, siteId: 1 })))
  assert.deepEqual(selected.map(q => [q.modelId, q.groupName, q.groupMultiplier]), [['model1', 'A', 1], ['model2', 'B', 0.5], ['model3', 'A', 1]])
  for (const modelId of ['model1', 'model2', 'model3']) {
    assert.deepEqual(lowestPerSite(quotes.filter(q => q.modelId === modelId).map((quote, id) => ({ ...quote, id, siteId: 1 }))).map(q => q.groupName), [modelId === 'model2' ? 'B' : 'A'])
  }
}

test('new-api selects the cheapest supported group per model, not the cheapest group of the entire site', () => {
  const { quotes } = parseNewApiPricing({ success: true, group_ratio: { A: 1, B: 0.5 }, data: ['model1', 'model2', 'model3'].map(model_name => ({ model_name, quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: model_name === 'model2' ? ['A', 'B'] : ['A'] })) })
  assertPerModelGroups(quotes)
})

test('sub2api keeps models supported only by a more expensive group', () => {
  const model = (name: string) => ({ name, pricing: { billing_mode: 'token', input_price: 0.000002, output_price: 0.000004 } })
  const { quotes } = parseSub2ApiPricing({ code: 0, data: { groups: [{ name: 'A', rate_multiplier: 1, models: ['model1', 'model2', 'model3'].map(model) }, { name: 'B', rate_multiplier: 0.5, models: [model('model2')] }] } })
  assertPerModelGroups(quotes)
})

test('one lowest known multiplier per site, including zero and tied groups', () => {
  const quotes = [{ id: 1, siteId: 1 }, { id: 2, siteId: 1, groupMultiplier: '0.5' }, { id: 3, siteId: 1, groupMultiplier: 0 }, { id: 4, siteId: 2 }, { id: 5, siteId: 2 }, { id: 6, siteId: 3, groupMultiplier: 1 }, { id: 7, siteId: 3, groupMultiplier: 1 }]
  assert.deepEqual(lowestPerSite(quotes).map(q => q.id), [3, 4, 6])
  assert.equal(quotes.length, 7)
})

test('multiplier sorting keeps missing and invalid values last in either direction', () => {
  const quotes = [{ id: 1 }, { id: 2, groupMultiplier: '0.25' }, { id: 3, groupMultiplier: 2 }, { id: 4, groupMultiplier: 0 }]
  assert.deepEqual([...quotes].sort(compareMultipliers).map(q => q.id), [4, 2, 3, 1])
  assert.deepEqual([...quotes].sort((a, b) => compareMultipliers(a, b, true)).map(q => q.id), [3, 2, 4, 1])
  for (const value of [null, '', -1, 'invalid', Infinity]) assert.equal(multiplier({ id: 1, groupMultiplier: value }), null)
})
