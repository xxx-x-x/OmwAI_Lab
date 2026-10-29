import { useEffect, useState } from 'react'
import './Mfa.css'

const originalFetch = window.fetch.bind(window)
let requestVerification: (() => Promise<boolean>) | undefined
let pendingVerification: Promise<boolean> | undefined
window.fetch = async (input, init) => {
  const request = new Request(input instanceof Request ? input : new URL(String(input), window.location.href), init)
  const retry = request.clone()
  const response = await originalFetch(request)
  if (new URL(request.url).origin !== window.location.origin || !new URL(request.url).pathname.startsWith('/api/') || response.status !== 403) return response
  const payload = await response.clone().json().catch(() => ({}))
  if (payload.code !== 'MFA_REQUIRED' || !requestVerification) return response
  pendingVerification ??= requestVerification().finally(() => { pendingVerification = undefined })
  return await pendingVerification ? originalFetch(retry) : response
}
async function post(path: string, body: unknown = {}) {
  const response = await originalFetch(`/api/auth/mfa/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '验证失败，请稍后重试')
  return data
}
export function MfaCodeForm({ challenge, onSuccess, onCancel }: { challenge?: string; onSuccess: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <form className="mfa-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await post(challenge ? 'challenge' : 'verify', { code, challenge }); setCode(''); onSuccess() } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') } finally { setBusy(false) } }}><h2>{challenge ? '完成登录验证' : '重新验证 MFA'}</h2><p>输入验证器 6 位验证码，或一条未使用的恢复码。恢复码用后作废；邮件无法绕过 MFA。相同验证器验证码不能重复使用，请等待下一组。</p><label>验证码或恢复码<input autoFocus required autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} maxLength={64} /></label>{error && <p role="alert">{error}</p>}<div className="mfa-actions"><button className="button" disabled={busy}>{busy ? '验证中…' : '验证'}</button><button type="button" className="button button-ghost" disabled={busy} onClick={onCancel}>取消</button></div></form>
}
export function MfaGate() {
  const [resolve, setResolve] = useState<((value: boolean) => void) | null>(null)
  useEffect(() => { requestVerification = () => new Promise<boolean>(done => setResolve(() => done)); return () => { requestVerification = undefined } }, [])
  if (!resolve) return null
  const finish = (ok: boolean) => { resolve(ok); setResolve(null) }
  return <div className="mfa-overlay" role="dialog" aria-modal="true" aria-label="管理员 MFA 重新验证"><div className="mfa-panel"><MfaCodeForm onSuccess={() => finish(true)} onCancel={() => finish(false)} /></div></div>
}
export function MfaSettings() {
  const [status, setStatus] = useState<{ enabled: boolean; configured: boolean; recoveryCodesRemaining: number } | null>(null)
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState(''), [codes, setCodes] = useState<string[]>([]), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const load = async () => { const response = await fetch('/api/auth/mfa/status'); const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus(data) }
  useEffect(() => { void Promise.resolve().then(load).catch(error => setError(error.message)) }, [])
  const action = async (path: string) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/auth/mfa/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, password }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失败')
      if (data.secret) { setSecret(data.secret); setPassword('') }
      if (data.recoveryCodes) { setCodes(data.recoveryCodes); setSecret(''); setCode('') }
      if (path === 'disable') { setSecret(''); setCodes([]) }
      await load()
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') } finally { setBusy(false) }
  }
  return <section className="container page-section"><div className="mfa-panel"><h1>管理员安全设置</h1><p>仅本地管理员可自愿绑定。未绑定不影响使用；绑定后，登录必须完成 MFA，所有后台写操作要求最近 5 分钟内验证。OAuth 账户没有本地管理员权限。</p>{error && <p role="alert">{error} <button onClick={() => load().catch(error => setError(error.message))}>重试</button></p>}{status && <><p>MFA：{status.enabled ? `已启用 · 剩余恢复码 ${status.recoveryCodesRemaining} 条` : '未启用'}</p>{!status.configured && <p>服务器尚未配置独立 MFA 加密密钥，暂不能绑定。</p>}{!status.enabled ? <><label>当前密码（绑定前确认）<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button" disabled={busy || !status.configured} onClick={() => { setCodes([]); void action('setup') }}>开始 / 重新绑定</button>{secret && <form className="mfa-form" onSubmit={event => { event.preventDefault(); void action('confirm') }}><p>在验证器中手动添加账户：OmwAI_Lab；类型 TOTP，SHA1，6 位，30 秒。密钥仅在本页显示，请勿共享。10 分钟内输入验证码确认后才会启用。</p><label>验证器密钥<input readOnly value={secret} autoComplete="off" /></label><label>6 位验证码<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} /></label><button className="button" disabled={busy}>确认绑定</button></form>}</> : <div className="mfa-actions"><button className="button" disabled={busy} onClick={() => { if (window.confirm('重新生成会立即作废所有旧恢复码，是否继续？')) void action('recovery-codes') }}>重新生成恢复码</button><button className="button button-ghost" disabled={busy} onClick={() => { if (window.confirm('关闭 MFA 将降低账户安全性，是否继续？')) void action('disable') }}>关闭 MFA</button></div>}</>}{codes.length > 0 && <div><h2>立即保存恢复码</h2><p>仅显示一次，请离线妥善保存，每条仅能使用一次。丢失验证器及全部恢复码后，邮件重置密码也无法解除 MFA。</p><pre className="mfa-codes">{codes.join('\n')}</pre><button className="button" onClick={() => setCodes([])}>我已安全保存，隐藏恢复码</button></div>}</div></section>
}
