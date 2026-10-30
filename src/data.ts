export type Provider = {
  id: string
  name: string
  initials: string
  tagline: string
  description: string
  models: string[]
  price: string
  rate: string
  status: '运行正常' | '维护中' | '待探测' | '监控异常'
  verified: boolean
  featured?: boolean
  website: string
  logoUrl?: string
  updatedAt: string
  color: string
  responseTime: number | null
  availability: string
  monitoring?: { history?: { time: string; status: 'up' | 'down' | 'unknown'; samples: number; uptime: number | null; complete: boolean }[]; status: 'up' | 'down' | 'unknown'; uptime: number | null; latency: number | null; samples: number; monitors: number; checkedAt: string | null; hours: number }
  invoice: boolean | null
  billingDetails?: string
  billing: string
  highlights: string[]
}

export const modelFilters = ['全部', 'OpenAI', 'Claude', 'Gemini', 'Grok', 'DeepSeek']
