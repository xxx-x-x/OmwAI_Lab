export type Provider = {
  id: string
  name: string
  initials: string
  tagline: string
  description: string
  models: string[]
  price: string
  rate: string
  status: '运行正常' | '维护中' | '待探测'
  verified: boolean
  featured?: boolean
  website: string
  logoUrl?: string
  updatedAt: string
  color: string
  responseTime: number | null
  availability: string
  invoice: boolean | null
  billing: string
  highlights: string[]
}

export const modelFilters = ['全部', 'OpenAI', 'Claude', 'Gemini', 'Grok', 'DeepSeek']
