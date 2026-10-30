import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BadgeCheck, Check, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Coins, Eye, EyeOff, ExternalLink, FileCheck2, GitBranch, Globe2, LayoutDashboard, LayoutGrid, List, LogOut, Menu, Moon, Sun, RefreshCw, Search, ServerCog, ShieldCheck, Sparkles, Trophy, Users, X, Zap } from 'lucide-react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import ModelPriceDetail from './ModelPriceDetail'
import { usePricingSearch } from './usePricingSearch'
import { modelFilters, type Provider } from './data'
import { ModelBrandIcon } from './ModelBrandIcon'
import ModelLeaderboardPage from './ModelLeaderboard'
import ModelDetector from './ModelDetector'
import AgreementPage from './Agreements'
import { agreements } from './agreementData'
import { Turnstile } from './Turnstile'
import SiteManagement from './SiteManagement'
import AdminSiteRevisions from './AdminSiteRevisions'
import AdminProviders from './AdminProviders'
import AdminModelPrices from './AdminModelPrices'
import AdminOverview from './AdminOverview'
import { trackEvent } from './analytics'
import { AnalyticsTracker } from './AnalyticsTracker'
import { useDirectoryProviders } from './directoryProviders'
import { pricingFamilies, pricingFamilyLabel } from './pricingFamilies'
import { useTheme } from './useTheme'
import './App.css'
import './directoryMonitoring.css'
import { monitoringColor } from './monitoringColors'
import { MfaCodeForm, MfaGate, MfaSettings } from './Mfa'

function ModelCoverage({ models }: { models: string[] }) {
  return <>{models.slice(0, 4).map(model => <span className="provider-model-tag model-logo-only" key={model} title={model} aria-label={model}><ModelBrandIcon brand={model} size={20} /></span>)}{models.length > 4 && <span className="model-overflow" title={models.slice(4).join('、')} aria-label={`另有 ${models.length - 4} 个厂商：${models.slice(4).join('、')}`}>+{models.length - 4}</span>}</>
}

function ListedBadge() {
  return <span className="listed-badge" title="已通过站点收录审核，不代表服务质量担保"><BadgeCheck size={14} aria-hidden="true" />已收录</span>
}

function Logo() {
  return <Link className="logo" to="/" aria-label="OmwAI Lab 首页"><img src="https://download.xx-xzh.xyz/omwai_logo.png" alt="" /><span>OmwAI_<span>Lab</span></span></Link>
}

type AuthUser = { id: number; login: string; name: string | null; avatar_url: string; html_url: string; role: 'user' | 'admin' }
type AdminSection = 'model-prices' | 'overview' | 'submissions' | 'providers' | 'users' | 'logs' | 'site-revisions'
type AdminRow = Record<string, string | number | null>

function Layout() {
  const { theme, toggleTheme } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout>
    const restore = async () => {
      try {
        const response = await fetch('/api/auth/me')
        if (!response.ok) throw new Error('登录服务暂不可用，正在重试…')
        const data = await response.json()
        if (!cancelled) { setUser(data.user ?? null); setAuthError(''); setAuthLoading(false) }
      } catch {
        if (!cancelled) { setAuthError('登录服务暂不可用，正在重试…'); retry = setTimeout(restore, 5000) }
      }
    }
    void restore()
    return () => { cancelled = true; clearTimeout(retry) }
  }, [])
  const logout = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('退出失败')
      setUser(null)
      setAuthError('')
    } catch { setAuthError('退出登录失败，登录服务暂不可用，请稍后重试。') }
  }
  return <div className="app-shell"><AnalyticsTracker />
    <header className="site-header"><div className="container nav-wrap"><Logo /><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="打开导航">{menuOpen ? <X size={22} /> : <Menu size={22} />}</button><nav className={menuOpen ? 'nav open' : 'nav'} onClick={() => setMenuOpen(false)}><NavLink to="/">服务目录</NavLink><NavLink to="/models">模型排行榜</NavLink><NavLink to="/detector">模型检测</NavLink><NavLink to="/pricing">定价</NavLink><NavLink to="/submit">提交收录</NavLink>{user?.role === 'admin' && <NavLink to="/admin">管理后台</NavLink>}<a href="https://github.com/xxx-x-x/OmwAI_Lab" target="_blank" rel="noreferrer">关于项目</a></nav><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'} title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button>{user ? <div className="user-menu"><details className="avatar-dropdown"><summary aria-label="打开账户菜单"><img src={user.avatar_url} alt="" /><span>{user.name || user.login}</span></summary><div className="avatar-dropdown-panel" onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}><Link to="/site-management">站点管理</Link>{user.role === 'admin' && <Link to="/security">安全设置 / MFA</Link>}</div></details><button type="button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={16} /></button></div> : <Link className="button button-small nav-cta" to="/login"><GitBranch size={16} /> 登录</Link>}</div></header>
    {authError && <div className="container" role="alert">{authError}</div>}
    <MfaGate /><main><Routes><Route path="/agreements/:id" element={<AgreementPage />} /><Route path="/security" element={authLoading ? <AuthLoading /> : user?.role === 'admin' ? <MfaSettings /> : <Navigate to="/login" replace />} /><Route path="/" element={<DirectoryPage />} /><Route path="/directory" element={<DirectoryPage />} /><Route path="/models" element={<ModelLeaderboardPage />} /><Route path="/detector" element={<ModelDetector />} /><Route path="/pricing" element={<PricingPage />} /><Route path="/pricing/model" element={<ModelPriceDetail />} /><Route path="/welcome" element={<HomePage />} /><Route path="/provider/:id" element={<DetailPage />} /><Route path="/login" element={<LoginPage user={user} />} /><Route path="/submit" element={authLoading ? <AuthLoading /> : user ? <Navigate to="/site-management" replace /> : <Navigate to="/login?next=/submit" replace />} /><Route path="/site-management/*" element={authLoading ? <AuthLoading /> : user ? <SiteManagement /> : <Navigate to="/login?next=/site-management" replace />} /><Route path="/site-quotes" element={<Navigate to="/site-management/sites" replace />} /><Route path="/admin" element={authLoading ? <AuthLoading /> : user?.role === 'admin' ? <AdminPage /> : <Navigate to={user ? '/' : '/login'} replace />} /><Route path="*" element={<NotFound />} /></Routes></main><Footer />
  </div>
}

function AuthLoading() { return <section className="page-section container"><div className="auth-card"><RefreshCw className="spin" /><p>正在确认登录状态…</p></div></section> }

function GitHubMark() {
  return <svg className="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
}

function GoogleMark() {
  return <svg className="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" /><path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.39 13.86a6.01 6.01 0 0 1 0-3.72V7.52H3.04a10 10 0 0 0 0 8.96l3.35-2.62Z" /><path fill="#EA4335" d="M12 6.01c1.47 0 2.78.5 3.82 1.49l2.88-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" /></svg>
}

function LoginPage({ user }: { user: AuthUser | null }) {
  const [challenge, setChallenge] = useState('')
  const [registering, setRegistering] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => { if (!cooldown) return; const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000); return () => window.clearTimeout(timer) }, [cooldown])
  useEffect(() => { fetch('/api/auth/turnstile-config').then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); setTurnstileSiteKey(result.siteKey) }).catch(() => setError('人机验证加载失败，请稍后刷新页面')) }, [])
  const resetTurnstile = () => { setTurnstileToken(''); setTurnstileResetKey(value => value + 1) }
  const turnstileAction = resetting ? 'reset_password' : registering ? 'register' : 'login'
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleTurnstileError = useCallback(() => setError('人机验证加载失败，请稍后重试'), [])
  const sendCode = async () => {
    setError(''); setMessage('')
    if (!email) { setError('请先填写邮箱地址'); return }
    if (!turnstileToken) { setError('请先完成人机验证'); return }
    setBusy(true)
    try {
      const response = await fetch('/api/auth/email-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, purpose: resetting ? 'reset-password' : 'register', turnstileToken }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { setError(result.error ?? '验证码发送失败'); return }
      setCooldown(Number(result.cooldown) || 60); setMessage('验证码已发送，请检查邮箱和垃圾邮件文件夹，请再次完成人机验证后提交')
    } catch { setError('验证码发送失败，请检查网络后重试') } finally { setBusy(false); resetTurnstile() }
  }
  if (user) return <Navigate to="/submit" replace />
  const submitAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setMessage('')
    if (!registering && !resetting && !acceptedTerms) { setError('请先同意用户协议和隐私条款'); return }
    if (!turnstileToken) { setError('请先完成人机验证'); return }
    setBusy(true)
    const body = { ...Object.fromEntries(new FormData(event.currentTarget)), turnstileToken, ...(!registering && !resetting ? { acceptedTerms } : {}) }
    try {
      const response = await fetch(`/api/auth/${resetting ? 'reset-password' : registering ? 'register' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { resetTurnstile(); setError(result.error ?? '操作失败，请稍后重试'); return }
      if (result.mfaRequired) { setChallenge(result.challenge); return }
      if (resetting) { setResetting(false); setMessage('密码已重置，请使用新密码登录'); return }
      const next = new URLSearchParams(window.location.search).get('next')
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/submit'
    } catch { resetTurnstile(); setError('请求失败，请检查网络后重试') } finally { setBusy(false) }
  }
  if (challenge) return <section className="auth-page"><div className="auth-card"><MfaCodeForm challenge={challenge} onSuccess={() => { const next = new URLSearchParams(window.location.search).get('next'); window.location.href = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/admin' }} onCancel={() => { setChallenge(''); resetTurnstile() }} /></div></section>
  const title = resetting ? '重置密码' : registering ? '注册' : '登录'
  return <section className="auth-page"><div className="auth-backdrop" /><div className="auth-card"><div className="auth-brand"><img src="https://download.xx-xzh.xyz/omwai_logo.png" alt="" /><h1>{title} <strong>OmwAI_Lab</strong></h1></div><form onSubmit={submitAuth}>{registering && <label>用户名<input name="username" required autoComplete="username" placeholder="请输入用户名" minLength={2} maxLength={24} /></label>}<label>{registering || resetting ? '邮箱' : '用户名或邮箱'}<input name={registering || resetting ? 'email' : 'account'} required type={registering || resetting ? 'email' : 'text'} autoComplete={registering || resetting ? 'email' : 'username'} value={registering || resetting ? email : undefined} onChange={registering || resetting ? event => setEmail(event.target.value) : undefined} placeholder={registering || resetting ? '请输入邮箱地址' : '请输入用户名或邮箱地址'} /></label><label>{resetting ? '新密码' : '密码'}<div className="password-field"><input name="password" required type={showPassword ? 'text' : 'password'} autoComplete={registering || resetting ? 'new-password' : 'current-password'} placeholder={registering || resetting ? '至少 8 位，包含字母和数字' : '请输入登录密码'} minLength={8} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>{(registering || resetting) && <label>邮箱验证码<div className="code-field"><input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码" /><button type="button" disabled={busy || cooldown > 0} onClick={sendCode}>{cooldown ? `${cooldown}s` : '发送验证码'}</button></div></label>}{!registering && !resetting && <button className="forgot-link" type="button" onClick={() => { setResetting(true); setError(''); setMessage(''); resetTurnstile() }}>忘记密码？</button>}{!registering && !resetting && <><label className="auth-terms"><input type="checkbox" checked={acceptedTerms} onChange={event => setAcceptedTerms(event.target.checked)} required /><span>我已阅读并同意<Link to="/agreements/terms" target="_blank" rel="noopener noreferrer">《用户协议》</Link>和<Link to="/agreements/privacy" target="_blank" rel="noopener noreferrer">《隐私条款》</Link></span></label></>}{turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} action={turnstileAction} resetKey={turnstileResetKey} onToken={handleTurnstileToken} onError={handleTurnstileError} />}{message && <p className="auth-message" role="status">{message}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" type="submit" disabled={busy}>{busy ? '请稍候…' : <>{title} <ArrowRight size={15} /></>}</button></form><div className="auth-switch">{registering || resetting ? '已有账号？' : '还没有账号？'} <button type="button" disabled={busy} onClick={() => { setRegistering(!registering && !resetting); setResetting(false); setError(''); setMessage(''); resetTurnstile(); setAcceptedTerms(false) }}>{registering || resetting ? '立即登录' : '立即注册'}</button></div>{!registering && !resetting && <><div className="auth-divider"><span>或使用以下方式</span></div><div className="social-login"><a href="/api/auth/github" aria-label="使用 GitHub 登录" title="使用 GitHub 登录"><GitHubMark /></a><a href="/api/auth/google" aria-label="使用 Google 登录" title="使用 Google 登录"><GoogleMark /></a></div></>}</div></section>
}

/* oxlint-disable-next-line no-unused-vars -- retained as the planned marketing landing page */
function HomePage() {
  const { providers, loading, error, reload } = useDirectoryProviders()
  const coveredModels = [...new Set(providers.flatMap(provider => provider.models))]
  const modelCount = coveredModels.length
  return <>
    <section className="hero-section"><div className="hero-glow hero-glow-one" /><div className="hero-glow hero-glow-two" /><div className="container hero-grid"><div className="hero-copy"><div className="eyebrow"><Sparkles size={15} /> 开放、透明的 AI API 服务索引</div><h1>找到适合你的<br /><em>AI API 中转服务</em></h1><p>集中查看模型覆盖、计费方式与服务信息。少一点信息差，多一点确定性。</p><div className="hero-actions"><Link className="button" to="/directory">浏览服务目录 <ArrowRight size={18} /></Link><Link className="button button-ghost" to="/submit">提交你的服务</Link></div><div className="trust-row"><span><CheckCircle2 /> 人工审核</span><span><CheckCircle2 /> 信息可追溯</span><span><CheckCircle2 /> 不参与交易</span></div></div><div className="hero-visual" aria-label="平台数据概览"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="floating-chip chip-one"><Zap size={16} /> 信息持续更新</div><div className="floating-chip chip-two"><ShieldCheck size={16} /> 独立收录</div><div className="dashboard-card"><div className="dashboard-head"><span>服务概览</span><span className="live-dot">持续更新</span></div><div className="dashboard-stat"><strong>{loading ? '—' : providers.length}</strong><span>已收录服务</span></div><div className="mini-chart"><i style={{height:'28%'}} /><i style={{height:'46%'}} /><i style={{height:'40%'}} /><i style={{height:'69%'}} /><i style={{height:'62%'}} /><i style={{height:'88%'}} /><i style={{height:'78%'}} /></div><div className="dashboard-models">{coveredModels.map((m, i) => <span key={m}><b className={`model-dot dot-${i}`} />{m}</span>)}</div></div></div></div></section>
    <section className="metrics-section"><div className="container metrics-grid"><div><strong>{loading ? '—' : providers.length}</strong><span>已收录服务</span></div><div><strong>{modelCount}</strong><span>模型厂商覆盖</span></div><div><strong>100%</strong><span>免费公开访问</span></div><div><strong>持续</strong><span>信息维护更新</span></div></div></section>
    <section className="section container"><div className="section-heading split-heading"><div><span className="kicker">精选服务</span><h2>值得关注的 API 服务</h2><p>根据公开信息整理，帮助快速了解各服务的主要特点。</p></div><Link className="text-link" to="/directory">查看全部服务 <ArrowRight size={17} /></Link></div>{error && <p className="form-error" role="alert">{error} <button className="button button-small" onClick={reload}>重试</button></p>}{loading ? <AuthLoading /> : <div className="provider-grid">{providers.slice(0, 3).map(provider => <ProviderCard provider={provider} key={provider.id} />)}</div>}{!loading && !error && !providers.length && <p>暂无公开收录站点。</p>}</section>
    <section className="why-section"><div className="container section"><div className="section-heading center"><span className="kicker">为什么选择我们</span><h2>用更透明的信息，做更安心的选择</h2><p>我们只做信息索引，不销售服务，也不参与服务商之间的交易。</p></div><div className="feature-grid"><Feature icon={<ShieldCheck />} title="人工审核收录" text="提交内容经过人工检查，优先保留可核验的官网、价格和服务条款。" /><Feature icon={<CircleDollarSign />} title="计费信息清晰" text="统一整理倍率、计价单位和适用分组，减少复杂规则带来的理解成本。" /><Feature icon={<Clock3 />} title="持续维护更新" text="定期复核服务链接与公开信息，对失效或无法核实的内容及时标记。" /></div></div></section>
    <section className="container cta-section"><div><span className="kicker light">共同完善索引</span><h2>运营 AI API 服务？</h2><p>提交你的服务信息，经审核后将免费展示在目录中。</p></div><Link className="button button-white" to="/submit">立即提交 <ArrowRight size={18} /></Link></section>
  </>
}

function Feature({icon, title, text}: {icon: React.ReactNode; title: string; text: string}) { return <article className="feature-card"><div className="feature-icon">{icon}</div><h3>{title}</h3><p>{text}</p></article> }

function ProviderLogo({ provider, className = '' }: { provider: Provider; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return <div className={`provider-logo ${className}`} style={{background: provider.color}}>{provider.logoUrl && failedUrl !== provider.logoUrl ? <img src={provider.logoUrl} alt={`${provider.name} Logo`} loading="lazy" onError={() => setFailedUrl(provider.logoUrl)} /> : provider.initials}</div>
}

function MonitoringStatus({ provider }: { provider: Provider }) {
  const status = provider.monitoring?.status ?? 'unknown'
  const label = status === 'up' ? '最新探测正常' : status === 'down' ? '最新探测异常' : '暂无有效最新探测'
  const history = provider.monitoring?.history ?? Array.from({ length: 24 }, () => ({ time: '', status: 'unknown' as const, samples: 0, uptime: null, complete: false }))
  return <span className={`directory-monitor-history monitor-${status}`} role="img" title="每小时探测成功率：绿 100% · 浅绿 ≥95% · 橙 ≥50% · 红 <50% · 灰 无数据或覆盖不足；文字表示最新探测状态" aria-label={`最新状态${label}，近 24 小时成功率历史，上下两行，每行从左到右，先上后下由旧到新`}><span className="directory-monitor-history-label">{label}</span><span className="directory-monitor-history-bars">{history.map((period, index) => <span key={period.time || index} className={`directory-monitor-history-bar is-${monitoringColor(period.uptime, period.complete)}`} title={`${period.time ? new Date(period.time).toLocaleString('zh-CN') : '暂无采样'} · ${period.uptime == null ? '成功率未知' : `成功率 ${period.uptime.toFixed(2)}%`} · ${period.samples} 条采样${period.complete ? '' : ' · 覆盖不足'}`} />)}</span></span>
}

function ProviderCard({ provider }: { provider: Provider }) {
  const monitoring = provider.monitoring
  return <Link className="provider-card directory-provider-card" to={`/provider/${provider.id}`} aria-label={`查看 ${provider.name} 详情`}>
    <div className="compact-card-header"><ProviderLogo provider={provider} /><h3 title={provider.name}>{provider.name}</h3>{provider.verified && <BadgeCheck size={15} className="compact-card-verified" aria-label="已核验收录" />}<ChevronRight size={15} className="compact-card-arrow" /></div>
    <div className="compact-card-models"><ModelCoverage models={provider.models} /></div>
    <div className="compact-card-monitoring" title={`近24小时 · ${monitoring?.samples ?? 0}条有效采样 · ${monitoring?.monitors ?? 0}个有效监控 · 最近探测：${monitoring?.checkedAt ? new Date(monitoring.checkedAt).toLocaleString('zh-CN') : '暂无数据'}`}>
      <div className="compact-card-metrics"><div title="近24小时有效探测成功率，非SLA"><span>在线率</span><strong>{monitoring?.uptime == null ? '—' : provider.availability}</strong></div><div title="成功请求的平均完整响应耗时，非首字延迟"><span>延迟</span><strong>{provider.responseTime == null ? '—' : `${provider.responseTime} ms`}</strong></div></div><MonitoringStatus provider={provider} />
    </div>
    <div className="compact-card-footer"><span title={`${provider.price}；参考倍率：${provider.rate}；${provider.billingDetails || ''}`}>{provider.billing}</span><span title="发票支持情况">{provider.invoice == null ? '发票未知' : provider.invoice ? '可开发票' : '无发票'}</span></div>
  </Link>
}

function DirectoryPage() {
  const { providers, loading, error, reload } = useDirectoryProviders()
  const [query, setQuery] = useState(''); const [model, setModel] = useState('全部'); const [view, setView] = useState<'ranking' | 'cards'>('ranking')
  const filtered = useMemo(() => providers.filter(p => (model === '全部' || p.models.includes(model)) && `${p.name}${p.tagline}${p.models.join('')}`.toLowerCase().includes(query.toLowerCase())), [query, model, providers])
  const ranked = useMemo(() => [...filtered].sort((a, b) => (b.monitoring?.uptime ?? -1) - (a.monitoring?.uptime ?? -1) || (a.responseTime ?? Infinity) - (b.responseTime ?? Infinity)), [filtered])
  return <section className="page-section container"><div className="page-heading"><span className="kicker">服务目录</span><h1>发现 AI API 服务</h1><p>基于公开、可核验的信息筛选合适的服务商。</p></div>{error && <p className="form-error" role="alert">{error} <button className="button button-small" onClick={reload}>重试</button></p>}<div className="directory-toolbar"><label className="search-box"><Search size={20} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索服务名称或支持模型" /></label><div className="directory-actions"><span>{filtered.length} 个结果</span><div className="view-switch" aria-label="切换目录视图"><button className={view === 'ranking' ? 'active' : ''} onClick={() => setView('ranking')} title="排行榜模式"><List size={16} />排行榜</button><button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} title="卡片模式"><LayoutGrid size={16} />卡片</button></div></div></div><div className="filter-row">{modelFilters.map(item => <button className={model === item ? 'active' : ''} onClick={() => setModel(item)} key={item}>{item}</button>)}</div>{loading ? <AuthLoading /> : error ? null : filtered.length ? view === 'cards' ? <div className="provider-grid directory-grid">{filtered.map(provider => <ProviderCard provider={provider} key={provider.id} />)}</div> : <RankingList providers={ranked} /> : <div className="empty-state"><Search /><h3>{providers.length ? '没有找到匹配服务' : '暂无公开收录站点'}</h3><p>{providers.length ? '尝试更换关键词或模型筛选条件。' : '站点审核通过、启用并同意公开后将在这里展示。'}</p></div>}</section>
}

type ModelPrice = { modelId: string; capabilities: { label: string; description: string }[]; modality: 'text' | 'image' | 'video'; billingUnit: string; pricingDetails: string; priceCheckedAt?: string; id: string; name: string; company: string; family: string; providerIconUrl: string; releaseDate: string | null; priceSource: string; inputPrice: number | null; outputPrice: number | null; cacheReadPrice: number | null; reasoning: number; openWeights: number; sourceUrl: string }
type ModelPricesResponse = { models: ModelPrice[]; latest: { syncedAt: string; sourceUrl: string; providerCount: number } | null }

function PricingPage() {
  const [pricing, setPricing] = useState<ModelPricesResponse>({ models: [], latest: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { params, query, updateQuery, updateFilter } = usePricingSearch()
  const location = useLocation()
  const family = params.get('family') ?? '全部模型'
  const loadPrices = useCallback(() => {
    setLoading(true)
    setError('')
    fetch('/api/model-prices')
      .then(async response => { if (!response.ok) throw new Error('模型定价加载失败'); return response.json() as Promise<ModelPricesResponse> })
      .then(setPricing)
      .catch(error => setError(error instanceof Error ? error.message : '模型定价加载失败'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadPrices() }, [loadPrices])
  useEffect(() => { const scrollY = (location.state as { scrollY?: number } | null)?.scrollY; if (!loading && scrollY != null) window.scrollTo(0, scrollY) }, [loading, location.state])
  const priceFamilies = useMemo(() => ['全部模型', ...pricingFamilies(pricing.models)], [pricing.models])
  const filtered = useMemo(() => pricing.models.filter(model => (family === '全部模型' || model.family === family) && `${model.modelId}${model.name}${model.company}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.company.localeCompare(b.company, 'zh-CN') || a.name.localeCompare(b.name)), [family, pricing.models, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / 30))
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1))
  const visiblePrices = filtered.slice((page - 1) * 30, page * 30)
  const money = (value: number | null) => value == null ? '—' : `$${Number(value.toFixed(4))}`
  return <section className="pricing-page"><div className="container pricing-heading"><div><span className="kicker">BaseLLM 定价</span><h1>模型定价</h1></div><div className="pricing-summary"><Coins /><span><strong>{pricing.models.length}</strong> 个模型</span><span><strong>{priceFamilies.length - 1}</strong> 家厂商</span></div></div><div className="container pricing-toolbar"><label className="search-box"><Search size={19} /><input value={query} onChange={event => updateQuery(event.target.value)} placeholder="搜索模型ID或厂商" /></label><div className="pricing-filters">{priceFamilies.map(item => <button key={item} type="button" className={family === item ? 'active' : ''} onClick={() => updateFilter('family', item)}>{item !== '全部模型' && <ModelBrandIcon brand={item} size={18} />}{pricingFamilyLabel(item)}</button>)}</div></div><div className="container price-table-wrap"><div className="price-table-meta"><span>共找到 <strong>{filtered.length}</strong> 个模型 · 按发布时间从新到旧排序</span><small>{pricing.latest ? `BaseLLM 同步于 ${new Date(pricing.latest.syncedAt).toLocaleString('zh-CN')}` : '价格来自公开数据，请以厂商最新账单为准'}</small></div><div className="price-table-scroll"><table className="price-table"><thead><tr><th>排名</th><th>模型ID</th><th>厂商</th><th>模型能力</th><th>输入价格 / 单位</th><th>输出价格 / 单位</th><th>缓存读取价格 / 单位</th><th>发布时间</th></tr></thead><tbody>{visiblePrices.map((model, index) => <tr key={model.id}><td><b>{(page - 1) * 30 + index + 1}</b></td><td><div className="price-model"><i><ModelBrandIcon brand={model.family} model={model.name} size={22} /></i><Link className="price-model-link" to={`/pricing/model?id=${encodeURIComponent(model.id)}`} state={{ returnTo: `/pricing${params.toString() ? `?${params}` : ''}`, scrollY: window.scrollY }} aria-label={`查看 ${model.modelId} 详情`}>{model.modelId} <ChevronRight size={15} /></Link></div></td><td><div className="price-company"><ModelBrandIcon brand={model.company} size={20} /><span className="price-company-name">{model.company}</span></div></td><td><div className="price-tags">{model.capabilities.length ? model.capabilities.slice(0, 2).map(capability => <span key={capability.label} title={capability.description}>{capability.label}</span>) : <span>未说明</span>}</div></td><td><b>{money(model.inputPrice)}</b>{model.inputPrice != null && <small className="price-unit"> / {model.billingUnit}</small>}</td><td><b>{money(model.outputPrice)}</b><small className="price-unit"> / {model.billingUnit}</small></td><td><b>{money(model.cacheReadPrice)}</b>{model.cacheReadPrice != null && <small className="price-unit"> / {model.billingUnit}</small>}</td><td>{model.releaseDate ? <time dateTime={model.releaseDate}>{model.releaseDate}</time> : '—'}</td></tr>)}</tbody></table>{loading && <div className="price-empty"><RefreshCw className="spin" /><strong>正在加载 BaseLLM 模型定价…</strong></div>}{!loading && !filtered.length && <div className="price-empty"><Search /><strong>{error || '没有找到匹配模型'}</strong><span>{error ? '模型定价暂时无法读取，请稍后重试。' : '请尝试其他关键词或厂商筛选。'}</span>{error && <button className="inline-retry" type="button" onClick={loadPrices}><RefreshCw size={14} />重新加载</button>}</div>}</div></div><div className="container pricing-pagination" aria-label="定价列表分页"><button className="button button-ghost" disabled={page <= 1} onClick={() => updateFilter('page', String(page - 1))}>上一页</button><span>第 {page} / {pageCount} 页 · 每页 30 条</span><button className="button button-ghost" disabled={page >= pageCount} onClick={() => updateFilter('page', String(page + 1))}>下一页</button></div><div className="container pricing-note"><ShieldCheck /><div><strong>价格说明</strong><p>报价统一读取本站数据库，由管理员手动添加或修正，也可独立同步自 <a href="https://basellm.github.io/llm-metadata/" target="_blank" rel="noreferrer">BaseLLM LLM Metadata</a>；GPT-6.1 Terra 报价补充自 <a href="https://developers.openai.com/api/docs/models/gpt-6.1-terra" target="_blank" rel="noreferrer">OpenAI 官方模型文档</a>；Seedream、Seedance 报价补充自<a href="https://docs.volcengine.com/docs/ark/model-pricing?lang=zh" target="_blank" rel="noreferrer">火山引擎官方价格页</a>，核对日期为 2026-10-27，排行榜同步不影响定价目录；新增定价型号由管理员独立维护，缺失报价不补零。图片按张计费；视频按百万视频 Tokens 计费，不能与文本 Tokens 或每秒视频价格混同。火山引擎按固定汇率 1 USD = 6.67 CNY 将人民币原价折算为美元，并非官方美元报价。同厂商日期版本按规则合并展示，推理档位保留区别；发布时间取自模型元数据的发布字段，非价格核对或同步时间；缺少报价或发布时间时显示“—”。价格和版本可能随时变化，未包含批处理、长上下文阶梯价和区域税费。</p></div></div></section>
}

function RankingList({ providers: rankedProviders }: { providers: Provider[] }) {
  return <div className="ranking-wrap"><div className="ranking-caption"><span><Trophy size={16} /> 收录站点</span><small>{rankedProviders.some(provider => provider.responseTime != null || Number.isFinite(Number.parseFloat(provider.availability))) ? '按近 24h 采样在线率及成功请求平均耗时排序（非 SLA）' : '暂无有效监控采样，序号不代表服务质量排名'}</small></div><div className="ranking-table"><div className="ranking-head"><span>排名 / 服务</span><span>模型覆盖</span><span>认证</span><span>发票</span><span>平均在线率</span><span>平均延迟</span><span>计费方式</span><span>运行状态</span></div>{rankedProviders.map((provider, index) => <Link className="ranking-row" to={`/provider/${provider.id}`} aria-label={`查看 ${provider.name} 详情`} key={provider.id}><div className="rank-provider"><b className={`rank-number rank-${index + 1}`}>{index + 1}</b><ProviderLogo provider={provider} className="ranking-logo" /><div><strong>{provider.name}</strong><div className="provider-listing"><ListedBadge /></div></div></div><div className="ranking-models"><ModelCoverage models={provider.models} /></div><div>{provider.verified ? <span className="verified"><BadgeCheck /> 已核验</span> : <span className="unverified">待补充</span>}</div><span className={`invoice-status ${provider.invoice == null ? 'unknown' : provider.invoice ? 'supported' : 'unsupported'}`} aria-label={provider.invoice == null ? '发票信息未提供' : provider.invoice ? '支持开发票' : '不支持开发票'}>{provider.invoice == null ? '未提供' : provider.invoice ? <><Check /> 支持</> : <><X /> 不支持</>}</span><strong className="availability">{provider.availability}</strong><span>{provider.responseTime == null ? '暂无数据' : `${provider.responseTime} ms`}</span><div className="ranking-price"><strong>{provider.billing}</strong>{provider.billingDetails && <small>{provider.billingDetails}</small>}</div><MonitoringStatus provider={provider} /></Link>)}</div></div>
}

function ExternalWebsiteLink({ provider, className, children, onRequestVisit }: { provider: Provider; className: string; children: React.ReactNode; onRequestVisit: () => void }) {
  if (provider.website === '#') return <span className={`${className} disabled`}>{children}</span>
  return <a className={className} href={provider.website} onClick={event => { event.preventDefault(); onRequestVisit() }}>{children}</a>
}

type DetectedGroup = { name: string; ratio: number; type: string; description: string; modelCount: number }
type GroupProbeResult = { groups: DetectedGroup[]; detectedAt: string | null; source: string | null }

function ProviderGroups({ provider }: { provider: Provider }) {
  const [result, setResult] = useState<GroupProbeResult | null>(null)
  const [error, setError] = useState('')
  const canProbe = provider.website !== '#'
  const [loading, setLoading] = useState(canProbe)
  const [sort, setSort] = useState<{ field: 'name' | 'ratio'; direction: 'asc' | 'desc' }>({ field: 'name', direction: 'asc' })
  const changeSort = (field: 'name' | 'ratio') => setSort(current => current.field === field ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'asc' })
  const sortedGroups = useMemo(() => result ? [...result.groups].sort((a, b) => {
    const comparison = sort.field === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : a.ratio - b.ratio || a.name.localeCompare(b.name, 'zh-CN')
    return sort.direction === 'asc' ? comparison : -comparison
  }) : [], [result, sort])

  useEffect(() => {
    if (!canProbe) return
    const controller = new AbortController()
    fetch(`/api/probe/groups?site=${encodeURIComponent(provider.website)}`, { signal: controller.signal })
      .then(async response => {
        const text = await response.text()
        let body: GroupProbeResult & { error?: string }
        try {
          body = JSON.parse(text) as GroupProbeResult & { error?: string }
        } catch {
          throw new Error(response.ok ? '分组数据格式无效' : `分组数据读取失败（HTTP ${response.status}）`)
        }
        if (!response.ok) throw new Error(body.error || '分组数据读取失败')
        return body
      })
      .then(setResult)
      .catch(reason => { if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [canProbe, provider.website])

  return <article className="content-card group-card"><div className="card-heading"><div><h2>站点分组</h2><p>由服务端每日采集并保存，访问本页仅读取数据库。</p></div></div>
    {!canProbe && <div className="probe-state">该站点没有可探测的官网地址。</div>}
    {loading && <div className="probe-state"><RefreshCw className="spinning" /> 正在读取已保存的分组信息…</div>}
    {error && !loading && <div className="probe-state probe-unavailable">{error}</div>}
    {result && !loading && <><div className="group-summary"><strong>{result.groups.length}</strong><span>个公开分组</span><small>{result.detectedAt ? `采集于 ${new Date(result.detectedAt).toLocaleString('zh-CN')}` : '暂无采集数据，等待服务端定时更新'}</small></div><div className="group-table"><div className="group-head"><button type="button" className={sort.field === 'name' ? 'active' : ''} onClick={() => changeSort('name')}>分组名称 {sort.field === 'name' && (sort.direction === 'asc' ? <ArrowUp /> : <ArrowDown />)}</button><span>类型</span><button type="button" className={sort.field === 'ratio' ? 'active' : ''} onClick={() => changeSort('ratio')}>倍率 {sort.field === 'ratio' && (sort.direction === 'asc' ? <ArrowUp /> : <ArrowDown />)}</button><span>可用模型</span><span>说明</span></div>{sortedGroups.map(group => <div className="group-row" key={group.name}><strong>{group.name}</strong><span className="group-type">{group.type}</span><b>{group.ratio}×</b><span>{group.modelCount ? `${group.modelCount} 个` : '未公开'}</span><span title={group.description}>{group.description || '—'}</span></div>)}</div><p className="probe-source">数据源：服务商公开计价接口的数据库快照。分组随站点配置变化，请以实际调用为准。</p></>}
  </article>
}

function DetailPage() {
  const { id } = useParams(); const { providers, loading, error, reload } = useDirectoryProviders(); const [showExitNotice, setShowExitNotice] = useState(false); const provider = providers.find(item => item.id === id); if (!provider) return loading ? <AuthLoading /> : error ? <section className="page-section container"><p role="alert">{error}</p><button className="button" onClick={reload}>重试</button></section> : <NotFound />
  const requestVisit = () => { trackEvent('outbound_intent', location.pathname, provider.id); setShowExitNotice(true) }
  return <section className="page-section container detail-page"><Link className="back-link" to="/directory"><ArrowLeft size={17} /> 返回服务目录</Link><div className="detail-hero"><ProviderLogo provider={provider} className="detail-logo" /><div className="detail-main"><div className="provider-title"><h1><ExternalWebsiteLink provider={provider} className="detail-site-link" onRequestVisit={requestVisit}>{provider.name} <ExternalLink size={17} /></ExternalWebsiteLink></h1>{provider.verified && <BadgeCheck />}</div><div className="provider-listing"><ListedBadge /></div><div className="tag-list">{provider.models.map(m => <span className="provider-model-tag" key={m}><ModelBrandIcon brand={m} size={16} />{m}</span>)}</div></div><ExternalWebsiteLink provider={provider} className="button" onRequestVisit={requestVisit}>访问官网 <ExternalLink size={17} /></ExternalWebsiteLink></div><div className="detail-layout"><div><article className="content-card"><h2>服务简介</h2><p>{provider.description}</p><h3>主要特点</h3><ul className="highlight-list">{provider.highlights.map(h => <li key={h}><CheckCircle2 />{h}</li>)}</ul></article><ProviderGroups key={provider.website} provider={provider} /><article className="content-card"><h2>公开计费信息</h2><div className="price-table"><div><span>计费方式</span><strong>{provider.price}</strong></div><div><span>参考倍率</span><strong>{provider.rate}</strong></div><div><span>结算类型</span><strong>{provider.billing}</strong></div></div><p className="notice">价格与服务状态可能随时变化，付款前请以服务商官网当时公布的信息为准。</p></article></div><aside className="side-card"><h3>实际监控 · 近 24 小时</h3><div className="big-status"><MonitoringStatus provider={provider} /></div><dl><div><dt>成功请求平均耗时</dt><dd>{provider.responseTime == null ? '暂无数据' : `${provider.responseTime} ms`}</dd></div><div><dt>采样在线率</dt><dd>{provider.availability}</dd></div><div><dt>信息更新</dt><dd>{provider.updatedAt}</dd></div><div><dt>有效采样</dt><dd>{provider.monitoring?.samples ?? 0} 条 / {provider.monitoring?.monitors ?? 0} 个监控</dd></div><div><dt>最近探测</dt><dd>{provider.monitoring?.checkedAt ? new Date(provider.monitoring.checkedAt).toLocaleString('zh-CN') : '暂无数据'}</dd></div><div><dt>信息核验</dt><dd>{provider.verified ? '已核验' : '待补充'}</dd></div></dl><p className="notice">仅统计已绑定本站的启用监控。在线率为近 24 小时成功/成功及失败采样，耗时为成功请求完整响应耗时，并非首字延迟或 SLA。暂停、过期、待定或读取失败显示未知；未监控模型和分组不在覆盖范围内。</p></aside></div>{showExitNotice && <div className="exit-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowExitNotice(false) }}><div className="exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title"><div className="exit-icon"><ExternalLink /></div><h2 id="exit-title">即将访问外部网站</h2><p>即将跳转至 <strong>{provider.name}</strong> 的官方网站：</p><div className="exit-url">{provider.website}</div><p className="exit-warning">OmwAI Lab 仅提供信息收录与索引，不对该网站的真实性、安全性、服务质量或交易结果作任何担保。请自行核验网站真伪并注意账户、密钥及资金安全。</p><div className="exit-actions"><button className="button button-ghost" type="button" onClick={() => setShowExitNotice(false)}>取消</button><a className="button" href={provider.website} target="_blank" rel="noopener noreferrer" onClick={() => { trackEvent('outbound_click', location.pathname, provider.id); setShowExitNotice(false) }}>确认并继续 <ExternalLink size={16} /></a></div></div></div>}</section>
}

function AdminPage() {
  const [section, setSection] = useState<AdminSection>('overview')
  const [providerEditing, setProviderEditing] = useState(false)
  const [revisionRefresh, setRevisionRefresh] = useState(0)
  const isSiteReview = section === 'submissions' || section === 'site-revisions'
  const [data, setData] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncingRankings, setSyncingRankings] = useState(false)
  const [rankingSyncMessage, setRankingSyncMessage] = useState('')
  const [pendingAction, setPendingAction] = useState<{ title: string; description: string; confirmLabel: string; run: () => Promise<void> } | null>(null)
  const endpoint = section === 'site-revisions' ? 'dashboard' : section === 'overview' ? 'dashboard' : section === 'logs' ? 'audit-logs' : section
  const load = useCallback(async () => {
    if (section === 'overview' || section === 'model-prices' || section === 'site-revisions') { setLoading(false); setError(''); return }
    setLoading(true); setError('')
    const response = await fetch(`/api/admin/${endpoint}`); const result = await response.json().catch(() => ({})); setLoading(false)
    if (!response.ok) { setError(result.error ?? '加载失败'); return }
    setData(result)
  }, [endpoint, section])
  // oxlint-disable-next-line react/set-state-in-effect -- data is loaded when the selected admin section changes
  useEffect(() => { void load() }, [load])
  const mutate = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(`/api/admin/${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) { setError(result.error ?? '操作失败'); return }
    await load()
  }
  const syncRankings = async () => {
    setSyncingRankings(true); setRankingSyncMessage(''); setError('')
    const response = await fetch('/api/admin/model-rankings/sync', { method: 'POST' })
    const result = await response.json().catch(() => ({})); setSyncingRankings(false)
    if (!response.ok) { setError(result.error ?? '排行榜同步失败'); return }
    setRankingSyncMessage(`已同步 ${result.count} 个模型，公开页面现在从本地数据库读取。`)
  }
  const confirmAction = (title: string, description: string, confirmLabel: string, run: () => Promise<void>) => setPendingAction({ title, description, confirmLabel, run })
  const executePendingAction = async () => {
    if (!pendingAction) return
    const action = pendingAction
    setPendingAction(null)
    await action.run()
  }
  const submissions = (data.submissions ?? []) as AdminRow[]
  const managedProviders = (data.providers ?? []) as AdminRow[]
  const users = (data.users ?? []) as AdminRow[]
  const logs = (data.logs ?? []) as AdminRow[]
  const items: Array<[AdminSection, string, React.ReactNode]> = [['overview', '数据概览', <LayoutDashboard key="overview" />], ['model-prices', '模型价格管理', <FileCheck2 key="model-prices" />], ['submissions', '站点审核', <FileCheck2 key="submissions" />], ['providers', '站点管理', <Globe2 key="providers" />], ['users', '用户管理', <Users key="users" />], ['logs', '操作日志', <Activity key="logs" />]]
  return <section className="admin-page container"><aside className="admin-sidebar"><div><ShieldCheck /><span><strong>管理后台</strong><small>OmwAI Lab</small></span></div>{items.map(([key, label, icon]) => <button key={key} className={(section === key || (key === 'submissions' && isSiteReview)) ? 'active' : ''} disabled={providerEditing} onClick={() => setSection(key)}>{icon}{label}</button>)}</aside><div className="admin-content"><div className="admin-heading"><div><span className="kicker">ADMIN CONSOLE</span><h1>{isSiteReview ? '站点审核' : items.find(item => item[0] === section)?.[1]}</h1></div>{section !== 'model-prices' && <button className="button button-ghost" disabled={providerEditing || loading} onClick={() => { if (section === 'site-revisions') setRevisionRefresh(value => value + 1); else void load() }}><RefreshCw size={16} />刷新</button>}</div>{isSiteReview && <div className="admin-review-tabs" role="group" aria-label="站点审核类型"><button type="button" aria-pressed={section === 'submissions'} className={`button ${section === 'submissions' ? '' : 'button-ghost'}`} onClick={() => setSection('submissions')}>收录申请</button><button type="button" aria-pressed={section === 'site-revisions'} className={`button ${section === 'site-revisions' ? '' : 'button-ghost'}`} onClick={() => setSection('site-revisions')}>修改申请</button></div>}{error && <p className="form-error">{error}</p>}{loading ? <div className="admin-loading"><RefreshCw className="spin" /> 正在加载…</div> : <>
    {section === 'overview' && <><AdminOverview onNavigate={setSection} /><div className="admin-sync-card"><div><Trophy /><span><strong>模型能力排行榜</strong><small>手动从 Artificial Analysis 获取最新数据并写入本地数据库。公开页面不会实时请求源站。</small>{rankingSyncMessage && <em>{rankingSyncMessage}</em>}</span></div><button className="button" onClick={syncRankings} disabled={syncingRankings}><RefreshCw className={syncingRankings ? 'spin' : ''} size={16} />{syncingRankings ? '同步中…' : '立即同步排行榜'}</button></div></>}
    {section === 'site-revisions' && <AdminSiteRevisions refreshKey={revisionRefresh} />}{section === 'submissions' && <div className="admin-table-wrap"><table><thead><tr><th>站点</th><th>提交者</th><th>模型 / 价格</th><th>状态</th><th className="admin-review-actions">操作</th></tr></thead><tbody>{submissions.map(row => <tr key={row.id}><td><strong>{row.name}</strong><a href={String(row.website)} target="_blank" rel="noreferrer">{row.website}</a></td><td>@{row.submitter_login}<small>{row.created_at}</small></td><td>{row.models}<small>{row.pricing}</small><small>成立时间：{String(row.founded_at ?? '未提供').slice(0, 10)}</small><small>介绍：{row.description ?? '未提供'}</small></td><td><span className={`admin-badge ${row.status}`}>{row.status === 'pending' ? '待审核' : row.status === 'approved' ? '已通过' : '已驳回'}</span></td><td className="admin-review-actions"><div className="admin-actions">{row.status !== 'approved' && <button onClick={() => mutate(`submissions/${row.id}`, 'PATCH', { status: 'approved' })}>通过</button>}<button className="danger" onClick={() => confirmAction('确认驳回收录申请？', `“${row.name}”将被标记为已驳回。`, '确认驳回', () => mutate(`submissions/${row.id}`, 'PATCH', { status: 'rejected' }))}>驳回</button></div></td></tr>)}</tbody></table>{!submissions.length && <p className="admin-empty">暂无提交记录</p>}</div>}
    {section === 'model-prices' && <AdminModelPrices onEditingChange={setProviderEditing} />}
    {section === 'providers' && <AdminProviders initialRows={managedProviders} onEditingChange={setProviderEditing} />}
    {section === 'users' && <div className="admin-table-wrap"><table><thead><tr><th>用户</th><th>邮箱</th><th>注册时间</th><th>角色</th></tr></thead><tbody>{users.map(row => <tr key={row.id}><td><strong>{row.username}</strong></td><td>{row.email}</td><td>{row.created_at}</td><td><select value={String(row.role)} onChange={event => mutate(`users/${row.id}`, 'PATCH', { role: event.target.value })}><option value="user">普通用户</option><option value="admin">管理员</option></select></td></tr>)}</tbody></table></div>}
    {section === 'logs' && <div className="admin-table-wrap"><table><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>对象</th><th>详情</th></tr></thead><tbody>{logs.map(row => <tr key={row.id}><td>{row.created_at}</td><td>{row.admin_name}</td><td><code>{row.action}</code></td><td>{row.target_type} #{row.target_id}</td><td>{row.details || '—'}</td></tr>)}</tbody></table>{!logs.length && <p className="admin-empty">暂无操作记录</p>}</div>}
  </>}{pendingAction && <div className="exit-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPendingAction(null) }}><div className="exit-dialog danger-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title" aria-describedby="admin-confirm-description"><div className="exit-icon"><ShieldCheck /></div><h2 id="admin-confirm-title">{pendingAction.title}</h2><p id="admin-confirm-description">{pendingAction.description}</p><div className="exit-actions"><button className="button button-ghost" type="button" onClick={() => setPendingAction(null)}>取消</button><button className="button danger-confirm" type="button" onClick={executePendingAction}>{pendingAction.confirmLabel}</button></div></div></div>}</div></section>
}

function NotFound() { return <section className="page-section container"><div className="empty-state"><ServerCog /><h1>页面不存在</h1><p>所访问的页面可能已移动或删除。</p><Link className="button" to="/">返回首页</Link></div></section> }
function Footer() { return <footer className="site-footer"><div className="container footer-grid"><div><Logo /><p>开放、透明的 AI API 中转服务信息索引。</p></div><div><strong>快速导航</strong><Link to="/directory">服务目录</Link><Link to="/submit">提交收录</Link></div><div className="footer-agreements"><strong>协议与隐私</strong>{agreements.map(item => <Link key={item.id} to={`/agreements/${item.id}`}>{item.title}</Link>)}</div><div><strong>项目</strong><a href="https://github.com/xxx-x-x/OmwAI_Lab" target="_blank" rel="noreferrer"><GitBranch size={16} /> GitHub</a><a href="https://github.com/xxx-x-x/OmwAI_Lab/issues" target="_blank" rel="noreferrer"><Globe2 size={16} /> 反馈问题</a></div></div><div className="container footer-bottom"><span>© 2026 OmwAI_Lab</span><span>信息仅供参考，不构成购买建议</span></div></footer> }
export default Layout
