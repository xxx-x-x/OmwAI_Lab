import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import SitePricing from './SitePricing'
import type { ManagedSite } from './siteRevisionTypes'

export default function SitePricingPage() {
  const { siteId } = useParams()
  const [site, setSite] = useState<ManagedSite | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/user/sites', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '站点加载失败')
      const owned = (result.sites as ManagedSite[]).find(item => String(item.id) === siteId && item.status === 'approved')
      if (!owned) throw new Error('未找到已审核的自有站点')
      setSite(owned)
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '站点加载失败') })
    return () => controller.abort()
  }, [siteId])
  return <div className="site-pricing-page"><Link className="back-link" to="/site-management/sites"><ArrowLeft size={16} />返回我的站点</Link><div className="admin-heading"><div><h2>{site ? `${site.name} · 分组管理` : '分组管理'}</h2><p>{site?.website || '仅站点所有者可管理同步数据与报价展示设置。'}</p></div></div>{error ? <p className="form-error" role="alert">{error}</p> : site ? <SitePricing key={site.id} siteId={site.id} /> : <p role="status">正在加载站点…</p>}</div>
}
