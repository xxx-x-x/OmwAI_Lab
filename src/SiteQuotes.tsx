import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, ShieldQuestion } from 'lucide-react'
import { compareMultipliers, lowestPerSite, multiplier } from './comparisonQuotes'

type Quote = { id: number | string; logoUrl?: string | null; verified?: boolean | number; groupMultiplier?: number | string | null; groupMultiplierDetectedAt?: string | null; groupMultiplierSourceUrl?: string | null; groupMultiplierSource?: string | null; sourceType?: string; sourceStatus?: string; syncedAt?: string | null; stale?: boolean; siteId?: number; providerId?: string | null; siteName?: string; website?: string; groupName: string; modelId: string; currency: string; billingUnit: string; inputPrice: string | null; outputPrice: string | null; cacheReadPrice?: string | null; sourceUrl: string; status?: string; reviewedAt?: string | null }

async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`操作失败 (${response.status})，请检查登录状态、站点资格或提交内容。`)
  return response.json() as Promise<T>
}
const statusText = (status?: string) => ({ pending: '待审核', approved: '已通过', rejected: '已驳回' }[status ?? ''] ?? status)
function QuoteTable({ quotes, review }: { quotes: Quote[]; review?: (id: number, status: 'approved' | 'rejected') => void }) {
  if (!quotes.length) return <p>暂无报价。</p>
  return <div className="admin-table-wrap"><table><thead><tr><th>站点</th><th>分组 / 模型</th><th>输入</th><th>输出</th><th>单位</th><th>来源</th><th>状态 / 审核时间</th>{review && <th>操作</th>}</tr></thead><tbody>{quotes.map(q => <tr key={q.id}><td>{q.siteName || (q.siteId ? `#${q.siteId}` : '本站')}</td><td>{q.groupName}<small>{q.modelId}</small></td><td>{q.inputPrice ?? '—'} {q.currency}</td><td>{q.outputPrice ?? '—'} {q.currency}</td><td>{q.billingUnit}</td><td><a href={q.sourceUrl} target="_blank" rel="noopener noreferrer">来源</a></td><td>{statusText(q.status) || '已审核'}<small>{q.reviewedAt || '—'}</small></td>{review && <td className="admin-actions">{q.status === 'pending' && <><button onClick={() => review(Number(q.id), 'approved')}>通过</button><button onClick={() => review(Number(q.id), 'rejected')}>驳回</button></>}</td>}</tr>)}</tbody></table></div>
}

function displayPrice(value: string | null, currency: string) {
  if (value == null) return '—'
  const compact = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
  return currency === 'USD' ? `$${compact}` : `${compact} ${currency}`
}

// Compare decimal strings exactly, without floating-point rounding.
function comparePrices(a: string | null, b: string | null) {
  const parse = (value: string | null) => {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null
    const [whole, fraction = ''] = value.split('.')
    return [whole.replace(/^0+/, '') || '0', fraction.replace(/0+$/, '')] as const
  }
  const left = parse(a), right = parse(b)
  if (!left || !right) return left ? -1 : right ? 1 : 0
  return left[0].length - right[0].length || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0) || (left[1].padEnd(Math.max(left[1].length, right[1].length), '0') < right[1].padEnd(Math.max(left[1].length, right[1].length), '0') ? -1 : left[1].padEnd(Math.max(left[1].length, right[1].length), '0') > right[1].padEnd(Math.max(left[1].length, right[1].length), '0') ? 1 : 0)
}

function ComparisonSite({ quote }: { quote: Quote }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const logo = quote.logoUrl?.startsWith('/api/site-logos/') ? quote.logoUrl : undefined
  return <div className="price-company comparison-site"><i className="comparison-site-logo">{logo && failedUrl !== logo ? <img src={logo} alt="" loading="lazy" onError={() => setFailedUrl(logo)} /> : Array.from(quote.siteName || '?')[0]}</i>{quote.providerId ? <Link to={`/provider/${quote.providerId}`}>{quote.siteName || '站点'}</Link> : quote.siteName || '站点未提供'}<span title={quote.verified ? '已审核收录（非服务质量认证）' : '未认证'}>{quote.verified ? <BadgeCheck size={16} aria-label="已审核收录" /> : <ShieldQuestion size={16} aria-label="未认证" />}</span></div>
}

export function SiteComparison({ modelId }: { modelId: string }) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null); const [error, setError] = useState('')
  const [search, setSearch] = useState(''); const [sort, setSort] = useState<'default' | 'input' | 'output' | 'multiplier-asc' | 'multiplier-desc'>('default'); const [pair, setPair] = useState('')
  useEffect(() => { const controller = new AbortController(); setQuotes(null); setError(''); setSearch(''); setSort('default'); setPair(''); fetch(`/api/site-comparison?modelId=${encodeURIComponent(modelId)}`, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json() }).then(data => setQuotes(data.quotes)).catch(() => { if (!controller.signal.aborted) setError('站点报价加载失败。') }); return () => controller.abort() }, [modelId])
  const pairs = Array.from(new Map((quotes ?? []).filter(q => q.currency?.trim() && q.billingUnit?.trim()).map(q => [JSON.stringify([q.currency, q.billingUnit]), [q.currency, q.billingUnit] as const])).entries())
  const filtered = lowestPerSite(quotes ?? []).filter(q => `${q.siteName ?? ''} ${q.groupName ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const priceSort = sort === 'input' || sort === 'output'
  const visible = priceSort ? filtered.filter(q => JSON.stringify([q.currency, q.billingUnit]) === pair).sort((a, b) => comparePrices(sort === 'input' ? a.inputPrice : a.outputPrice, sort === 'input' ? b.inputPrice : b.outputPrice)) : sort === 'default' ? filtered : filtered.sort((a, b) => compareMultipliers(a, b, sort === 'multiplier-desc'))
  return <article className="model-detail-card model-detail-section"><h2>站点分组报价对比</h2><p className="model-detail-muted">展示站点公开接口同步的分组参考价，以及已审核的历史人工报价。仅对精确匹配的模型 ID 展示，不推测模型别名。接口标价不代表实际扣费；不同币种、单位不可直接比较。默认顺序不代表评级。</p>{error ? <p role="alert">{error}</p> : !quotes ? <p>加载中…</p> : !quotes.length ? <p className="site-comparison-empty">暂无可公开的匹配报价。站点需先同步价格并同意公开展示。</p> : <>
    <div className="site-comparison-controls"><label>搜索站点或分组<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="输入站点或分组名称" /></label><label>排序方式<select value={sort} onChange={e => { const next = e.target.value as typeof sort; setSort(next); if (next !== 'default' && !pair && pairs.length) setPair(pairs[0][0]) }}><option value="default">默认顺序</option><option value="input">输入价格升序</option><option value="output">输出价格升序</option><option value="multiplier-asc">分组倍率升序</option><option value="multiplier-desc">分组倍率降序</option></select></label>{priceSort && <label>币种和计费单位<select value={pair} onChange={e => setPair(e.target.value)}>{!pairs.length && <option value="">无可比较的币种和单位</option>}{pairs.map(([key, [currency, unit]]) => <option key={key} value={key}>{currency} / {unit}</option>)}</select></label>}</div>
    {priceSort && <p className="model-detail-muted">仅显示所选币种和单位的报价；缺失价格排在最后，不参与价格比较。</p>}
    <div className="price-table-wrap site-comparison-table">
      <div className="price-table-meta"><span>共找到 <strong>{visible.length}</strong> 条报价 · <strong>{new Set(visible.map(q => q.siteId ?? q.website ?? q.siteName)).size}</strong> 个站点</span><small>每站仅展示最低倍率分组；倍率未知时保留一条，需站长重新同步。</small></div>
      <div className="price-table-scroll" role="region" aria-label="站点分组报价对比表，可横向滚动" tabIndex={0}>
        <table className="price-table"><thead><tr><th scope="col">序号</th><th scope="col">站点</th><th scope="col">分组</th><th scope="col">分组倍率</th><th scope="col">输入价格 / 单位</th><th scope="col">输出价格 / 单位</th><th scope="col">缓存读取价格 / 单位</th></tr></thead><tbody>{visible.map((q, index) => {
          return <tr key={q.id}>
            <td><b>{index + 1}</b></td>
            <td><ComparisonSite quote={q} /></td>
            <td><div className="price-model"><strong>{q.groupName || '未提供'}</strong></div></td>
            <td title={q.groupMultiplierSource === 'group-probe' ? `独立获取的分组倍率，非价格同一快照；获取时间：${q.groupMultiplierDetectedAt || '未知'}；来源：${q.groupMultiplierSourceUrl || '未知'}` : q.groupMultiplierSource === 'price-snapshot' ? `价格同一快照倍率；获取时间：${q.groupMultiplierDetectedAt || '未知'}；来源：${q.groupMultiplierSourceUrl || '未知'}` : undefined}><b>{multiplier(q) == null ? '倍率未知' : `${multiplier(q)}×`}</b>{q.groupMultiplierSource === 'group-probe' && <small className="price-unit">独立获取 · 非同一快照</small>}</td>
            <td><b>{displayPrice(q.inputPrice, q.currency || '未提供')}</b>{q.inputPrice != null && <small className="price-unit"> / {q.billingUnit || '未提供'}</small>}</td>
            <td><b>{displayPrice(q.outputPrice, q.currency || '未提供')}</b>{q.outputPrice != null && <small className="price-unit"> / {q.billingUnit || '未提供'}</small>}</td>
            <td><b>{displayPrice(q.cacheReadPrice ?? null, q.currency || '未提供')}</b>{q.cacheReadPrice != null && <small className="price-unit"> / {q.billingUnit || '未提供'}</small>}</td>
          </tr>
        })}</tbody></table>
        {!visible.length && <div className="price-empty"><strong>没有符合筛选条件的报价。</strong></div>}
      </div>
    </div>
  </>}</article>
}
export function AdminQuotes() {
  const [quotes, setQuotes] = useState<Quote[] | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const load = async () => { try { setQuotes((await api<{ quotes: Quote[] }>('/api/admin/site-quotes')).quotes); setError('') } catch { setError('报价加载失败，请刷新重试。') } }
  useEffect(() => { void load() }, [])
  const review = async (id: number, status: 'approved' | 'rejected') => { if (busy) return; setBusy(true); try { await api(`/api/admin/site-quotes/${id}`, 'PATCH', { status }); await load() } catch { await load(); setError('审核失败，报价可能已审核或授权已撤销。') } finally { setBusy(false) } }
  return <article><h2>站点报价审核</h2><p>仅审核站长手动提交的报价；不进行定时检测。</p>{error && <p role="alert">{error}</p>}<button type="button" onClick={load}>刷新报价</button>{quotes ? <QuoteTable quotes={quotes} review={(id, status) => void review(id, status)} /> : <p>加载中…</p>}</article>
}
