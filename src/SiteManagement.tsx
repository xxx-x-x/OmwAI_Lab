import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { pricingFamilies, pricingFamilyLabel } from './pricingFamilies'
import { ModelBrandIcon } from './ModelBrandIcon'
import MySites from './MySites'
import SitePricingPage from './SitePricingPage'
import { ArrowRight, CheckCircle2, FileCheck2, Globe2, ServerCog, ScanSearch, Activity, Clock3 } from 'lucide-react'

const billingTypes = ['按量计费', '按次计费', '包月订阅', '混合计费', '其他']


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
    const fields = { ...Object.fromEntries(form), models: selectedModels.map(pricingFamilyLabel).join('、'), invoice: form.get('invoice') === 'true', informationValid: form.has('informationValid') }
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
  return <form className="submit-form site-submission" onSubmit={submit}>
    <header className="submission-heading"><div><h2>提交站点收录</h2><p>完善站点公开资料，经审核后加入服务目录。无需提供账户、分组或 KEY。</p></div><span>带 * 为必填项</span></header>
    <section className="submission-section" aria-labelledby="submission-basic"><div className="submission-section-heading"><h3 id="submission-basic"><span>01</span>基本信息</h3><p>填写可公开核验的站点资料</p></div><div className="form-grid submission-basic-grid">
      <label>站点名称 *<input name="name" required maxLength={255} placeholder="例如：Example AI" /></label>
      <label>成立时间 *<input name="foundedAt" type="date" required max={today} /></label>
      <label className="full">站点 URL *<input name="website" type="url" required maxLength={2048} placeholder="https://example.com" /></label>
      <label className="full">网站介绍 *<textarea name="description" required rows={3} maxLength={10000} placeholder="介绍站点的服务内容、主要特点及适用场景" /></label>
    </div></section>
    <section className="submission-section" aria-labelledby="submission-billing"><div className="submission-section-heading"><h3 id="submission-billing"><span>02</span>计费与发票</h3><p>将在服务目录中公开展示</p></div><div className="form-grid submission-billing-grid">
      <label>计费方式 *<select name="billingType" required defaultValue=""><option value="" disabled>请选择计费类型</option>{billingTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>是否支持发票 *<select name="invoice" required defaultValue=""><option value="" disabled>请选择发票支持情况</option><option value="true">支持发票</option><option value="false">不支持发票</option></select></label>
      <label className="full">计费补充说明（选填）<textarea name="billingDetails" rows={2} maxLength={1000} placeholder="例如：按官方价格 × 分组倍率，或填写订阅规则" /></label>
    </div></section>
    <section className="submission-section" aria-labelledby="submission-models"><div className="submission-section-heading"><h3 id="submission-models"><span>03</span>模型覆盖 *</h3><p>选择支持的厂商 · 已选择 {selectedModels.length} 项</p></div><div className="form-grid"><div className="full model-creator-options">{creators.map(creator => <label key={creator}><input type="checkbox" checked={selectedModels.includes(creator)} onChange={event => setSelectedModels(previous => event.target.checked ? [...previous, creator] : previous.filter(value => value !== creator))} /><ModelBrandIcon brand={creator} size={23} /><span>{pricingFamilyLabel(creator)}</span></label>)}</div></div>{creatorError && <p className="form-error" role="alert">{creatorError}</p>}</section>
    <section className="submission-section" aria-labelledby="submission-notes"><div className="submission-section-heading"><h3 id="submission-notes"><span>04</span>补充说明</h3><p>选填，仅填写可公开的信息</p></div><div className="form-grid"><label className="full">公开补充说明<textarea name="notes" rows={2} maxLength={5000} placeholder="其他需要说明的公开信息，请勿填写账户或 KEY" /></label></div></section>
    <footer className="submission-footer"><label className="submission-confirmation"><input name="informationValid" type="checkbox" required /><span><strong>我确认站点信息真实有效，且有权代表该站点提交收录。</strong><small>审核不代表服务背书；审核通过后，可在“我的站点”选择是否公开展示。</small></span></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="submission-actions"><span>提交后由管理员审核，请耐心等待。</span><button className="button submit-button" disabled={busy}>{busy ? '提交中…' : <>提交审核 <ArrowRight size={18} /></>}</button></div></footer>
  </form>
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
    <div className="site-management-content"><Routes><Route index element={<SiteSubmission />} /><Route path="sites" element={<MySites />} /><Route path="sites/:siteId/pricing" element={<SitePricingPage />} /><Route path="model-test" element={<TestPlaceholder type="model" />} /><Route path="latency-test" element={<TestPlaceholder type="latency" />} /><Route path="*" element={<p>页面不存在，请通过左侧菜单访问。</p>} /></Routes></div>
  </section>
}
