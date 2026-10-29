import { useEffect, useState } from 'react'
import './ModelDetector.css'

type Tier = 'low' | 'medium' | 'high'
type Capabilities = { fingerprint: { scorerAvailable: boolean; models: { id: string; requestModel: string; tiers: Record<Tier, { requests: number; maxOutputTokens: number }> }[] } }
type Task = { id: string; accessToken: string; state: string; report?: Record<string, unknown> | null }
const terminal = new Set(['completed', 'failed', 'cancelled', 'expired'])
const states: Record<string, string> = { queued: '排队中', running: '检测中', completed: '运行完成（不代表检测通过）', failed: '检测失败', cancelled: '已取消', expired: '任务过期' }
const storageKey = 'omwai-detector-task'
async function api(path: string, options?: RequestInit) {
  const response = await fetch('/api/detector/' + path, options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '检测服务暂不可用')
  return data
}

export default function ModelDetector() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [mode, setMode] = useState('protocol')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseline, setBaseline] = useState('')
  const [tier, setTier] = useState<Tier>('low')
  const [protocol, setProtocol] = useState('responses')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [polling, setPolling] = useState(true)
  const [task, setTask] = useState<Task | null>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); return saved && typeof saved.id === 'string' && typeof saved.accessToken === 'string' ? saved : null } catch { return null }
  })
  const selected = capabilities?.fingerprint.models.find(item => item.id === baseline)
  const budget = mode === 'fingerprint' ? selected?.tiers[tier] : { requests: 2, maxOutputTokens: 128 }
  const taskId = task?.id
  const taskAccess = task?.accessToken
  const taskState = task?.state
  const active = Boolean(task && !terminal.has(task.state))
  useEffect(() => { let alive = true; api('capabilities').then(data => { if (alive) setCapabilities(data) }).catch(reason => { if (alive) setError(reason.message) }); return () => { alive = false } }, [])
  useEffect(() => {
    if (!taskId || !taskAccess || !taskState || terminal.has(taskState) || !polling) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const data = await api(`tasks/${taskId}`, { headers: { 'x-detector-access': taskAccess } })
        if (disposed) return
        setError(''); setTask({ ...data, accessToken: taskAccess })
        if (!terminal.has(data.state)) timer = setTimeout(poll, 3000)
      } catch (reason) { if (!disposed) { setError((reason as Error).message); setPolling(false) } }
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [taskId, taskAccess, taskState, polling])
  useEffect(() => {
    try { if (task) sessionStorage.setItem(storageKey, JSON.stringify({ id: task.id, accessToken: task.accessToken, state: task.state })); else sessionStorage.removeItem(storageKey) } catch { /* Storage may be disabled. */ }
  }, [task])
  // Reload completed reports too; only the anonymous access token is stored, never the API key.
  useEffect(() => {
    if (!task || !terminal.has(task.state) || task.report !== undefined || !polling) return
    let alive = true
    api(`tasks/${task.id}`, { headers: { 'x-detector-access': task.accessToken } }).then(data => { if (alive) setTask({ ...data, accessToken: task.accessToken }) }).catch(reason => { if (alive) { setError(reason.message); setPolling(false) } })
    return () => { alive = false }
  }, [task, polling])
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const input = mode === 'fingerprint' ? { baseUrl, apiKey, model: baseline, requestModel: selected?.requestModel, protocol: 'responses', tier, confirmRequests: budget?.requests, timeoutMs: 15000, consent }
        : { baseUrl, apiKey, model, protocol, maxRequests: 2, maxOutputTokens: 128, timeoutMs: 15000, consent }
      const data = await api(mode === 'fingerprint' ? 'fingerprint-tasks' : 'tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      setApiKey(''); setTask(data); setPolling(true); setConsent(false)
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!task) return
    setBusy(true); setError('')
    try { await api(`tasks/${task.id}`, { method: 'DELETE', headers: { 'x-detector-access': task.accessToken } }); setPolling(true) }
    catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  const identity = task?.report?.identityStatus
  const verdict = typeof identity === 'string' ? ({ not_evaluated: '未评估模型身份', declared_matches: '行为与申报型号基准相符', different: '行为与申报型号基准不符', insufficient: '证据不足，无法判断' }[identity] || '请查看检测明细') : ''
  return <section className="page-section container detector-page"><h1>模型真伪检测 <small>实验性</small></h1><p>无需登录，自带 API 地址和 Key。支持协议检测与固定基准行为对照，不承诺识别所有模型。</p>
    <aside className="notice"><strong>检测限制与费用</strong><p>协议通过不等于模型为真；行为评分不是“真品概率”，基准匹配也不构成身份认证。没有基准的型号只能检测协议。请求由你填写的服务商计费，失败、取消中的在途请求也可能收费。</p><p>请仅使用有权测试的接口和专用低额度 Key。Key 经本站后端交给 Detector 加密暂存，完成、失败、取消或到期后由 Detector 清除；不保存在浏览器存储中。</p></aside>
    {error && <div className="detector-error" role="alert">{error}</div>}
    <form className="content-card detector-form" onSubmit={submit}><fieldset disabled={busy || active || !capabilities} onChange={event => { if (!(event.target instanceof HTMLInputElement && event.target.type === 'checkbox')) setConsent(false) }}><legend>检测配置</legend>
      <label>检测方式<select value={mode} onChange={event => setMode(event.target.value)}><option value="protocol">协议检测（普通 + 流式）</option><option value="fingerprint" disabled={!capabilities?.fingerprint.scorerAvailable}>行为指纹对照{capabilities && !capabilities.fingerprint.scorerAvailable ? '（评分服务未启用）' : ''}</option></select></label>
      <label>API 前缀（不含 /responses 或 /chat/completions）<input type="url" required maxLength={2048} placeholder="https://api.example.com/v1" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
      <label>专用低额度 API Key<input type="password" required autoComplete="off" maxLength={512} value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
      {mode === 'protocol' ? <><label>实际模型 ID<input required maxLength={200} value={model} onChange={event => setModel(event.target.value)} placeholder="服务商支持的模型 ID" /></label><label>协议<select value={protocol} onChange={event => setProtocol(event.target.value)}><option value="responses">Responses</option><option value="chat_completions">Chat Completions</option></select></label></> : <><label>固定基准型号<select required value={baseline} onChange={event => setBaseline(event.target.value)}><option value="">请选择有基准的型号</option>{capabilities?.fingerprint.models.map(item => <option key={item.id} value={item.id}>{item.id} → {item.requestModel}</option>)}</select></label><label>采样档位<select value={tier} onChange={event => setTier(event.target.value as Tier)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><p>仅使用 Responses，固定上游模型 ID：{selected?.requestModel || '请先选择型号'}。暂不支持自定义别名。</p></>}
      <p>请求预算：<strong>{budget?.requests ?? '—'} 次</strong>；单次最大输出：<strong>{budget?.maxOutputTokens ?? '—'} Tokens</strong>。实际计费及推理 Token 以服务商为准；不自动重试或切换协议。</p>
      <label className="detector-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required />我已获接口测试授权，同意上述请求预算及可能产生的费用，并理解结果不是真假保证。</label>
      <button className="button" disabled={!consent || !budget} type="submit">{busy ? '正在提交…' : '开始检测'}</button>
    </fieldset></form>
    {task && <article className="content-card detector-report" aria-live="polite"><h2>检测任务</h2><p>任务 ID：<code>{task.id}</code></p><p>状态：<strong>{states[task.state] || task.state}</strong></p>{verdict && <h3>{verdict}</h3>}{active && <button className="button button-ghost" disabled={busy} onClick={() => void cancel()}>取消检测（在途请求仍可能收费）</button>}{!polling && <button className="button" onClick={() => setPolling(true)}>重新查询</button>}{task.report && <details open><summary>脱敏检测明细</summary><pre>{JSON.stringify(task.report, null, 2)}</pre></details>}<p>当前标签页刷新可恢复查询；任务凭证有效 24 小时。关闭标签页可能丢失访问权，不会自动取消任务。不要分享任务访问凭证。</p></article>}
  </section>
}
