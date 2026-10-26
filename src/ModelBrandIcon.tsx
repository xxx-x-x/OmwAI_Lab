import { Ai2, Ai21, Alibaba, Anthropic, Aws, Baidu, ByteDance, Claude, Cohere, CommandA, DeepSeek, Gemini, Google, Grok, IBM, Kimi, LG, Liquid, LongCat, Meta, Microsoft, Minimax, Mistral, Moonshot, NousResearch, Nova, Nvidia, OpenAI, Perplexity, Qwen, Reka, Stepfun, Tencent, TII, Upstage, XAI, XiaomiMiMo, Yi, Zhipu } from '@lobehub/icons'
import type { ComponentType } from 'react'

type BrandIcon = ComponentType<{ size: number }>

const brandIcons: Record<string, BrandIcon> = {
  Ai21,
  Alibaba: Alibaba.Color,
  'Alibaba Cloud': Alibaba.Color,
  'Allen Institute for AI': Ai2,
  Amazon: Aws.Color,
  Anthropic: Anthropic.Avatar,
  Baidu,
  'ByteDance Seed': ByteDance,
  Cohere: Cohere.Color,
  DeepSeek: DeepSeek.Color,
  Gemini: Gemini.Color,
  Google: Google.Color,
  IBM,
  Kimi: Kimi.Color,
  'LG AI Research': LG,
  'Liquid AI': Liquid,
  LongCat,
  Meta: Meta.Color,
  Microsoft,
  MiniMax: Minimax.Color,
  'Mistral AI': Mistral.Color,
  Mistral: Mistral.Color,
  Moonshot: Moonshot.Avatar,
  'Moonshot AI': Moonshot.Avatar,
  'Nous Research': NousResearch,
  NVIDIA: Nvidia.Color,
  OpenAI: OpenAI.Avatar,
  Perplexity: Perplexity.Color,
  Qwen: Qwen.Color,
  'Reka AI': Reka,
  SpaceXAI: XAI.Avatar,
  StepFun: Stepfun.Avatar,
  Tencent,
  'TII UAE': TII,
  Upstage,
  xAI: XAI.Avatar,
  Xiaomi: XiaomiMiMo,
  'Z AI': Zhipu.Color,
  'Zhipu AI': Zhipu.Color,
}

const modelIcons: Array<[RegExp, BrandIcon]> = [
  [/\bclaude\b/i, Claude.Color],
  [/\bgemini\b/i, Gemini.Color],
  [/\bgrok\b/i, Grok.Avatar],
  [/\bdeepseek\b/i, DeepSeek.Color],
  [/\bqwen\b|qwq/i, Qwen.Color],
  [/\bkimi\b/i, Kimi.Color],
  [/\bminimax\b/i, Minimax.Color],
  [/\bmistral\b|mixtral/i, Mistral.Color],
  [/\bcommand(?:\s|[-_])?[ar]\b/i, CommandA],
  [/\bnova\b/i, Nova],
  [/\bchatglm\b|\bglm[-\s]?/i, Zhipu],
  [/\bstep(?:fun)?[-\s]?/i, Stepfun],
  [/\byi[-\s]?/i, Yi],
]

export function ModelBrandIcon({ brand, model, size = 24 }: { brand: string; model?: string; size?: number }) {
  if (model && /\bkimi\b/i.test(model)) return <Kimi.Avatar size={size} shape="square" />
  const Icon = model ? modelIcons.find(([pattern]) => pattern.test(model))?.[1] ?? brandIcons[brand] : brandIcons[brand]
  const color = model && /\bgrok\b/i.test(model) ? '#000' : undefined
  return Icon ? <span style={color ? { color } : undefined}><Icon size={size} /></span> : <span aria-hidden="true">{brand.slice(0, 1)}</span>
}
