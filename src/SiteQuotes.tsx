import { useEffect, useState } from 'react'

type Quote = { id: number; siteId?: number; siteName?: string; website?: string; groupName: string; modelId: string; currency: string; billingUnit: string; inputPrice: string | null; outputPrice: string | null; sourceUrl: string; status?: string; reviewedAt?: string | null }
type Site = { id: number; name: string; status: string }
type Authorization = { id: number; groupName: string; hasCredential: number | boolean; revokedAt: string | null }

async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`操作失败 (${response.status})，请检查登录状态、站点资格或提交内容。`)
  return response.json() as Promise<T>
}
const statusText = (status?: string) => ({ pending: '待审核', approved: '已通过', rejected: '已驳回' }[status ?? ''] ?? status)
function QuoteTable({ quotes, review }: { quotes: Quote[]; review?: (id: number, status: 'approved' | 'rejected') => void }) {
  if (!quotes.length) return <p>暂无报价。</p>
  return <div className="admin-table-wrap"><table><thead><tr><th>站点</th><th>分组 / 模型</th><th>输入</th><th>输出</th><th>单位</th><th>来源</th><th>状态 / 审核时间</th>{review && <th>操作</th>}</tr></thead><tbody>{quotes.map(q => <tr key={q.id}><td>{q.siteName || (q.siteId ? `#${q.siteId}` : '本站')}</td><td>{q.groupName}<small>{q.modelId}</small></td><td>{q.inputPrice ?? '—'} {q.currency}</td><td>{q.outputPrice ?? '—'} {q.currency}</td><td>{q.billingUnit}</td><td><a href={q.sourceUrl} target="_blank" rel="noopener noreferrer">来源</a></td><td>{statusText(q.status) || '已审核'}<small>{q.reviewedAt || '—'}</small></td>{review && <td className="admin-actions">{q.status === 'pending' && <><button onClick={() => review(q.id, 'approved')}>通过</button><button onClick={() => review(q.id, 'rejected')}>驳回</button></>}</td>}</tr>)}</tbody></table></div>
}
function safeLink(value?: string) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined } catch { return undefined }
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

export function SiteComparison({ modelId }: { modelId: string }) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null); const [error, setError] = useState('')
  const [search, setSearch] = useState(''); const [sort, setSort] = useState<'default' | 'input' | 'output'>('default'); const [pair, setPair] = useState('')
  useEffect(() => { const controller = new AbortController(); setQuotes(null); setError(''); setSearch(''); setSort('default'); setPair(''); fetch(`/api/site-comparison?modelId=${encodeURIComponent(modelId)}`, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json() }).then(data => setQuotes(data.quotes)).catch(() => { if (!controller.signal.aborted) setError('站点报价加载失败。') }); return () => controller.abort() }, [modelId])
  const pairs = Array.from(new Map((quotes ?? []).filter(q => q.currency?.trim() && q.billingUnit?.trim()).map(q => [JSON.stringify([q.currency, q.billingUnit]), [q.currency, q.billingUnit] as const])).entries())
  const filtered = (quotes ?? []).filter(q => `${q.siteName ?? ''} ${q.groupName ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const visible = sort === 'default' ? filtered : filtered.filter(q => JSON.stringify([q.currency, q.billingUnit]) === pair).sort((a, b) => comparePrices(sort === 'input' ? a.inputPrice : a.outputPrice, sort === 'input' ? b.inputPrice : b.outputPrice))
  return <article className="model-detail-card model-detail-section"><h2>站点分组报价对比</h2><p className="model-detail-muted">仅展示站长授权、手动提交并通过审核的报价；不包含公开抓取数据。无定时检测，价格和计费单位请以来源为准。默认按接口返回顺序展示，不代表评级。</p>{error ? <p role="alert">{error}</p> : !quotes ? <p>加载中…</p> : !quotes.length ? <p className="site-comparison-empty">暂无已审核的站点报价。</p> : <>
    <div className="site-comparison-controls"><label>搜索站点或分组<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="输入站点或分组名称" /></label><label>排序方式<select value={sort} onChange={e => { const next = e.target.value as typeof sort; setSort(next); if (next !== 'default' && !pair && pairs.length) setPair(pairs[0][0]) }}><option value="default">默认顺序</option><option value="input">输入价格升序</option><option value="output">输出价格升序</option></select></label>{sort !== 'default' && <label>币种和计费单位<select value={pair} onChange={e => setPair(e.target.value)}>{!pairs.length && <option value="">无可比较的币种和单位</option>}{pairs.map(([key, [currency, unit]]) => <option key={key} value={key}>{currency} / {unit}</option>)}</select></label>}</div>
    {sort !== 'default' && <p className="model-detail-muted">仅显示所选币种和单位的报价；缺失价格排在最后，不参与价格比较。</p>}
    {!visible.length ? <p className="site-comparison-empty">没有符合筛选条件的报价。</p> : <div className="site-comparison-list">{visible.map(q => { const website = safeLink(q.website), source = safeLink(q.sourceUrl); return <div className="site-comparison-item" key={q.id}><div><strong>{website ? <a href={website} target="_blank" rel="noopener noreferrer">{q.siteName || '站点'}</a> : q.siteName || '站点未提供'}</strong><span>分组：{q.groupName || '未提供'}</span></div><div><span>输入：{q.inputPrice ?? '暂无报价'}</span><span>输出：{q.outputPrice ?? '暂无报价'}</span><span>币种 / 单位：{q.currency || '未提供'} / {q.billingUnit || '未提供'}</span></div><div><span>{source ? <a href={source} target="_blank" rel="noopener noreferrer">查看报价来源</a> : '来源未提供'}</span><span>审核时间：{q.reviewedAt || '暂无数据'}</span></div></div> })}</div>}
  </>}</article>
}
export function AdminQuotes() {
  const [quotes, setQuotes] = useState<Quote[] | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const load = async () => { try { setQuotes((await api<{ quotes: Quote[] }>('/api/admin/site-quotes')).quotes); setError('') } catch { setError('报价加载失败，请刷新重试。') } }
  useEffect(() => { void load() }, [])
  const review = async (id: number, status: 'approved' | 'rejected') => { if (busy) return; setBusy(true); try { await api(`/api/admin/site-quotes/${id}`, 'PATCH', { status }); await load() } catch { await load(); setError('审核失败，报价可能已审核或授权已撤销。') } finally { setBusy(false) } }
  return <article><h2>站点报价审核</h2><p>仅审核站长手动提交的报价；不进行定时检测。</p>{error && <p role="alert">{error}</p>}<button type="button" onClick={load}>刷新报价</button>{quotes ? <QuoteTable quotes={quotes} review={(id, status) => void review(id, status)} /> : <p>加载中…</p>}</article>
}
export function SiteQuotesPage() {
  const [sites, setSites] = useState<Site[]>([]); const [siteId, setSiteId] = useState(''); const [authorizations, setAuthorizations] = useState<Authorization[]>([]); const [quotes, setQuotes] = useState<Quote[]>([]); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false)
  useEffect(() => { api<{ sites: Site[] }>('/api/user/sites').then(data => setSites(data.sites.filter(s => s.status === 'approved'))).catch(() => setError('站点加载失败，请使用本地账号登录。')) }, [])
  useEffect(() => { if (!siteId) return; let cancelled = false; Promise.all([api<{ authorizations: Authorization[] }>(`/api/user/sites/${siteId}/authorizations`), api<{ quotes: Quote[] }>(`/api/user/sites/${siteId}/quotes`)]).then(([a, q]) => { if (!cancelled) { setAuthorizations(a.authorizations); setQuotes(q.quotes); setReady(true) } }).catch(() => { if (!cancelled) setError('无法访问该站点：需要已通过审核且绑定当前本地账号的提交。') }); return () => { cancelled = true } }, [siteId])
  const active = authorizations.filter(a => a.hasCredential && !a.revokedAt)
  const action = async (kind: 'authorize' | 'revoke' | 'quote', form?: HTMLFormElement, groupName?: string) => { setBusy(true); setError(''); setMessage(''); try {
    if (kind === 'revoke') { await api(`/api/user/sites/${siteId}/authorizations/${encodeURIComponent(groupName ?? '')}`, 'DELETE'); setMessage('授权已撤销，密钥已删除，报价不再公开。') }
    else if (kind === 'authorize' && form) { const fields = new FormData(form); const key = String(fields.get('key') ?? ''); const group = String(fields.get('groupName') ?? '').trim(); form.reset(); await api(`/api/user/sites/${siteId}/authorizations/${encodeURIComponent(group)}`, 'PUT', { consent: true, key }); setMessage('授权已保存，既有报价需重新审核。') }
    else if (form) { const fields = Object.fromEntries(new FormData(form)); await api(`/api/user/sites/${siteId}/quotes`, 'POST', { ...fields, authorizationId: Number(fields.authorizationId), inputPrice: fields.inputPrice || null, outputPrice: fields.outputPrice || null }); form.reset(); setMessage('报价已提交，等待人工审核。') }
    setAuthorizations((await api<{ authorizations: Authorization[] }>(`/api/user/sites/${siteId}/authorizations`)).authorizations); setQuotes((await api<{ quotes: Quote[] }>(`/api/user/sites/${siteId}/quotes`)).quotes)
  } catch { setError('操作失败，请检查站点资格、授权和报价格式后重试。') } finally { setBusy(false) } }
  return <section className="page-section container"><h1>站长授权与报价</h1><p>仅本地账号提交并审核通过的站点可使用；账号绑定不代表已验证站点所有权。报价由站长手动提交并经人工审核，无定时检测，公开抓取数据不参与对比。</p><label>选择站点 <select value={siteId} onChange={e => { setSiteId(e.target.value); setReady(false); setAuthorizations([]); setQuotes([]); setError(''); setMessage('') }}><option value="">请选择</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}{siteId && ready && <div className="site-quote-panel"><p>每个分组独立授权，撤销后对应报价不再公开。</p>{authorizations.map(a => <div key={a.id}>{a.groupName}：{a.hasCredential && !a.revokedAt ? '已授权' : '已撤销'} {a.hasCredential && !a.revokedAt && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`确认撤销 ${a.groupName} 的授权？`)) void action('revoke', undefined, a.groupName) }}>撤销授权</button>}</div>)}<form className="submit-form" onSubmit={e => { e.preventDefault(); void action('authorize', e.currentTarget) }}><h2>授权或更新分组</h2><p>密钥仅用于授权，提交后不会显示。更新授权会使现有报价重新进入审核。</p><label>分组名称<input name="groupName" required maxLength={191} /></label><label>密钥<input name="key" type="password" required maxLength={8192} autoComplete="off" /></label><label className="checkbox"><input type="checkbox" required />我同意授权并提交此密钥。</label><button className="button" disabled={busy}>保存授权</button></form><form className="submit-form" onSubmit={e => { e.preventDefault(); void action('quote', e.currentTarget) }}><h2>提交报价</h2><div className="form-grid"><label>已授权分组<select name="authorizationId" required defaultValue=""><option value="">请选择</option>{active.map(a => <option key={a.id} value={a.id}>{a.groupName}</option>)}</select></label><label>模型 ID（须与模型详情一致）<input name="modelId" required maxLength={191} /></label><label>币种（如 USD）<input name="currency" required pattern="[A-Z]{3}" maxLength={3} /></label><label>计费单位<input name="billingUnit" required maxLength={64} placeholder="例如 1M tokens" /></label><label>输入价格<input name="inputPrice" inputMode="decimal" pattern="\d{1,12}(\.\d{1,8})?" /></label><label>输出价格<input name="outputPrice" inputMode="decimal" pattern="\d{1,12}(\.\d{1,8})?" /></label><label className="full">来源 URL（HTTPS，不含查询参数或片段）<input name="sourceUrl" required type="url" maxLength={2048} /></label></div><p>输入和输出价格至少填写一项；提交后等待审核。</p><button className="button" disabled={busy || !active.length}>提交报价</button></form><h2>我的报价</h2><QuoteTable quotes={quotes} /></div>}</section>
}


