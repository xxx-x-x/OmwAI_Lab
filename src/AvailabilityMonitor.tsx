import { useCallback, useEffect, useRef, useState } from 'react'

type Site = { id: number; name: string; website: string; groupName: string | null }
type Task = { id: string; siteId: number; groupName: string; model: string; intervalSeconds: number; endpoint: string; state: string }
type Beat = { time: string; status: number | null; ping: number | null }
async function api(path = '', method = 'GET', body?: unknown) {
  const response = await fetch(`/api/user/availability${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '监控操作失败')
  return result
}
const stateLabel: Record<string, string> = { pending: '待绑定（请联系管理员）', paused: '已暂停', active: '监控中' }
export default function AvailabilityMonitor() {
  const [sites, setSites] = useState<Site[]>([]), [tasks, setTasks] = useState<Task[]>([])
  const [enabled, setEnabled] = useState(false), [siteId, setSiteId] = useState(''), [group, setGroup] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [interval, setInterval] = useState(3600)
  const [history, setHistory] = useState<{ id: string; active: boolean; beats: Beat[] } | null>(null)
  const load = useCallback(async () => {
    const result = await api() as { enabled: boolean; sites: Site[]; tasks: Task[] }
    setEnabled(result.enabled); setSites(result.sites); setTasks(result.tasks)
  }, [])
  useEffect(() => { void Promise.resolve().then(load).catch(e => setError(String(e.message))) }, [load])
  const [models, setModels] = useState<string[]>([]), [model, setModel] = useState('')
  const modelGeneration = useRef(0)
  const clearModels = () => { modelGeneration.current++; setModels([]); setModel('') }
  const loadModels = async (form: HTMLFormElement) => {
    clearModels()
    const generation = modelGeneration.current, data = new FormData(form)
    setBusy(true); setError('')
    try {
      const result = await api('/models', 'POST', { siteId: Number(siteId), groupName: group, baseUrl: data.get('baseUrl'), key: data.get('key') })
      if (generation === modelGeneration.current) setModels(result.models)
    } catch (e) { setError(e instanceof Error ? e.message : '模型列表获取失败') }
    finally { setBusy(false) }
  }
  const selected = sites.find(s => String(s.id) === siteId)
  const act = async (task: Task, action: 'pause' | 'resume' | 'delete' | 'history') => {
    if (action === 'resume' && !confirm('启用后会持续产生真实模型调用费用。已限制专用 KEY 的额度及分组，并同意持续扣费？')) return
    if (action === 'delete' && !confirm('永久删除此 Lab 任务及其 Uptime 历史？如需保留历史，请取消并选择暂停。不会删除其他监控。')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api(`/${task.id}${action === 'delete' ? '' : `/${action}`}`, action === 'history' ? 'GET' : action === 'delete' ? 'DELETE' : 'POST', action === 'resume' ? { costConfirmed: true } : action === 'delete' ? { deleteConfirmed: true } : undefined)
      if (action === 'history') setHistory({ id: task.id, active: result.active, beats: result.beats })
      else { setHistory(null); setNotice('操作成功'); await load() }
    } catch (e) { setError(e instanceof Error ? e.message : '网络异常') }
    finally { setBusy(false) }
  }
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget, data = new FormData(form)
    setBusy(true); setError(''); setNotice('')
    try {
      if (!model || !models.includes(model)) throw new Error('请先获取模型列表并选择模型')
      await api('', 'POST', { siteId: Number(siteId), groupName: group, baseUrl: data.get('baseUrl'), model, key: data.get('key'), intervalSeconds: interval, costConfirmed: data.has('costConfirmed'), keyConfirmed: data.has('keyConfirmed') })
      form.reset(); setSiteId(''); setGroup(''); setInterval(3600); setNotice('已创建暂停任务。确认后点击启用。'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : '网络异常'); await load().catch(() => {}) }
    finally { const input = form.elements.namedItem('key'); if (input instanceof HTMLInputElement) input.value = ''; clearModels(); setBusy(false) }
  }
  return <article className="content-card">
    <h2>模型可用性持续监控</h2>
    <p>复用现有 Uptime，仅管理你绑定的 Lab 任务。真实 Chat Completions 非流式请求，每次最多请求 16 个输出 token；HTTP 200 且返回非空文本才算成功。不测 TTFT、不认证模型身份，也不保证语义正确。</p>
    <p>模型列表由 Lab 后端携 KEY 请求上游 /v1/models；创建时会重新验证，禁止手填。Lab 不持久保存 KEY。Uptime 必须确认支持 AES-256-GCM 静态加密后才接收 KEY；管理接口不返回 KEY，探测时仅在内存解密。服务器管理员或被入侵的运行环境仍可能取得 KEY，并非绝对安全。务必使用专用低额度、已绑定所选分组的 KEY；分组仅为标签，不会自动切换上游 KEY 分组。费用以服务商实际计费为准。</p>
    {!enabled && <p role="status">功能默认禁用，需管理员完成凭证、源站白名单及出站隔离配置后启用。</p>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form className="submit-form" onSubmit={create}><fieldset disabled={!enabled || busy}><legend>新建任务（先暂停，再手动启用）</legend><div className="form-grid">
      <label>我的已审核站点<select required value={siteId} onChange={e => { setSiteId(e.target.value); setGroup(''); clearModels() }}><option value="">请选择</option>{[...new Map(sites.map(s => [s.id, s])).values()].map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>分组<select value={group} onChange={e => { setGroup(e.target.value); clearModels() }}><option value="">未指定分组</option>{sites.filter(s => String(s.id) === siteId && s.groupName).map(s => <option key={s.groupName} value={s.groupName!}>{s.groupName}</option>)}</select></label>
      <label>HTTPS API 基址<input key={siteId} name="baseUrl" type="url" required onChange={clearModels} defaultValue={selected ? new URL(selected.website).origin : ''} placeholder="https://example.com/v1" /><small>仅支持同一站点源站的 /v1，且须在管理员白名单中</small></label>
      <label>专用低额度 KEY<input name="key" type="password" required autoComplete="off" minLength={8} maxLength={512} onChange={clearModels} /></label>
      <label>上游模型<select required name="model" value={model} onChange={e => setModel(e.target.value)} disabled={!models.length}><option value="">请先获取模型列表</option>{models.map(id => <option key={id} value={id}>{id}</option>)}</select><button type="button" className="button button-ghost" onClick={e => { const form = e.currentTarget.form; if (form) void loadModels(form) }}>使用当前 KEY 获取模型列表</button></label>
      <label>间隔（秒，900–86400）<input type="number" min={900} max={86400} step={1} required value={interval} onChange={e => setInterval(Number(e.target.value))} /></label>
    </div><p>预计每天约 {Number.isFinite(interval) && interval >= 900 ? Math.ceil(86400 / interval) : '—'} 次调用，每人最多 5 个任务。无自动重试；服务重启可能触发额外检查，不能作为费用硬上限。</p>
      <label><input name="keyConfirmed" type="checkbox" required /> 我有权使用此 KEY，已在服务商限制额度及分组，并同意 KEY 留在 Uptime。</label><br />
      <label><input name="costConfirmed" type="checkbox" required /> 我理解启用后的持续调用费用；平台无法保证预算硬上限。</label><p><button className="button" disabled={busy || !model || !models.includes(model)}>创建暂停任务</button></p>
    </fieldset></form>
    <h3>我的任务</h3><button className="button button-ghost" disabled={busy} onClick={() => load().catch(e => setError(e.message))}>刷新任务</button>
    {!tasks.length && <p>暂无任务。</p>}
    {tasks.map(task => <section className="content-card" key={task.id}><h4>{sites.find(s => Number(s.id) === Number(task.siteId))?.name || `站点 ${task.siteId}`} · {task.model}</h4><p>{task.groupName || '未指定分组'} · {task.intervalSeconds} 秒 · {stateLabel[task.state] || task.state}</p><p>{task.endpoint}</p><small>任务 UUID：{task.id}</small><p>{(['history', 'pause', 'resume', 'delete'] as const).map(action => <button className="button button-ghost" key={action} disabled={!enabled || busy || task.state === 'pending'} onClick={() => act(task, action)}>{{ history: '状态 / 近24小时历史', pause: '暂停（保留历史）', resume: '启用', delete: '删除及清除历史' }[action]}</button>)}</p>
      {history?.id === task.id && <><p>Uptime 实际状态：{history.active ? '运行中' : '暂停'}。最近 24 小时，最多 300 条；成功率以所显示记录计算，非 SLA。耗时为完整响应耗时，非 TTFT。</p><p>成功率：{history.beats.length ? `${(100 * history.beats.filter(b => b.status === 1).length / history.beats.length).toFixed(1)}%` : '暂无样本'}</p><div style={{ maxHeight: 320, overflow: 'auto' }}><table><thead><tr><th>时间（Uptime UTC）</th><th>状态</th><th>完整响应耗时 ms</th></tr></thead><tbody>{history.beats.map((beat, i) => <tr key={i}><td>{beat.time}</td><td>{beat.status === 1 ? '成功' : beat.status === 0 ? '失败' : beat.status === 2 ? '待定' : beat.status === 3 ? '维护' : '未知'}</td><td>{beat.ping ?? '—'}</td></tr>)}</tbody></table></div></>}
    </section>)}
  </article>
}
