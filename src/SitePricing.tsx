import { useCallback, useEffect, useState } from 'react'

type Quote = { id: string | number; modelId: string; groupName: string; inputPrice: string | number | null; outputPrice: string | number | null; currency: string; billingUnit: string }
type Pricing = { settings: { enabled: boolean; platform: 'new-api' | 'sub2api' }; sync: { syncedAt?: string | null; error?: string | null; unsupportedCount?: number } | null; quotes: Quote[] }

export default function SitePricing({ siteId }: { siteId: number }) {
  const [data, setData] = useState<Pricing | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [platform, setPlatform] = useState<'new-api' | 'sub2api'>('new-api')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const endpoint = `/api/user/sites/${siteId}/pricing`
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '分组与报价加载失败')
    const pricing = result as Pricing
    setData(pricing); setEnabled(Boolean(pricing.settings.enabled)); setPlatform(pricing.settings.platform)
  }, [endpoint])
  // oxlint-disable-next-line react/set-state-in-effect -- load saved pricing settings when the site changes
  useEffect(() => { let active = true; void load().catch(error => { if (active) setError(error instanceof Error ? error.message : '加载失败') }); return () => { active = false } }, [load])
  const action = async (sync: boolean) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(sync ? `${endpoint}/sync` : endpoint, { method: sync ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sync ? {} : { enabled, platform }) })
      const result = await response.json()
      if (!response.ok) {
        if (sync) await load().catch(() => undefined)
        throw new Error(result.error || '操作失败')
      }
      await load(); setMessage(sync ? '公开接口报价同步成功。' : '报价展示设置已保存。')
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  const dirty = data && (Boolean(data.settings.enabled) !== enabled || data.settings.platform !== platform)
  return <section className="site-pricing" aria-label="分组与报价"><h4>分组与报价</h4><p>读取本站公开价格接口，无需 KEY，不执行模型检测。接口价格为参考标价，不代表实际扣费。</p>{error && <p className="form-error" role="alert">{error}</p>}{!data ? <button className="button button-ghost button-small" onClick={() => { setError(''); void load().catch(() => setError('加载失败，请重试')) }}>重新加载</button> : <><label className="site-pricing-platform">站点系统<select value={platform} disabled={busy} onChange={event => setPlatform(event.target.value as typeof platform)}><option value="new-api">New API</option><option value="sub2api">Sub2API</option></select></label><label className="checkbox"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} /><span>同意将公开接口报价展示在模型比价中（站点还须在服务目录公开且启用）。</span></label><div className="site-pricing-actions"><button className="button button-small" disabled={busy || !dirty} onClick={() => void action(false)}>保存报价设置</button><button className="button button-ghost button-small" disabled={busy || Boolean(dirty)} onClick={() => void action(true)}>{busy ? '处理中…' : '同步公开分组与报价'}</button></div>{dirty && <small>请先保存系统类型与展示设置，再执行同步。</small>}<p>最近成功同步：{data.sync?.syncedAt ? new Date(data.sync.syncedAt).toLocaleString('zh-CN') : '尚未同步'}{data.sync?.unsupportedCount ? ` · ${data.sync.unsupportedCount} 项特殊计费无法计算` : ''}</p>{data.sync?.error && <p className="notice">最近同步失败：{data.sync.error}。保留最近成功报价，请核对时效。</p>}{data.quotes.length > 0 && <details><summary>查看已同步报价（{data.quotes.length} 条）</summary><div className="admin-table-wrap"><table><thead><tr><th>模型 / 分组</th><th>输入</th><th>输出</th><th>币种 / 单位</th></tr></thead><tbody>{data.quotes.map((quote, index) => <tr key={quote.id ?? index}><td>{quote.modelId}<small>{quote.groupName}</small></td><td>{quote.inputPrice ?? '—'}</td><td>{quote.outputPrice ?? '—'}</td><td>{quote.currency} / {quote.billingUnit}</td></tr>)}</tbody></table></div></details>}</>}{message && <p role="status">{message}</p>}</section>
}
