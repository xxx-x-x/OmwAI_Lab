export type Provider = {
  id: string
  name: string
  initials: string
  tagline: string
  description: string
  models: string[]
  price: string
  rate: string
  status: '运行正常' | '维护中'
  verified: boolean
  featured?: boolean
  website: string
  logoUrl?: string
  updatedAt: string
  color: string
  responseTime: number
  availability: string
  invoice: boolean
  billing: string
  highlights: string[]
}

export const providers: Provider[] = [
  {
    id: 'omwai',
    name: 'OmwAI',
    initials: 'OM',
    tagline: '面向开发者的稳定 AI API 服务',
    description: '覆盖 OpenAI 与 Claude 主流模型，提供清晰的分组计费和调用记录。',
    models: ['OpenAI', 'Claude'],
    price: '官方价格 × 分组倍率',
    rate: '企业级 0.25 倍',
    status: '运行正常',
    verified: true,
    featured: true,
    website: 'https://www.omwai.xyz',
    logoUrl: 'https://www.omwai.xyz/favicon.ico',
    updatedAt: '2026-10-25',
    color: '#7068f4',
    responseTime: 486,
    availability: '99.96%',
    invoice: false,
    billing: '按量计费',
    highlights: ['账单透明', '企业级线路', '支持支付宝'],
  },
  {
    id: 'twinkle-model',
    name: 'Twinkle Model',
    initials: 'TM',
    tagline: '多模型聚合 API 服务平台',
    description: '支持 OpenAI、Claude、Grok 等模型，提供多个价格与稳定性分组。',
    models: ['OpenAI', 'Claude', 'Grok'],
    price: '官方价格 × 分组倍率',
    rate: '特价 0.1 倍起',
    status: '运行正常',
    verified: true,
    featured: true,
    website: 'https://big-model.smart-agi.com/',
    logoUrl: 'https://big-model.smart-agi.com/favicon.ico',
    updatedAt: '2026-10-24',
    color: '#18a97b',
    responseTime: 521,
    availability: '99.91%',
    invoice: true,
    billing: '按量计费',
    highlights: ['模型丰富', '可开发票', '低门槛充值'],
  },
  {
    id: 'northstar-api',
    name: 'NorthStar API',
    initials: 'NS',
    tagline: '轻量可靠的模型接入服务',
    description: '提供 Gemini 与 DeepSeek 模型接口，适合个人项目和原型验证。',
    models: ['Gemini', 'DeepSeek'],
    price: '按百万 Tokens 计费',
    rate: '0.2 倍起',
    status: '运行正常',
    verified: false,
    website: '#',
    updatedAt: '2026-10-21',
    color: '#f0a33b',
    responseTime: 638,
    availability: '99.72%',
    invoice: false,
    billing: '按量计费',
    highlights: ['个人开发者', '余额有效期长'],
  },
  {
    id: 'cloudbase-ai',
    name: 'CloudBase AI',
    initials: 'CB',
    tagline: '为团队提供统一模型网关',
    description: '主打团队额度管理、调用审计与多模型统一接入。',
    models: ['OpenAI', 'Claude', 'Gemini'],
    price: '套餐与按量计费',
    rate: '团队版 0.8 倍',
    status: '维护中',
    verified: true,
    website: '#',
    updatedAt: '2026-10-18',
    color: '#e9667e',
    responseTime: 712,
    availability: '98.84%',
    invoice: false,
    billing: '套餐 / 按量',
    highlights: ['团队管理', '调用审计', '额度控制'],
  },
]

export const modelFilters = ['全部', 'OpenAI', 'Claude', 'Gemini', 'Grok', 'DeepSeek']
