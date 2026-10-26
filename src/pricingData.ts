export type ModelPrice = {
  id: string
  name: string
  company: string
  family: 'OpenAI' | 'Anthropic' | 'Google' | 'xAI' | 'DeepSeek' | 'Moonshot' | 'Alibaba' | 'Zhipu AI'
  input: number
  output: number
  cachedInput?: number
  capabilities: string[]
  released: string
  source: string
  accent: string
}

export const modelPrices: ModelPrice[] = [
  { id: 'gpt-5', name: 'GPT-5', company: 'OpenAI', family: 'OpenAI', input: 1.25, output: 10, cachedInput: 0.125, capabilities: ['推理', '多模态'], released: '2025-08', source: 'https://openai.com/api/pricing/', accent: '#111827' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', company: 'OpenAI', family: 'OpenAI', input: 0.25, output: 2, cachedInput: 0.025, capabilities: ['推理', '多模态'], released: '2025-08', source: 'https://openai.com/api/pricing/', accent: '#111827' },
  { id: 'gpt-5-nano', name: 'GPT-5 nano', company: 'OpenAI', family: 'OpenAI', input: 0.05, output: 0.4, cachedInput: 0.005, capabilities: ['推理', '多模态'], released: '2025-08', source: 'https://openai.com/api/pricing/', accent: '#111827' },
  { id: 'gpt-4-1', name: 'GPT-4.1', company: 'OpenAI', family: 'OpenAI', input: 2, output: 8, cachedInput: 0.5, capabilities: ['对话', '多模态'], released: '2025-04', source: 'https://openai.com/api/pricing/', accent: '#111827' },
  { id: 'gpt-4-1-mini', name: 'GPT-4.1 mini', company: 'OpenAI', family: 'OpenAI', input: 0.4, output: 1.6, cachedInput: 0.1, capabilities: ['对话', '多模态'], released: '2025-04', source: 'https://openai.com/api/pricing/', accent: '#111827' },
  { id: 'o3', name: 'o3', company: 'OpenAI', family: 'OpenAI', input: 2, output: 8, cachedInput: 0.5, capabilities: ['推理', '多模态'], released: '2025-04', source: 'https://openai.com/api/pricing/', accent: '#111827' },
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', company: 'Anthropic', family: 'Anthropic', input: 15, output: 75, cachedInput: 1.5, capabilities: ['对话', '推理'], released: '2025-08', source: 'https://docs.anthropic.com/en/docs/about-claude/pricing', accent: '#d97757' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', company: 'Anthropic', family: 'Anthropic', input: 3, output: 15, cachedInput: 0.3, capabilities: ['对话', '推理'], released: '2025-05', source: 'https://docs.anthropic.com/en/docs/about-claude/pricing', accent: '#d97757' },
  { id: 'claude-haiku-3-5', name: 'Claude 3.5 Haiku', company: 'Anthropic', family: 'Anthropic', input: 0.8, output: 4, cachedInput: 0.08, capabilities: ['对话', '快速'], released: '2024-10', source: 'https://docs.anthropic.com/en/docs/about-claude/pricing', accent: '#d97757' },
  { id: 'gemini-2-5-pro', name: 'Gemini 2.5 Pro', company: 'Google', family: 'Google', input: 1.25, output: 10, cachedInput: 0.31, capabilities: ['推理', '多模态'], released: '2025-06', source: 'https://ai.google.dev/gemini-api/docs/pricing', accent: '#4285f4' },
  { id: 'gemini-2-5-flash', name: 'Gemini 2.5 Flash', company: 'Google', family: 'Google', input: 0.3, output: 2.5, cachedInput: 0.075, capabilities: ['推理', '多模态'], released: '2025-06', source: 'https://ai.google.dev/gemini-api/docs/pricing', accent: '#4285f4' },
  { id: 'gemini-2-5-flash-lite', name: 'Gemini 2.5 Flash-Lite', company: 'Google', family: 'Google', input: 0.1, output: 0.4, capabilities: ['快速', '多模态'], released: '2025-07', source: 'https://ai.google.dev/gemini-api/docs/pricing', accent: '#4285f4' },
  { id: 'grok-4', name: 'Grok 4', company: 'xAI', family: 'xAI', input: 3, output: 15, cachedInput: 0.75, capabilities: ['推理', '多模态'], released: '2025-07', source: 'https://docs.x.ai/docs/models', accent: '#111827' },
  { id: 'grok-3', name: 'Grok 3', company: 'xAI', family: 'xAI', input: 3, output: 15, cachedInput: 0.75, capabilities: ['对话', '推理'], released: '2025-02', source: 'https://docs.x.ai/docs/models', accent: '#111827' },
  { id: 'deepseek-chat', name: 'DeepSeek V3', company: 'DeepSeek', family: 'DeepSeek', input: 0.27, output: 1.1, cachedInput: 0.07, capabilities: ['对话', '编程'], released: '2024-12', source: 'https://api-docs.deepseek.com/quick_start/pricing', accent: '#4d6bfe' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', company: 'DeepSeek', family: 'DeepSeek', input: 0.55, output: 2.19, cachedInput: 0.14, capabilities: ['推理', '编程'], released: '2025-01', source: 'https://api-docs.deepseek.com/quick_start/pricing', accent: '#4d6bfe' },
  { id: 'kimi-k2', name: 'Kimi K2', company: 'Moonshot AI', family: 'Moonshot', input: 0.6, output: 2.5, cachedInput: 0.15, capabilities: ['对话', '编程'], released: '2025-07', source: 'https://platform.moonshot.ai/docs/pricing/chat', accent: '#171717' },
  { id: 'qwen-max', name: 'Qwen Max', company: 'Alibaba Cloud', family: 'Alibaba', input: 0.22, output: 0.88, capabilities: ['对话', '多模态'], released: '2025-01', source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing', accent: '#ff6a00' },
  { id: 'qwen-plus', name: 'Qwen Plus', company: 'Alibaba Cloud', family: 'Alibaba', input: 0.11, output: 0.28, capabilities: ['对话', '编程'], released: '2025-04', source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing', accent: '#ff6a00' },
  { id: 'glm-4-plus', name: 'GLM-4-Plus', company: 'Zhipu AI', family: 'Zhipu AI', input: 0.69, output: 0.69, capabilities: ['对话', '多模态'], released: '2024-08', source: 'https://open.bigmodel.cn/pricing', accent: '#315efb' },
]

export const priceFamilies = ['全部模型', 'OpenAI', 'Anthropic', 'Google', 'xAI', 'DeepSeek', 'Moonshot', 'Alibaba', 'Zhipu AI'] as const
