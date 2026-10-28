import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { pricingFamilies, pricingFamilyLabel } from './pricingFamilies'
import { ModelBrandIcon } from './ModelBrandIcon'
import SitePricing from './SitePricing'
import SiteLogoSettings from './SiteLogoSettings'
import { ArrowRight, CheckCircle2, FileCheck2, Globe2, RefreshCw, ServerCog, ScanSearch, Activity, Clock3 } from 'lucide-react'

type Site = { id: number; name: string; website: string; models: string; status: string; review_note: string; foundedAt: string | null; description: string; directoryListed: boolean | number; active: boolean | number | null }

export function SiteSubmission() {
  const [creators, setCreators] = useState<string[]>(['OpenAI', 'Anthropic', 'DeepSeek'])
  const [selectedModels, setSelectedModels] = useState<string[]>(['OpenAI', 'Anthropic', 'DeepSeek'])
  const [creatorError, setCreatorError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/model-prices', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('厂商列表加载失败')
      const result = await response.json() as { models: { family: string }[] }
      const families = pricingFamilies(result.models)
      setCreators(families)
      setSelectedModels(families.filter(name => ['openai', 'anthropic', 'deepseek'].includes(name.toLowerCase())))
    }).catch(() => { if (!controller.signal.aborted) setCreatorError('定价厂商加载失败，暂时仅显示默认厂商，请刷新后重试。') })
    return () => controller.abort()
  }, [])
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!selectedModels.length) { setError('请至少选择一个支持的模型厂商'); return }
    const fields = { ...Object.fromEntries(form), models: selectedModels.map(pricingFamilyLabel).join('、'), informationValid: form.has('informationValid') }
    setError(''); setBusy(true)
    try {
      const response = await fetch('/api/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '提交失败，请稍后重试')
      setSubmitted(true)
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  if (submitted) return <div className="success-card"><CheckCircle2 /><h2>提交成功，等待管理员审核</h2><p>审核通过后会出现在“我的站点”。公开展示需要你另行勾选并保存。</p><Link className="button" to="/site-management/sites">查看审核进度</Link><button className="button button-ghost" onClick={() => setSubmitted(false)}>继续提交站点</button></div>
  return <form className="submit-form site-submission" onSubmit={submit}><h2>提交站点收录</h2><p>仅需填写站点公开资料，无需提供分组或 KEY。审核通过后，你可以在“我的站点”选择是否公开展示。</p><div className="form-grid">
    <label>站点名称 *<input name="name" required maxLength={255} placeholder="例如：Example AI" /></label>
    <label>站点 URL *<input name="website" type="url" required maxLength={2048} placeholder="https://example.com" /></label>
    <label>成立时间 *<input name="foundedAt" type="date" required max={today} /></label>
    <fieldset className="full model-creator-fieldset"><legend>支持的模型类型 *</legend><p>请选择本站支持的模型厂商，默认选择 OpenAI、Anthropic（Claude）、DeepSeek。</p><div className="model-creator-options">{creators.map(creator => <label key={creator}><input type="checkbox" checked={selectedModels.includes(creator)} onChange={event => setSelectedModels(previous => event.target.checked ? [...previous, creator] : previous.filter(value => value !== creator))} /><ModelBrandIcon brand={creator} size={23} /><span>{pricingFamilyLabel(creator)}</span></label>)}</div>{creatorError && <p className="form-error" role="alert">{creatorError}</p>}</fieldset>
    <label className="full">网站介绍 *<textarea name="description" required rows={4} maxLength={10000} placeholder="介绍站点的服务内容和特点" /></label>
    <label className="full">公开补充说明<textarea name="notes" rows={3} maxLength={5000} placeholder="可选，仅填写可公开的信息，请勿填写账户或 KEY" /></label>
  </div><fieldset className="probe-confirmations"><legend>提交前确认</legend><label className="probe-confirmation"><input name="informationValid" type="checkbox" required /><span><strong>站点信息真实有效</strong><small>我确认所填资料真实、准确，且有权代表该站点提交收录。收录审核不代表平台对服务质量或模型真实性作出保证。</small></span></label></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="button submit-button" disabled={busy}>{busy ? '提交中…' : <>提交审核 <ArrowRight size={18} /></>}</button></form>
}

function MySiteCard({ site }: { site: Site }) {
  const [listed, setListed] = useState(Boolean(site.directoryListed))
  const [saved, setSaved] = useState(Boolean(site.directoryListed))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/user/sites/${site.id}/listing`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listed }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '保存失败')
      setSaved(listed); setMessage(listed ? '已保存公开展示意愿；站点启用时会出现在服务目录。' : '已保存，站点不再出现在服务目录中。')
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  return <article className="content-card my-site-card"><div className="card-heading"><h3>{site.name}</h3><span className="admin-badge approved">审核通过</span></div><a href={site.website} target="_blank" rel="noopener noreferrer">{site.website}</a><p>{site.description}</p><dl><div><dt>成立时间</dt><dd>{site.foundedAt ? String(site.foundedAt).slice(0, 10) : '未提供'}</dd></div><div><dt>支持模型</dt><dd>{site.models}</dd></div></dl>{site.review_note && <p>审核说明：{site.review_note}</p>}{!site.active && <p className="notice">管理员尚未启用或已停用此站点，当前不会在目录展示。</p>}<label className="checkbox"><input type="checkbox" checked={listed} disabled={busy} onChange={event => { setListed(event.target.checked); setMessage('') }} /><span>是否出现在收录列表中（同意公开展示站点基本信息）</span></label><button className="button button-small" disabled={busy || listed === saved} onClick={save}>{busy ? '保存中…' : '保存展示设置'}</button>{message && <p role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<SiteLogoSettings endpoint={`/api/user/sites/${site.id}/logo`} /><details className="site-pricing-details"><summary>分组与报价</summary><SitePricing siteId={site.id} /></details></article>
}

function MySites() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/user/sites', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '站点加载失败')
      setSites(result.sites)
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setLoading(false) }
  }, [])
  // oxlint-disable-next-line react/set-state-in-effect -- synchronize site data with the API on mount
  useEffect(() => { void load() }, [load])
  const approved = sites.filter(site => site.status === 'approved')
  const requests = sites.filter(site => site.status !== 'approved')
  return <div><div className="admin-heading"><div><h2>我的站点</h2><p>审核通过的站点将在这里展示，公开收录由你自主决定。</p></div><button className="button button-ghost" onClick={load} disabled={loading}><RefreshCw size={16} />刷新</button></div>{error && <p className="form-error" role="alert">{error}</p>}{loading ? <p role="status">正在加载站点…</p> : <><div className="my-sites-grid">{approved.map(site => <MySiteCard key={`${site.id}-${site.directoryListed}`} site={site} />)}</div>{!approved.length && <div className="empty-state"><h3>暂无审核通过的站点</h3><p>提交站点资料后，请等待管理员审核。</p><Link className="button" to="/site-management">提交站点收录</Link></div>}{requests.length > 0 && <article className="content-card"><h3>提交进度</h3>{requests.map(site => <div className="site-request" key={site.id}><strong>{site.name}</strong><span className={`admin-badge ${site.status}`}>{site.status === 'pending' ? '待审核' : '已驳回'}</span>{site.review_note && <p>审核说明：{site.review_note}</p>}</div>)}</article>}</>}</div>
}

function TestPlaceholder({ type }: { type: 'model' | 'latency' }) {
  return <article className="content-card test-placeholder"><Clock3 size={32} /><span className="test-placeholder-badge">暂未开放</span><h2>{type === 'model' ? '模型真伪测试' : '延迟与可用性测试'}</h2><p>{type === 'model' ? '后续将接入模型身份检测项目，对指定站点、分组与模型生成检测报告。' : '后续将接入延迟与可用性检测项目，展示响应延迟、成功率及测试条件。'}</p><p>当前不接收 KEY、不发起检测，也不产生调用费用。检测与站点收录、价格维护相互独立。</p><Link className="button button-ghost" to="/site-management/sites">返回我的站点</Link></article>
}

export default function SiteManagement() {
  return <section className="container site-management-page">
    <aside className="site-management-sidebar">
      <div className="site-management-brand"><ServerCog size={24} /><div><h1>站点管理</h1><span>SITE MANAGEMENT</span></div></div>
      <nav aria-label="站点管理"><NavLink end to="/site-management"><FileCheck2 size={18} />站点收录</NavLink><NavLink to="/site-management/sites"><Globe2 size={18} />我的站点</NavLink><NavLink to="/site-management/model-test"><ScanSearch size={18} /><span>模型真伪测试<small>暂未开放</small></span></NavLink><NavLink to="/site-management/latency-test"><Activity size={18} /><span>延迟与可用性测试<small>暂未开放</small></span></NavLink></nav>
    </aside>
    <div className="site-management-content"><Routes><Route index element={<SiteSubmission />} /><Route path="sites" element={<MySites />} /><Route path="model-test" element={<TestPlaceholder type="model" />} /><Route path="latency-test" element={<TestPlaceholder type="latency" />} /><Route path="*" element={<p>页面不存在，请通过左侧菜单访问。</p>} /></Routes></div>
  </section>
}
