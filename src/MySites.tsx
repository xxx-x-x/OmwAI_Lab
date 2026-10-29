import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useBlocker } from 'react-router-dom'
import { CheckCircle2, ExternalLink, RefreshCw, Search, Globe2, Plus, ArrowUpRight } from 'lucide-react'
import { ModelBrandIcon } from './ModelBrandIcon'
import { pricingFamilies, pricingFamilyLabel } from './pricingFamilies'
import SiteDialog from './SiteDialog'
import SiteGroupSync from './SiteGroupSync'
import { revisionFieldLabels, revisionValue, type ManagedSite, type SiteProposal } from './siteRevisionTypes'
import './MySites.css'

const billingTypes = ['按量计费', '按次计费', '包月订阅', '混合计费', '其他']
const splitModels = (models: string) => models.split(/[,，、;；\n]+/).map(value => value.trim()).filter(Boolean)

function RevisionEditor({ site, onSaved, onCancel, onClose }: { site: ManagedSite; onSaved: () => Promise<void>; onCancel: () => void; onClose: () => void }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [formDirty, setFormDirty] = useState(false)
  const [initialLogoUrl, setInitialLogoUrl] = useState<string | null>(null)
  const [exitAction, setExitAction] = useState<(() => void) | null>(null)
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [models, setModels] = useState(splitModels(site.models))
  const [creators, setCreators] = useState(splitModels(site.models))
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoError, setLogoError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitted = useRef(false)
  const dirty = formDirty || JSON.stringify([...models].sort()) !== JSON.stringify(splitModels(site.models).sort()) || (initialLogoUrl !== null && logoUrl !== initialLogoUrl)
  const blocker = useBlocker(() => !submitted.current && (dirty || busy))
  const requestExit = (action: () => void) => {
    if (busy) return
    if (dirty && !submitted.current) setExitAction(() => action)
    else action()
  }
  useEffect(() => {
    if (!dirty && !busy) return
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (submitted.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [dirty, busy])
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
      setInitialLogoUrl(result.customUrl || '')
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
      submitted.current = true
      await onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  return <SiteDialog title={`编辑 · ${site.name}`} onClose={() => requestExit(onClose)}><form ref={formRef} className="site-edit-form" onChange={() => {
    const fields = formRef.current?.elements
    if (!fields) return
    setFormDirty(Array.from(fields).some(field => {
      if (field instanceof HTMLInputElement) return field.name && (field.type === 'checkbox' ? field.checked !== field.defaultChecked : field.value !== field.defaultValue)
      if (field instanceof HTMLTextAreaElement) return field.value !== field.defaultValue
      if (field instanceof HTMLSelectElement) return Array.from(field.options).some(option => option.selected !== option.defaultSelected)
      return false
    }))
  }} onSubmit={submit}><p className="site-dialog-notice">修改将作为独立版本提交审核。当前已收录资料继续展示，只有审核通过才会替换；待审期间不能再次提交，可先撤回。</p><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><h3>基本信息</h3><div className="form-grid"><label>站点名称 *<input name="name" defaultValue={site.name} required maxLength={255} /></label><label>成立时间 *<input name="foundedAt" type="date" defaultValue={site.foundedAt?.slice(0, 10) || ''} max={today} required /></label><label className="full">站点 URL *<input name="website" type="url" defaultValue={site.website} required maxLength={2048} /></label><label className="full">网站介绍 *<textarea name="description" defaultValue={site.description || ''} required maxLength={10000} rows={3} /></label></div><h3>计费与发票</h3><div className="form-grid"><label>计费方式 *<select name="billingType" defaultValue={site.billingType || ''} required><option value="" disabled>请选择</option>{billingTypes.map(type => <option key={type}>{type}</option>)}</select></label><label>支持发票 *<select name="invoice" defaultValue={site.invoice == null ? '' : String(site.invoice)} required><option value="" disabled>请选择</option><option value="true">支持</option><option value="false">不支持</option></select></label><label className="full">计费补充说明<textarea name="billingDetails" defaultValue={site.billingDetails || ''} maxLength={1000} rows={2} /></label><label className="full">公开价格说明<textarea name="pricing" defaultValue={site.pricing || ''} maxLength={10000} rows={2} /></label></div><h3>模型覆盖 * · 已选 {models.length} 项</h3><div className="model-creator-options">{creators.map(creator => <label key={creator}><input type="checkbox" checked={models.includes(creator)} onChange={event => setModels(previous => event.target.checked ? [...previous, creator] : previous.filter(name => name !== creator))} /><ModelBrandIcon brand={creator} size={20} />{creator}</label>)}</div><h3>Logo 与补充说明</h3><div className="form-grid"><label className="full">自定义 Logo URL<input type="url" value={logoUrl || ''} disabled={logoUrl === null} maxLength={2048} placeholder="留空使用站点自动发现的 Logo" onChange={event => setLogoUrl(event.target.value)} /></label><label className="full">公开补充说明<textarea name="notes" defaultValue={site.notes || ''} maxLength={10000} rows={2} /></label></div>{logoError && <p className="form-error" role="alert">{logoError}</p>}<label className="submission-confirmation"><input name="informationValid" type="checkbox" required /><span><strong>我确认修改后的资料真实、准确，并同意重新审核。</strong><small>所有公开资料（包括 Logo、计费和发票信息）审核通过后统一生效。</small></span></label></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="site-dialog-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={() => requestExit(onCancel)}>返回详情</button><button className="button" disabled={busy || logoUrl === null}>{busy ? '提交中…' : '提交修改审核'}  </button></div></form>{(exitAction || blocker.state === 'blocked') && <SiteDialog title="放弃修改？" onClose={() => { setExitAction(null); if (blocker.state === 'blocked') blocker.reset() }}><p>你有未保存的修改，离开后这些修改将丢失。确定放弃修改吗？</p><div className="site-dialog-actions"><button type="button" className="button button-ghost" autoFocus onClick={() => { setExitAction(null); if (blocker.state === 'blocked') blocker.reset() }}>继续编辑</button><button type="button" className="button danger" disabled={busy} onClick={() => { if (blocker.state === 'blocked') blocker.proceed(); else exitAction?.(); setExitAction(null) }}>放弃修改</button></div></SiteDialog>}</SiteDialog>
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
  if (editing) return <RevisionEditor site={site} onClose={onClose} onSaved={async () => { await reload(); setEditing(false); setMessage('修改已提交审核，当前收录资料保持不变。') }} onCancel={() => setEditing(false)} />
  const pending = site.pendingRevision
  const latest = site.latestRevision
  return <SiteDialog title="站点资料" kicker="我的站点 / 查看资料" className="site-profile-dialog" onClose={onClose}>
    <div className="site-profile-hero"><div className="site-profile-logo"><Globe2 size={26} /><img src={`/api/user/sites/${site.id}/logo/image`} alt={`${site.name} Logo`} onError={event => { event.currentTarget.hidden = true }} /></div><div className="site-profile-identity"><div><h3>{site.name}</h3><span className="admin-badge approved"><CheckCircle2 size={12} />已收录</span></div><a href={site.website} target="_blank" rel="noopener noreferrer">{site.website}<ExternalLink size={13} /></a></div></div>
    <p className="site-profile-notice"><CheckCircle2 size={15} />当前为审核通过的资料，修改须重新审核，期间不影响线上版本。</p>
    <div className="site-profile-sections"><section className="site-profile-section"><h3>基本资料</h3><dl className="site-profile-fields"><div><dt>成立时间</dt><dd>{site.foundedAt?.slice(0, 10) || '未填写'}</dd></div><div><dt>启用状态</dt><dd>{site.active ? '已启用' : '未启用'}</dd></div><div className="wide"><dt>网站介绍</dt><dd>{site.description || '未填写'}</dd></div></dl></section>
    <section className="site-profile-section"><h3>模型覆盖</h3><div className="site-profile-models">{splitModels(site.models).length ? splitModels(site.models).map(model => <span key={model}><ModelBrandIcon brand={model} size={18} />{model}</span>) : <p>未填写</p>}</div></section>
    <section className="site-profile-section"><h3>计费与服务</h3><dl className="site-profile-fields"><div><dt>计费类型</dt><dd>{site.billingType || '未填写'}</dd></div><div><dt>发票支持</dt><dd>{revisionValue(site.invoice)}</dd></div><div className="wide"><dt>公开价格说明</dt><dd>{site.pricing || '未填写'}</dd></div>{site.billingDetails && <div className="wide"><dt>计费补充</dt><dd>{site.billingDetails}</dd></div>}</dl></section>
    {(site.notes || site.review_note) && <section className="site-profile-section"><h3>补充信息</h3><dl className="site-profile-fields">{site.notes && <div className="wide"><dt>补充说明</dt><dd>{site.notes}</dd></div>}{site.review_note && <div className="wide"><dt>审核说明</dt><dd>{site.review_note}</dd></div>}</dl></section>}</div>
    {pending && <section className="site-revision-summary"><h3>修改审核中</h3><p>以下为待审版本，当前线上资料保持不变。</p><div className="site-profile-comparison"><RevisionComparison site={site} proposal={pending.proposal} /></div>{confirmWithdraw ? <div className="site-dialog-actions"><span>确定撤回本次修改？</span><button type="button" className="button button-ghost" disabled={busy} onClick={() => setConfirmWithdraw(false)}>取消</button><button type="button" className="button danger" disabled={busy} onClick={() => void change('revision', 'DELETE')}>确认撤回</button></div> : <div className="site-dialog-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={() => setConfirmWithdraw(true)}>撤回本次修改</button></div>}</section>}
    {!pending && latest?.status === 'rejected' && <p className="site-dialog-notice">上次修改未通过：{latest.reviewNote || '请完善资料后重新提交'}。当前收录资料未变更。</p>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="site-profile-message" role="status">{message}</p>}
    <footer className="site-profile-footer"><span>仅管理站点公开资料</span><div><button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>关闭</button><button type="button" className="button" disabled={busy || Boolean(pending)} onClick={() => { setEditing(true); setMessage('') }}>{pending ? '修改审核中' : '编辑资料'}</button></div></footer>
  </SiteDialog>
}

export function RevisionComparison({ site, proposal }: { site: Partial<ManagedSite>; proposal: SiteProposal }) {
  return <table className="site-revision-table"><thead><tr><th>字段</th><th>当前已通过</th><th>本次提交</th></tr></thead><tbody>{revisionFieldLabels.map(([key, label]) => <tr key={key}><th>{label}</th><td>{key === 'logoUrl' ? site.logoUrl || '自动发现站点 Logo' : revisionValue(site[key as keyof ManagedSite])}</td><td>{key === 'logoUrl' && !proposal[key] ? '自动发现站点 Logo' : revisionValue(proposal[key])}</td></tr>)}</tbody></table>
}

function SiteListingSwitch({ site, onChanged }: { site: ManagedSite; onChanged: (listed: boolean, remaining: number, day: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<boolean | null>(null)
  const [today, setToday] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)), 1000)
    return () => clearInterval(timer)
  }, [])
  const remaining = site.listingQuotaDay === today ? site.listingEnableRemaining ?? 2 : 2
  const change = async (listed: boolean) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/user/sites/${site.id}/listing`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listed, confirmed: true }) })
      const result = await response.json()
      if (!response.ok) {
        if (result.listingQuotaDay) onChanged(Boolean(site.directoryListed), result.listingEnableRemaining, result.listingQuotaDay)
        throw new Error(result.error || '展示设置保存失败')
      }
      onChanged(listed, result.listingEnableRemaining, result.listingQuotaDay)
      setConfirm(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  return <div className="my-sites-listing-setting"><input className="site-listing-switch" type="checkbox" role="switch" aria-label={`${site.name}公开展示`} checked={Boolean(site.directoryListed)} disabled={busy} onChange={event => { setError(''); setConfirm(event.target.checked) }} /><small>{busy ? '保存中…' : site.directoryListed ? site.active ? '已开启' : '已开启 · 待启用' : '已关闭'}<span className="listing-quota">今日可开启 {remaining}/2 次</span></small>{error && confirm === null && <span className="form-error" role="alert">{error}</span>}{confirm !== null && <SiteDialog title={confirm ? '确认开启公开展示' : '确认关闭公开展示'} onClose={() => { if (!busy) setConfirm(null) }}><p>{confirm ? `确认将「${site.name}」公开展示？该站点每天最多开启两次，按北京时间 00:00 重置。` : `确认关闭「${site.name}」的公开展示？关闭后将从服务目录和公开比价中隐藏，已保存资料不会删除。`}</p><p className="site-dialog-notice">今日剩余开启次数：{remaining}/2。{confirm ? site.active ? '确认成功后消耗一次开启额度。' : '开启后仍需管理员启用站点才会公开展示。' : '关闭不消耗次数；再次开启仍受每日次数限制。'}</p>{confirm && remaining === 0 && <p className="form-error" role="alert">今日开启次数已用完，请于北京时间明日 00:00 后重试。</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="site-dialog-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button type="button" className="button" disabled={busy || (confirm && remaining === 0)} onClick={() => void change(confirm)}>{busy ? '保存中…' : confirm ? '确认开启' : '确认关闭'}</button></div></SiteDialog>}</div>
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
  return <div className="my-sites-page"><div className="admin-heading my-sites-heading"><div><div className="my-sites-title"><h2>我的站点</h2><span>{sites.length}</span></div><p>管理收录资料、公开展示与分组数据。</p></div><div className="my-sites-header-actions"><button className="button button-ghost button-small" disabled={loading} onClick={() => void load().catch(() => {})}><RefreshCw size={15} className={loading ? 'spinning' : ''} />刷新</button><Link className="button button-small" to="/site-management"><Plus size={15} />提交站点</Link></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="my-sites-panel"><div className="my-sites-toolbar"><label className="my-sites-search"><Search size={17} /><input type="search" placeholder="搜索站点名称或网址" aria-label="搜索我的站点" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /></label><span>{query ? `找到 ${filtered.length} 个站点` : '站点列表'}</span></div><div className="my-sites-table-wrap"><table className="my-sites-table"><thead><tr><th>站点 / 网址</th><th>收录状态</th><th>公开展示</th><th>展示设置</th><th>操作</th></tr></thead><tbody>{filtered.slice((currentPage - 1) * 10, currentPage * 10).map(site => <tr key={site.id}><td data-label="站点"><div className="my-sites-identity"><span className="my-sites-avatar"><Globe2 size={21} /><img src={`/api/user/sites/${site.id}/logo/image`} alt={`${site.name} Logo`} loading="lazy" onError={event => { event.currentTarget.hidden = true }} /></span><div><strong>{site.name}</strong><a href={site.website} target="_blank" rel="noopener noreferrer" title={site.website}>{site.website}<ArrowUpRight size={12} /></a></div></div></td><td data-label="收录状态"><div className="row-status"><span className={`admin-badge ${site.status}`}>{site.status === 'approved' ? '已收录' : site.status === 'pending' ? '待审核' : '未通过'}</span>{site.pendingRevision && <span className="admin-badge pending">修改审核中</span>}</div></td><td data-label="公开展示"><span className={`my-sites-visibility ${site.status === 'approved' && site.active && site.directoryListed ? 'is-public' : ''}`}><i />{site.status !== 'approved' ? '未公开' : site.active && site.directoryListed ? '展示中' : '未展示'}</span></td><td data-label="展示设置">{site.status === 'approved' ? <SiteListingSwitch site={site} onChanged={(listed, remaining, day) => setSites(current => current.map(item => item.id === site.id ? { ...item, directoryListed: listed, listingEnableRemaining: remaining, listingQuotaDay: day } : item))} /> : <span className="my-sites-setting-unavailable">审核通过后可设置</span>}</td><td data-label="操作"><div className="my-sites-actions"><button className="my-sites-view" type="button" onClick={() => setSelectedId(site.id)}>查看资料</button>{site.status === 'approved' && <><Link className="button button-ghost button-small" to={`/site-management/sites/${site.id}/pricing`}>分组管理</Link><SiteGroupSync siteId={site.id} /></>}</div></td></tr>)}</tbody></table></div>{!filtered.length && <div className="empty-state"><h3>{loading ? '正在加载站点…' : query ? '未找到匹配站点' : '暂无站点'}</h3>{!loading && !query && <Link className="button" to="/site-management">提交站点收录</Link>}</div>}<div className="my-sites-pagination"><small>共 {filtered.length} 个站点 · 每页 10 条</small><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>{selected && (selected.status === 'approved' ? <SiteDetails key={selected.id} site={selected} reload={load} onClose={() => setSelectedId(null)} /> : <SiteDialog title={selected.name} onClose={() => setSelectedId(null)}><p className="site-dialog-notice">{selected.status === 'pending' ? '站点正在等待收录审核。' : `收录未通过：${selected.review_note || '请联系管理员了解审核原因'}`}</p><dl className="site-detail-grid">{revisionFieldLabels.filter(([key]) => key !== 'logoUrl').map(([key, label]) => <div className="wide" key={key}><dt>{label}</dt><dd>{revisionValue(selected[key as keyof ManagedSite])}</dd></div>)}</dl></SiteDialog>)}<p className="my-sites-footnote"><CheckCircle2 size={14} />资料修改须审核通过后生效，审核期间不影响当前公开版本。</p></div>
}
