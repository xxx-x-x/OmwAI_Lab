import { Ai2, Ai21, Alibaba, Anthropic, Aws, Baidu, ByteDance, Claude, Cohere, CommandA, DeepSeek, Gemini, Google, Grok, IBM, Kimi, LG, Liquid, LongCat, Meta, Microsoft, Minimax, Mistral, Moonshot, NousResearch, Nova, Nvidia, OpenAI, Perplexity, Qwen, Reka, Stepfun, Tencent, TII, Upstage, XAI, XiaomiMiMo, Yi, Zhipu } from '@lobehub/icons'
import type { ComponentType } from 'react'

const brandIcons: Record<string, ComponentType<{ size?: number }>> = {
  Ai21,
  Alibaba,
  'Alibaba Cloud': Alibaba,
  'Allen Institute for AI': Ai2,
  Amazon: Aws,
  Anthropic,
  Baidu,
  'ByteDance Seed': ByteDance,
  Cohere,
  DeepSeek,
  Gemini: Google,
  Google,
  IBM,
  Kimi,
  'LG AI Research': LG,
  'Liquid AI': Liquid,
  LongCat,
  Meta,
  Microsoft,
  MiniMax: Minimax,
  'Mistral AI': Mistral,
  Mistral,
  Moonshot,
  'Moonshot AI': Moonshot,
  'Nous Research': NousResearch,
  NVIDIA: Nvidia,
  OpenAI,
  Perplexity,
  Qwen: Qwen.Color,
  'Reka AI': Reka,
  SpaceXAI: XAI,
  StepFun: Stepfun,
  Tencent,
  'TII UAE': TII,
  Upstage,
  xAI: XAI,
  Xiaomi: XiaomiMiMo,
  'Z AI': Zhipu,
  'Zhipu AI': Zhipu,
}

const modelIcons: Array<[RegExp, ComponentType<{ size?: number }>]> = [
  [/\bclaude\b/i, Claude],
  [/\bgemini\b/i, Gemini.Color],
  [/\bgrok\b/i, Grok],
  [/\bdeepseek\b/i, DeepSeek],
  [/\bqwen\b|qwq/i, Qwen.Color],
  [/\bkimi\b/i, Kimi],
  [/\bminimax\b/i, Minimax],
  [/\bmistral\b|mixtral/i, Mistral],
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
