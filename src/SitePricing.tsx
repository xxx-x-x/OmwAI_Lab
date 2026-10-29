import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

type Quote = { id: string | number; modelId: string; groupName: string; inputPrice: string | number | null; outputPrice: string | number | null; cacheReadPrice: string | number | null; currency: string; billingUnit: string }
type Pricing = { settings: { enabled: boolean; platform: 'new-api' | 'sub2api' }; sync: { syncedAt?: string | null; error?: string | null; unsupportedCount?: number } | null; quotes: Quote[] }
type Groups = { groups: { name: string; ratio: number; type: string; description: string; modelCount: number }[]; detectedAt: string | null }

export default function SitePricing({ siteId }: { siteId: number }) {
  const [data, setData] = useState<Pricing | null>(null)
  const [groups, setGroups] = useState<Groups | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [platform, setPlatform] = useState<'new-api' | 'sub2api'>('new-api')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const endpoint = `/api/user/sites/${siteId}/pricing`
  const load = useCallback(async (signal?: AbortSignal) => {
    const read = async (url: string) => {
      const response = await fetch(url, { cache: 'no-store', signal })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '分组数据加载失败')
      return result
    }
    const [pricing, snapshot] = await Promise.all([read(endpoint), read(`/api/user/sites/${siteId}/groups`)]) as [Pricing, Groups]
    if (signal?.aborted) return
    setData(pricing); setGroups(snapshot)
    setEnabled(Boolean(pricing.settings.enabled)); setPlatform(pricing.settings.platform)
  }, [endpoint, siteId])
  // oxlint-disable-next-line react/set-state-in-effect -- restore the saved site snapshot on mount
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '加载失败') }); return () => controller.abort() }, [load])
  const dirty = Boolean(data && (data.settings.enabled !== enabled || data.settings.platform !== platform))
  const action = async (sync: boolean) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const url = sync ? enabled ? `${endpoint}/sync` : `/api/user/sites/${siteId}/groups/sync` : endpoint
      const response = await fetch(url, { method: sync ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sync ? {} : { enabled, platform }) })
      const result = await response.json()
      if (!response.ok) {
        if (sync) await load().catch(() => undefined)
        throw new Error(result.error || '操作失败')
      }
      await load()
      setMessage(sync ? enabled ? '分组及模型报价已同步并保存。' : '分组已同步并保存，原有报价未改动。' : '设置已保存。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  const names = [...new Set([...(groups?.groups.map(group => group.name) ?? []), ...(data?.quotes.map(quote => quote.groupName) ?? [])])]
  return <section className="site-pricing" aria-label="分组管理">
    <div className="group-management-toolbar"><div><h3>分组数据</h3><p>统一从站点公开接口采集并保存到数据库，无需 KEY，不执行模型调用。</p></div><button type="button" className="button" disabled={!data || busy || dirty} onClick={() => void action(true)}><RefreshCw size={15} className={busy ? 'spinning' : ''} />{busy ? '处理中…' : '同步分组'}</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!data ? <button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => { setError(''); void load().catch(() => setError('加载失败，请重试')) }}>重新加载</button> : <>
      <div className="group-management-settings"><label className="site-pricing-platform">站点系统<select value={platform} disabled={busy} onChange={event => setPlatform(event.target.value as typeof platform)}><option value="new-api">New API</option><option value="sub2api">Sub2API</option></select></label><label className="group-management-consent"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} /><span>在模型比价中展示报价<small>开启后，同步分组时一并更新模型报价；站点须公开且启用才会展示。</small></span></label><button type="button" className="button button-ghost button-small" disabled={busy || !dirty} onClick={() => void action(false)}>保存设置</button></div>
      <p className="group-management-hint">{dirty ? '设置已修改，请先保存后再同步。' : '主动同步至少间隔 5 分钟；失败保留已有数据。未开启报价展示时，仅更新分组。'}</p>
      <div className="group-management-meta"><span>已保存分组 <strong>{names.length}</strong></span><span>分组更新：{groups?.detectedAt ? new Date(groups.detectedAt).toLocaleString('zh-CN') : '尚未同步'}</span>{data.sync?.syncedAt && <span>报价更新：{new Date(data.sync.syncedAt).toLocaleString('zh-CN')}</span>}</div>
      {data.sync?.error && <p className="notice">最近报价同步未成功：{data.sync.error}。保留上次成功报价。</p>}
      {Boolean(data.sync?.unsupportedCount) && <p className="notice">{data.sync?.unsupportedCount} 项特殊计费无法可靠计算，未纳入模型报价。</p>}
      {names.length ? <div className="group-management-list">{names.map(name => {
        const group = groups?.groups.find(item => item.name === name)
        const quotes = data.quotes.filter(quote => quote.groupName === name)
        return <article className="group-management-card" key={name}><div className="group-management-card-heading"><div><h4>{name}</h4><span>{group?.type || '历史报价分组'} · {group?.modelCount ? `${group.modelCount} 个模型` : '模型数未公开'}</span></div><strong>{group ? `${group.ratio}×` : '倍率未知'}</strong></div>{group?.description && <p>{group.description}</p>}{quotes.length ? <details><summary>模型报价 · {quotes.length} 条</summary><div className="admin-table-wrap"><table><thead><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>币种 / 单位</th></tr></thead><tbody>{quotes.map((quote, index) => <tr key={quote.id ?? index}><td>{quote.modelId}</td><td>{quote.inputPrice ?? '—'}</td><td>{quote.outputPrice ?? '—'}</td><td>{quote.cacheReadPrice ?? '—'}</td><td>{quote.currency} / {quote.billingUnit}</td></tr>)}</tbody></table></div></details> : <p className="group-management-no-quotes">暂无已保存的模型报价</p>}</article>
      })}</div> : <div className="empty-state"><h3>暂无分组数据</h3><p>确认站点系统后，点击右上角“同步分组”。</p></div>}
      <p className="group-management-hint">模型报价为公开参考标价，不代表实际扣费；分组与报价更新时间可能不同，请以站点实际计费为准。</p>
    </>}
  </section>
}
