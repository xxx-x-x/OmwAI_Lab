import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react'
import { ModelBrandIcon } from './ModelBrandIcon'
import { pricingFamilies, pricingFamilyLabel } from './pricingFamilies'
import SiteDialog from './SiteDialog'
import SitePricing from './SitePricing'
import { revisionFieldLabels, revisionValue, type ManagedSite, type SiteProposal } from './siteRevisionTypes'
import './MySites.css'

const billingTypes = ['按量计费', '按次计费', '包月订阅', '混合计费', '其他']
const splitModels = (models: string) => models.split(/[,，、;；\n]+/).map(value => value.trim()).filter(Boolean)

function RevisionEditor({ site, onSaved, onCancel }: { site: ManagedSite; onSaved: () => Promise<void>; onCancel: () => void }) {
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [models, setModels] = useState(splitModels(site.models))
  const [creators, setCreators] = useState(splitModels(site.models))
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoError, setLogoError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/model-prices', { signal: controller.signal }).then(async response => {
      if (!response.ok) return
      const data = await response.json()
      const names = pricingFamilies(data.models).map(pricingFamilyLabel)
      setCreators([...new Set([...splitModels(site.models), ...names])])
    }).catch(() => {})
    fetch(`/api/user/sites/${site.id}/logo`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Logo 设置加载失败')
      setLogoUrl(result.customUrl || '')
    }).catch(error => { if (!controller.signal.aborted) setLogoError(error instanceof Error ? error.message : 'Logo 设置加载失败') })
    return () => controller.abort()
  }, [site.id, site.models])
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!models.length) { setError('请至少选择一个模型厂商'); return }
    if (logoUrl === null) { setError('请等待 Logo 设置加载完成；加载失败时请关闭后重试'); return }
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/user/sites/${site.id}/revision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(form), invoice: form.get('invoice') === 'true', models: models.join('、'), logoUrl, informationValid: form.has('informationValid') }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '提交失败')
      await onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  return <form className="site-edit-form" onSubmit={submit}><p className="site-dialog-notice">修改将作为独立版本提交审核。当前已收录资料继续展示，只有审核通过才会替换；待审期间不能再次提交，可先撤回。</p><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><h3>基本信息</h3><div className="form-grid"><label>站点名称 *<input name="name" defaultValue={site.name} required maxLength={255} /></label><label>成立时间 *<input name="foundedAt" type="date" defaultValue={site.foundedAt?.slice(0, 10) || ''} max={today} required /></label><label className="full">站点 URL *<input name="website" type="url" defaultValue={site.website} required maxLength={2048} /></label><label className="full">网站介绍 *<textarea name="description" defaultValue={site.description || ''} required maxLength={10000} rows={3} /></label></div><h3>计费与发票</h3><div className="form-grid"><label>计费方式 *<select name="billingType" defaultValue={site.billingType || ''} required><option value="" disabled>请选择</option>{billingTypes.map(type => <option key={type}>{type}</option>)}</select></label><label>支持发票 *<select name="invoice" defaultValue={site.invoice == null ? '' : String(site.invoice)} required><option value="" disabled>请选择</option><option value="true">支持</option><option value="false">不支持</option></select></label><label className="full">计费补充说明<textarea name="billingDetails" defaultValue={site.billingDetails || ''} maxLength={1000} rows={2} /></label><label className="full">公开价格说明<textarea name="pricing" defaultValue={site.pricing || ''} maxLength={10000} rows={2} /></label></div><h3>模型覆盖 * · 已选 {models.length} 项</h3><div className="model-creator-options">{creators.map(creator => <label key={creator}><input type="checkbox" checked={models.includes(creator)} onChange={event => setModels(previous => event.target.checked ? [...previous, creator] : previous.filter(name => name !== creator))} /><ModelBrandIcon brand={creator} size={20} />{creator}</label>)}</div><h3>Logo 与补充说明</h3><div className="form-grid"><label className="full">自定义 Logo URL<input type="url" value={logoUrl || ''} disabled={logoUrl === null} maxLength={2048} placeholder="留空使用站点自动发现的 Logo" onChange={event => setLogoUrl(event.target.value)} /></label><label className="full">公开补充说明<textarea name="notes" defaultValue={site.notes || ''} maxLength={10000} rows={2} /></label></div>{logoError && <p className="form-error" role="alert">{logoError}</p>}<label className="submission-confirmation"><input name="informationValid" type="checkbox" required /><span><strong>我确认修改后的资料真实、准确，并同意重新审核。</strong><small>所有公开资料（包括 Logo、计费和发票信息）审核通过后统一生效。</small></span></label></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="site-dialog-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={onCancel}>返回详情</button><button className="button" disabled={busy || logoUrl === null}>{busy ? '提交中…' : '提交修改审核'}</button></div></form>
}

function SiteDetails({ site, reload, onClose }: { site: ManagedSite; reload: () => Promise<void>; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [message, setMessage] = useState('')
  const change = async (path: string, method: string, body?: unknown) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/user/sites/${site.id}/${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '操作失败')
      await reload(); setConfirmWithdraw(false); setMessage(path === 'revision' ? '已撤回修改，原收录资料未变更。' : '公开展示设置已保存。')
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  if (editing) return <SiteDialog title={`编辑 · ${site.name}`} onClose={onClose}><RevisionEditor site={site} onSaved={async () => { await reload(); setEditing(false); setMessage('修改已提交审核，当前收录资料保持不变。') }} onCancel={() => setEditing(false)} /></SiteDialog>
  const pending = site.pendingRevision
  const latest = site.latestRevision
  return <SiteDialog title={site.name} onClose={onClose}><p className="site-dialog-notice">当前展示已通过审核的资料。编辑后须重新审核，审核期间不影响线上已收录版本。</p><span className="admin-badge approved"><CheckCircle2 size={14} /> 已收录</span><dl className="site-detail-grid"><div className="wide"><dt>站点网址</dt><dd><a href={site.website} target="_blank" rel="noopener noreferrer">{site.website} <ExternalLink size={13} /></a></dd></div>{revisionFieldLabels.filter(([key]) => !['name', 'website', 'logoUrl'].includes(key)).map(([key, label]) => <div className={['description', 'notes', 'models', 'billingDetails', 'pricing'].includes(key) ? 'wide' : ''} key={key}><dt>{label}</dt><dd>{revisionValue(site[key as keyof ManagedSite])}</dd></div>)}<div><dt>当前 Logo</dt><dd><img src={`/api/user/sites/${site.id}/logo/image`} width={40} height={40} alt="站点 Logo" onError={event => { event.currentTarget.hidden = true }} /></dd></div></dl>{site.review_note && <p>审核说明：{site.review_note}</p>}{!site.active && <p className="notice">站点尚未启用或已停用，当前不会在目录中展示。</p>}<label className="site-listing-control"><input type="checkbox" checked={Boolean(site.directoryListed)} disabled={busy} onChange={event => void change('listing', 'PATCH', { listed: event.target.checked })} /><span>在服务目录公开展示（此开关无需重新审核）</span></label>{pending && <section className="site-revision-summary"><h3>修改审核中</h3><p>以下为待审版本，当前线上资料保持不变。</p><RevisionComparison site={site} proposal={pending.proposal} />{confirmWithdraw ? <div className="site-dialog-actions"><span>确定撤回本次修改？</span><button type="button" className="button button-ghost" disabled={busy} onClick={() => setConfirmWithdraw(false)}>取消</button><button type="button" className="button danger" disabled={busy} onClick={() => void change('revision', 'DELETE')}>确认撤回</button></div> : <div className="site-dialog-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={() => setConfirmWithdraw(true)}>撤回本次修改</button></div>}</section>}{!pending && latest?.status === 'rejected' && <p className="site-dialog-notice">上次修改未通过：{latest.reviewNote || '请完善资料后重新提交'}。当前收录资料未变更。</p>}<details className="site-pricing-details"><summary>分组与报价（独立审核）</summary><SitePricing siteId={site.id} /></details>{error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}<div className="site-dialog-actions"><button type="button" className="button button-ghost" onClick={onClose}>关闭</button><button type="button" className="button" disabled={busy || Boolean(pending)} onClick={() => { setEditing(true); setMessage('') }}>{pending ? '已有修改待审核' : '编辑资料 · 重新审核'}</button></div></SiteDialog>
}

export function RevisionComparison({ site, proposal }: { site: Partial<ManagedSite>; proposal: SiteProposal }) {
  return <table className="site-revision-table"><thead><tr><th>字段</th><th>当前已通过</th><th>本次提交</th></tr></thead><tbody>{revisionFieldLabels.map(([key, label]) => <tr key={key}><th>{label}</th><td>{key === 'logoUrl' ? site.logoUrl || '自动发现站点 Logo' : revisionValue(site[key as keyof ManagedSite])}</td><td>{key === 'logoUrl' && !proposal[key] ? '自动发现站点 Logo' : revisionValue(proposal[key])}</td></tr>)}</tbody></table>
}

export default function MySites() {
  const [sites, setSites] = useState<ManagedSite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/user/sites', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '站点加载失败')
      setSites(result.sites)
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试'); throw error }
    finally { setLoading(false) }
  }, [])
  // oxlint-disable-next-line react/set-state-in-effect -- load the API snapshot on mount
  useEffect(() => { void load().catch(() => {}) }, [load])
  const filtered = sites.filter(site => `${site.name} ${site.website}`.toLowerCase().includes(query.toLowerCase()))
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(page, pages)
  const selected = sites.find(site => site.id === selectedId)
  return <div><div className="admin-heading"><div><h2>我的站点</h2><p>集中管理已提交站点；修改审核通过后才会更新公开资料。</p></div><button className="button button-ghost" disabled={loading} onClick={() => void load().catch(() => {})}><RefreshCw size={16} />刷新</button></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="my-sites-panel"><div className="my-sites-toolbar"><input type="search" placeholder="搜索站点名称或网址" aria-label="搜索我的站点" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /><span>共 {filtered.length} 个站点 · 每页 10 条</span></div><div className="my-sites-table-wrap"><table className="my-sites-table"><thead><tr><th>站点 / 网址</th><th>收录状态</th><th>公开展示</th><th>操作</th></tr></thead><tbody>{filtered.slice((currentPage - 1) * 10, currentPage * 10).map(site => <tr key={site.id}><td><strong>{site.name}</strong><small title={site.website}>{site.website}</small></td><td><div className="row-status"><span className={`admin-badge ${site.status}`}>{site.status === 'approved' ? '已收录' : site.status === 'pending' ? '待审核' : '未通过'}</span>{site.pendingRevision && <span className="admin-badge pending">修改审核中</span>}</div></td><td>{site.status !== 'approved' ? '—' : site.active && site.directoryListed ? '展示中' : '未展示'}</td><td><button type="button" onClick={() => setSelectedId(site.id)}>查看</button></td></tr>)}</tbody></table></div>{!filtered.length && <div className="empty-state"><h3>{loading ? '正在加载站点…' : query ? '未找到匹配站点' : '暂无站点'}</h3>{!loading && !query && <Link className="button" to="/site-management">提交站点收录</Link>}</div>}<div className="my-sites-pagination"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>{selected && (selected.status === 'approved' ? <SiteDetails key={selected.id} site={selected} reload={load} onClose={() => setSelectedId(null)} /> : <SiteDialog title={selected.name} onClose={() => setSelectedId(null)}><p className="site-dialog-notice">{selected.status === 'pending' ? '站点正在等待收录审核。' : `收录未通过：${selected.review_note || '请联系管理员了解审核原因'}`}</p><dl className="site-detail-grid">{revisionFieldLabels.filter(([key]) => key !== 'logoUrl').map(([key, label]) => <div className="wide" key={key}><dt>{label}</dt><dd>{revisionValue(selected[key as keyof ManagedSite])}</dd></div>)}</dl></SiteDialog>)}</div>
}
