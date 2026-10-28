import { useCallback, useEffect, useState } from 'react'
import type { Provider } from './data'

type DirectorySite = { billingType: string | null; billingDetails: string | null; invoice: boolean | null; id: string; name: string; logoUrl?: string | null; website: string; models: string; pricing: string; description: string | null; foundedAt: string | null; updatedAt: string }

export function useDirectoryProviders() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/directory', { cache: 'no-store' })
      if (!response.ok) throw new Error('收录站点加载失败，请稍后重试。')
      const result = await response.json() as { sites: DirectorySite[] }
      const managed: Provider[] = result.sites.map(site => ({
        id: site.id, name: site.name, initials: Array.from(site.name)[0]?.toUpperCase() || '?', logoUrl: site.logoUrl ?? undefined,
        tagline: '用户提交 · 已审核收录', description: site.description || '服务介绍尚未提供',
        website: site.website, models: [...new Set(site.models.split(/[,，、;；\n]+/).map(value => value.trim()).filter(Boolean))],
        price: site.pricing, billing: site.billingType || '未填写', billingDetails: site.billingDetails || undefined, rate: '未提供', status: '待探测',
        verified: true, updatedAt: String(site.updatedAt).slice(0, 10), color: '#7068f4',
        responseTime: null, availability: '暂无数据', invoice: site.invoice ?? null,
        highlights: site.foundedAt ? [`成立于 ${String(site.foundedAt).slice(0, 10)}`] : [],
      }))
      setProviders(managed)
    } catch (error) {
      setProviders([])
      setError(error instanceof Error ? error.message : '站点加载失败，请重试')
    } finally { setLoading(false) }
  }, [])
  // oxlint-disable-next-line react/set-state-in-effect -- synchronize site data with the API on mount
  useEffect(() => { void reload() }, [reload])
  return { providers, loading, error, reload }
}
