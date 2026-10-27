import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergePrices } from './pricing.ts'
import { volcengineMediaPrices } from './volcengine-media-prices.ts'

test('includes all officially listed Seedream and Seedance online rates with explicit units', () => {
  const models = mergePrices(volcengineMediaPrices)
  assert.equal(models.length, 11)
  assert.equal(models.filter(model => model.modality === 'image').length, 5)
  assert.equal(models.filter(model => model.modality === 'video').length, 6)
  for (const model of models) {
    assert.equal(model.company, '火山引擎')
    assert.equal(model.name, model.id.slice('volcengine:'.length))
    assert.match(model.priceSource, /火山引擎官方.*6\.67/)
    assert.match(model.sourceUrl, /model-pricing/)
    assert.ok(model.pricingDetails)
    assert.equal(model.cacheReadPrice, null)
    assert.equal(model.billingUnit, model.modality === 'image' ? '张图片' : '百万视频 Tokens')
  }
})

test('preserves image free inputs and video conditional rates without inventing per-second prices', () => {
  const models = mergePrices(volcengineMediaPrices)
  const flash = models.find(model => model.name === 'doubao-seedream-5-0-flash')!
  assert.equal(flash.inputPrice, 0)
  assert.equal(flash.outputPrice, 0.12 / 6.67)
  const pro = models.find(model => model.name === 'doubao-seedream-5-0-pro')!
  assert.match(pro.pricingDetails, /首张免费.*第 2 张/)
  assert.match(pro.pricingDetails, /图层拆分/)
  const video = models.find(model => model.name === 'doubao-seedance-2.0')!
  assert.equal(video.inputPrice, null)
  assert.equal(video.outputPrice, 46 / 6.67)
  assert.match(video.pricingDetails, /1080p.*4K/)
  assert.match(video.pricingDetails, /含视频/)
})
