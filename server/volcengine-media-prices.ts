import { priceInUsd, type PriceRow } from './pricing.ts'

const sourceUrl = 'https://docs.volcengine.com/docs/ark/model-pricing?lang=zh'

function mediaPrice(id: string, modality: 'image' | 'video', input: number, output: number, pricingDetails: string): PriceRow {
  return {
    providerId: 'volcengine', modelId: id, name: id, providerName: '火山引擎',
    providerIconUrl: 'https://models.dev/logos/volcengine.svg',
    inputPrice: modality === 'image' ? priceInUsd(input, 'volcengine') : null,
    outputPrice: priceInUsd(output, 'volcengine'), cacheReadPrice: null,
    reasoning: 0, openWeights: 0, sourceUrl, modality,
    billingUnit: modality === 'image' ? '张图片' : '百万视频 Tokens',
    pricingDetails, sourceName: '火山引擎官方', priceCheckedAt: '2026-10-27',
  }
}

function usd(cny: number) {
  return `$${(priceInUsd(cny, 'volcengine') ?? 0).toFixed(4)}`
}

// Official online inference rates, verified on 2026-10-27; not the per-video cost examples.
export const volcengineMediaPrices: PriceRow[] = [
  mediaPrice('doubao-seedream-5-0-pro', 'image', 0.02, 0.3,
    `输入首张免费，第 2 张起 ${usd(0.02)}/张；单图生成 ≤261 万像素 ${usd(0.3)}/张，>261 万像素 ${usd(0.6)}/张；图层拆分 ≤261 万像素 ${usd(0.15)}/张，>261 万像素 ${usd(0.3)}/张。表中输出为单图生成 ≤261 万像素报价。`),
  mediaPrice('doubao-seedream-5-0-flash', 'image', 0, 0.12, '输入图片免费；按输出图片张数计费。'),
  mediaPrice('doubao-seedream-5-0-lite', 'image', 0, 0.22, '输入图片免费；按输出图片张数计费。'),
  mediaPrice('doubao-seedream-4-5', 'image', 0, 0.25, '输入图片免费；按输出图片张数计费。'),
  mediaPrice('doubao-seedream-4-0', 'image', 0, 0.2, '输入图片免费；按输出图片张数计费。'),
  mediaPrice('doubao-seedance-2.5', 'video', 0, 70,
    `480p/720p：输入不含视频 ${usd(70)}，含视频 ${usd(42)}；1080p：输入不含视频 ${usd(77)}，含视频 ${usd(46)}。单位均为美元/百万视频 Tokens；表中输出为 480p/720p、不含输入视频报价。`),
  mediaPrice('doubao-seedance-2.0', 'video', 0, 46,
    `480p/720p：输入不含视频 ${usd(46)}，含视频 ${usd(28)}；1080p：输入不含视频 ${usd(51)}，含视频 ${usd(31)}；4K：输入不含视频 ${usd(26)}，含视频 ${usd(16)}。单位均为美元/百万视频 Tokens；表中输出为 480p/720p、不含输入视频报价。`),
  mediaPrice('doubao-seedance-2.0-fast', 'video', 0, 37,
    `480p/720p：输入不含视频 ${usd(37)}，含视频 ${usd(22)}，单位为美元/百万视频 Tokens。表中输出为不含输入视频报价。`),
  mediaPrice('doubao-seedance-2.0-mini', 'video', 0, 23,
    `480p/720p：输入不含视频 ${usd(23)}，含视频 ${usd(14)}，单位为美元/百万视频 Tokens。表中输出为不含输入视频报价。`),
  mediaPrice('doubao-seedance-1.0-pro', 'video', 0, 15, '常规在线推理；按百万视频 Tokens 计费，不是按秒或按条视频计费。'),
  mediaPrice('doubao-seedance-1.0-pro-fast', 'video', 0, 4.2, '常规在线推理；按百万视频 Tokens 计费，不是按秒或按条视频计费。'),
]
