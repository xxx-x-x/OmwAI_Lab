import type { PriceRow } from './pricing.ts'

export const openaiPrices: PriceRow[] = [{
  providerId: 'openai', modelId: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', providerName: 'OpenAI',
  providerIconUrl: 'https://models.dev/logos/openai.svg', releaseDate: '2026-10-27',
  capabilityMetadata: JSON.stringify({ type: 'text', modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 1_050_000 } }),
  inputPrice: 1, outputPrice: 5, cacheReadPrice: 0.05, reasoning: 1, openWeights: 0,
  sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6.1-terra',
  sourceName: 'OpenAI 官方', priceCheckedAt: '2026-10-27',
  pricingDetails: '标准价，单位为美元/百万 Tokens。缓存写入：30 分钟保留 $1.25，12 小时保留 $2.50。输入超过 272K Tokens 时，整次请求输入及缓存价格为标准价的 2 倍，输出为 1.5 倍。Batch/Flex 为标准价的 50%；Fast 为 2 倍；可用地区的区域处理加价 10%。',
}]

export function withOpenaiPrices(rows: PriceRow[]): PriceRow[] {
  return [...rows.filter(row => !openaiPrices.some(official => row.providerId === official.providerId && row.modelId === official.modelId)), ...openaiPrices]
}
