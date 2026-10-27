const CREATOR_PROVIDER_ALIASES: Record<string, string[]> = {
  Alibaba: ['alibaba'], Anthropic: ['anthropic'], Cohere: ['cohere'], DeepSeek: ['deepseek'], Google: ['google'], Inception: ['inception'], Kimi: ['moonshotai'], LongCat: ['longcat'], Meta: ['meta'], MiniMax: ['minimax'], Mistral: ['mistral'], OpenAI: ['openai'], Perplexity: ['perplexity'], Sarvam: ['sarvam'], SpaceXAI: ['xai'], StepFun: ['stepfun-ai'], 'Thinking Machines': ['thinkingmachines'], Upstage: ['upstage'], Xiaomi: ['xiaomi'], 'Z AI': ['zai'], 'Zhipu AI': ['zai'],
}

export function providerIdsForCreator(creator: string) {
  return CREATOR_PROVIDER_ALIASES[creator] ?? [creator.toLowerCase().replaceAll(/[^a-z0-9]/g, '')]
}

export function modelKey(value: string) {
  return value.toLowerCase()
    .replaceAll(/\([^)]*(reasoning|non-reasoning|thinking|default fallback|high|xhigh|max|medium|low)[^)]*\)/g, '')
    .replaceAll(/\b(non[- ]?reasoning|reasoning|thinking|instruct|preview|latest)\b/g, '')
    .replaceAll(/\b\d{4}[-/]?\d{2}[-/]?\d{2}\b/g, '')
    .replaceAll(/\b\d{8}\b/g, '')
    .replaceAll(/[^a-z0-9]/g, '')
}

export function modelKeys(value: string) {
  const primary = modelKey(value)
  const withoutSize = primary.replace(/\d+(?:\.\d+)?b(?:a\d+b)?$/, '')
  return [...new Set([primary, withoutSize].filter(key => key.length >= 3))]
}
