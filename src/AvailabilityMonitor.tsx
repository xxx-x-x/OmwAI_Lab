import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ChevronDown, Clock3, ListChecks, Pause, Play, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { beatLabels, historySummary, orderedBeats, type Beat } from './availabilityHistory'
import './AvailabilityMonitor.css'

type Site = { id: number; name: string; website: string; groupName: string | null }
type Task = { id: string; taskGroupId?: string | null; siteId: number; groupName: string; model: string; intervalSeconds: number; endpoint: string; state: string }
type History = { active: boolean; beats: Beat[] }
type HistoryState = { data?: History; error?: string; loading: boolean }

function TaskBeats({ history }: { history: History }) {
  const beats = orderedBeats(history.beats)
  return <div className="monitor-beats" role="group" aria-label={`近24小时 ${beats.length} 次探测，成功率 ${historySummary(beats).successRate}`}>
    {beats.map((beat, index) => <span tabIndex={0} key={`${beat.time}-${index}`} className={`monitor-beat beat-${beat.status ?? 'unknown'}`} aria-label={`${beat.time} UTC · ${beatLabels[beat.status ?? -1] || '未知'} · ${beat.ping ?? '—'} ms`}><span className="monitor-beat-tooltip">{beat.time} UTC<br />{beatLabels[beat.status ?? -1] || '未知'} · {beat.ping ?? '—'} ms</span></span>)}
  </div>
}
function TaskHistory({ history }: { history: History }) {
  const beats = orderedBeats(history.beats)
  const summary = historySummary(beats)
  return <div className="monitor-history">
    <div className="monitor-history-heading"><span>近 24 小时可用性</span><strong>{summary.successRate}<small>采样成功率</small></strong></div>
    {beats.length ? <>
      <div className="monitor-history-axis"><span>{beats[0].time} UTC</span><span>最近采样 · {beats[beats.length - 1].time} UTC</span></div>
    </> : <div className="monitor-no-beats">暂无探测记录{history.active ? '，等待首次检查' : '，启用后将持续记录'}</div>}
    <div className="monitor-history-footer"><span>{beats.length} 次采样 · 平均完整响应 {summary.averagePing}</span><span>每条代表一次探测，非等时长分桶</span></div>
    {!!beats.length && <details className="monitor-records"><summary>查看逐条记录 <ChevronDown size={14} /></summary><div className="monitor-table-wrap"><table><thead><tr><th>采样时间（UTC）</th><th>状态</th><th>完整响应耗时</th></tr></thead><tbody>{[...beats].reverse().map((beat, index) => <tr key={index}><td>{beat.time}</td><td><span className={`monitor-record-status beat-${beat.status ?? 'unknown'}`}>{beatLabels[beat.status ?? -1] || '未知'}</span></td><td>{beat.ping !== null ? `${beat.ping} ms` : '—'}</td></tr>)}</tbody></table></div></details>}
  </div>
}
async function api(path = '', method = 'GET', body?: unknown) {
  const response = await fetch(`/api/user/availability${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const result = await response.json()
  if (!response.ok || result.ok === false) throw new Error(result.error || '监控操作失败，请刷新核对各模型状态')
  return result
}
type MonitorAction = 'pause' | 'resume' | 'delete'
function MonitorConfirm({ action, count, onCancel, onConfirm }: { action: MonitorAction; count: number; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  return <dialog ref={dialog} className="monitor-confirm" aria-labelledby="monitor-confirm-title" onCancel={event => { event.preventDefault(); onCancel() }}>
    <div className="monitor-confirm-icon"><ShieldCheck size={24} /></div><h3 id="monitor-confirm-title">{action === 'delete' ? '删除监控' : '启用持续监控'}</h3>
    <p>{action === 'delete' ? `将永久删除 ${count} 个模型监控及其历史，无法撤销。如需保留历史，请选择暂停。待绑定模型不会被批量删除。` : `将启用 ${count} 个模型监控，每个模型会独立、持续调用 API 并产生费用。请确认已为专用 KEY 限制额度及分组，并同意持续扣费。`}</p>
    <div className="monitor-confirm-actions"><button type="button" className="button button-ghost" autoFocus onClick={onCancel}>取消</button><button type="button" className={`button ${action === 'delete' ? 'danger-confirm' : ''}`} onClick={onConfirm}>{action === 'delete' ? '确认删除' : '确认并启用'}</button></div>
  </dialog>
}
const stateLabel: Record<string, string> = { pending: '待绑定（请联系管理员）', paused: '已暂停', active: '监控中' }
export default function AvailabilityMonitor() {
  const [sites, setSites] = useState<Site[]>([]), [tasks, setTasks] = useState<Task[]>([])
  const [enabled, setEnabled] = useState(false), [siteId, setSiteId] = useState(''), [group, setGroup] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [interval, setInterval] = useState(3600)
  const [histories, setHistories] = useState<Record<string, HistoryState>>({})
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmation, setConfirmation] = useState<{ tasks: Task[]; action: MonitorAction; grouped: boolean } | null>(null)
  const [operation, setOperation] = useState<{ ids: string[]; action: MonitorAction; completed: number } | null>(null)
  const operationLock = useRef(false)
  const historyGeneration = useRef(0)
  const loadHistory = useCallback(async (task: Task, generation: number) => {
    setHistories(previous => ({ ...previous, [task.id]: { ...previous[task.id], loading: true, error: undefined } }))
    try {
      const data = await api(`/${task.id}/history`) as History
      if (generation === historyGeneration.current) setHistories(previous => ({ ...previous, [task.id]: { data, loading: false } }))
    } catch (error) {
      if (generation === historyGeneration.current) setHistories(previous => ({ ...previous, [task.id]: { ...previous[task.id], loading: false, error: error instanceof Error ? error.message : '历史加载失败' } }))
    }
  }, [])
  const load = useCallback(async () => {
    setLoading(true)
    const generation = ++historyGeneration.current
    try {
      const result = await api() as { enabled: boolean; sites: Site[]; tasks: Task[] }
      setEnabled(result.enabled); setSites(result.sites); setTasks(result.tasks)
      // Keep automatic history requests sequential: Uptime allows four concurrent sessions.
      if (result.enabled) for (const task of result.tasks) {
        if (generation !== historyGeneration.current) break
        if (task.state !== 'pending') await loadHistory(task, generation)
      }
    } finally { if (generation === historyGeneration.current) setLoading(false) }
  }, [loadHistory])
  useEffect(() => { void Promise.resolve().then(load).catch(e => setError(String(e.message))) }, [load])
  const [models, setModels] = useState<string[]>([]), [selectedModels, setSelectedModels] = useState<string[]>([])
  const [modelSearch, setModelSearch] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const modelGeneration = useRef(0)
  const clearModels = () => { modelGeneration.current++; setModels([]); setSelectedModels([]); setModelSearch(''); setModelPickerOpen(false) }
  const loadModels = async (form: HTMLFormElement) => {
    clearModels()
    const generation = modelGeneration.current, data = new FormData(form)
    setBusy(true); setError('')
    try {
      const result = await api('/models', 'POST', { siteId: Number(siteId), groupName: group, baseUrl: data.get('baseUrl'), key: data.get('key') })
      if (generation === modelGeneration.current) { setModels(result.models); setModelPickerOpen(true) }
    } catch (e) { setError(e instanceof Error ? e.message : '模型列表获取失败') }
    finally { setBusy(false) }
  }
  const selected = sites.find(s => String(s.id) === siteId)
  const act = async (task: Task, action: MonitorAction, confirmed = false) => {
    if (operationLock.current) return
    if (!confirmed && action !== 'pause') { setConfirmation({ tasks: [task], action, grouped: false }); return }
    operationLock.current = true
    setOperation({ ids: [task.id], action, completed: 0 })
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`/${task.id}${action === 'delete' ? '' : `/${action}`}`, action === 'delete' ? 'DELETE' : 'POST', action === 'resume' ? { costConfirmed: true } : action === 'delete' ? { deleteConfirmed: true } : undefined)
      setNotice(action === 'resume' ? '启用请求已完成，正在核对状态…' : '操作成功，正在刷新…')
      await load()
      setNotice(action === 'resume' ? '监控已启用' : '操作成功')
    } catch (e) { setNotice(''); setError(e instanceof Error ? e.message : '网络异常，请刷新核对实际状态') }
    finally { setOperation(null); operationLock.current = false; setBusy(false) }
  }
  const actGroup = async (members: Task[], action: MonitorAction, confirmed = false) => {
    if (operationLock.current) return
    const targets = members.filter(task => task.state !== 'pending')
    if (!targets.length) return
    if (!confirmed && action !== 'pause') { setConfirmation({ tasks: members, action, grouped: true }); return }
    operationLock.current = true
    setOperation({ ids: targets.map(task => task.id), action, completed: 0 })
    setBusy(true); setError(''); setNotice('')
    let completed = 0
    try {
      for (const task of targets) {
        await api(`/${task.id}${action === 'delete' ? '' : `/${action}`}`, action === 'delete' ? 'DELETE' : 'POST', action === 'resume' ? { costConfirmed: true } : action === 'delete' ? { deleteConfirmed: true } : undefined)
        completed++
        setOperation(previous => previous ? { ...previous, completed } : null)
      }
      setNotice(`已${action === 'pause' ? '暂停' : action === 'resume' ? '启用' : '删除'} ${completed} 个模型${members.some(task => task.state === 'pending') ? '；待绑定模型请联系管理员核对' : ''}`)
    } catch (e) { setError(`已完成 ${completed}/${targets.length} 个模型；${e instanceof Error ? e.message : '操作失败'}。请核对各模型状态后重试。`) }
    finally { await load().catch(() => setError('刷新失败，请手动刷新核对各模型状态')); setOperation(null); operationLock.current = false; setBusy(false) }
  }
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget, data = new FormData(form)
    setBusy(true); setError(''); setNotice('')
    try {
      if (!selectedModels.length || selectedModels.length > 5 || selectedModels.some(model => !models.includes(model))) throw new Error('请先获取模型列表并选择 1–5 个模型')
      await api('', 'POST', { siteId: Number(siteId), groupName: group, baseUrl: data.get('baseUrl'), models: selectedModels, key: data.get('key'), intervalSeconds: interval, costConfirmed: data.has('costConfirmed'), keyConfirmed: data.has('keyConfirmed') })
      form.reset(); setSiteId(''); setGroup(''); setInterval(3600); setNotice('已创建暂停任务。确认后点击启用。'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : '网络异常'); await load().catch(() => {}) }
    finally { const input = form.elements.namedItem('key'); if (input instanceof HTMLInputElement) input.value = ''; clearModels(); setBusy(false) }
  }
  const taskGroups = [...tasks.reduce((groups, task) => {
    const id = task.taskGroupId || task.id
    groups.set(id, [...(groups.get(id) ?? []), task])
    return groups
  }, new Map<string, Task[]>())]
  const running = tasks.filter(task => task.state !== 'pending' && (histories[task.id]?.data?.active ?? task.state === 'active')).length
  return <article className="availability-page">
    {confirmation && <MonitorConfirm action={confirmation.action} count={confirmation.tasks.filter(task => task.state !== 'pending').length} onCancel={() => setConfirmation(null)} onConfirm={() => { const request = confirmation; setConfirmation(null); if (request.grouped) void actGroup(request.tasks, request.action, true); else void act(request.tasks[0], request.action, true) }} />}
    {operation && <div className="monitor-operation" role="status" aria-live="polite"><RefreshCw size={15} className="monitor-spinning" />{operation.action === 'resume' ? '启动中…' : operation.action === 'pause' ? '暂停中…' : '删除中…'}{operation.ids.length > 1 && ` ${operation.completed}/${operation.ids.length}` }<span>正在与监控服务同步，请勿重复操作</span></div>}
    <header className="monitor-page-heading"><div><span className="monitor-eyebrow"><Activity size={15} /> UPTIME MONITORING</span><h2>可用性持续监控</h2><p>持续观察真实模型调用，让每一次异常都有迹可循。</p></div><button className="button" onClick={() => setShowCreate(value => !value)} aria-expanded={showCreate}><Plus size={16} />新建监控</button></header>
    <div className="monitor-overview">
      <div><span><ListChecks size={16} />分组任务</span><strong>{taskGroups.length}<small>/ 5 个</small></strong></div>
      <div><span><Activity size={16} />运行中</span><strong>{running}<small>个模型 / 最多 25 个</small></strong></div>
      <div><span><Pause size={16} />未运行</span><strong>{tasks.length - running}<small>暂停 / 待绑定</small></strong></div>
      <div><span><Clock3 size={16} />历史窗口</span><strong>24<small>小时 · 最多 300 条 / 模型</small></strong></div>
    </div>
    {!enabled && !loading && <div className="monitor-message" role="status">持续监控尚未启用。请管理员完成凭证、源站白名单及出站隔离配置。</div>}
    {error && <div className="monitor-message is-error" role="alert">{error}</div>}{notice && <div className="monitor-message is-success" role="status">{notice}</div>}
    {showCreate && <section className="monitor-create" aria-labelledby="monitor-create-title">
      <div className="monitor-section-heading"><div><h3 id="monitor-create-title">新建监控任务</h3><p>连接站点与模型，创建后默认为暂停，不会立即发起持续调用。</p></div><button type="button" className="button button-ghost" onClick={() => setShowCreate(false)}>收起</button></div>
      <form onSubmit={create}><fieldset disabled={!enabled || busy || loading}>
        <legend className="monitor-sr-only">配置监控任务</legend>
        <div className="monitor-form-grid">
          <label>我的已审核站点<select required value={siteId} onChange={e => { setSiteId(e.target.value); setGroup(''); clearModels() }}><option value="">请选择站点</option>{[...new Map(sites.map(site => [site.id, site])).values()].map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <label>分组<select value={group} onChange={e => { setGroup(e.target.value); clearModels() }}><option value="">未指定分组</option>{sites.filter(site => String(site.id) === siteId && site.groupName).map(site => <option key={site.groupName} value={site.groupName!}>{site.groupName}</option>)}</select><small>仅作标签；KEY 需预先绑定对应分组</small></label>
          <label>HTTPS API 基址<input key={siteId} name="baseUrl" type="url" required onChange={clearModels} defaultValue={selected ? new URL(selected.website).origin : ''} placeholder="https://example.com/v1" /><small>仅支持同源站点的 /v1，且须在管理员白名单中</small></label>
          <label>专用低额度 KEY<input name="key" type="password" required autoComplete="off" minLength={8} maxLength={512} onChange={clearModels} placeholder="请输入用于监控的专用 KEY" /><small>Lab 不持久保存 KEY，Uptime 加密保管</small></label>
          <div className="monitor-model-picker"><div className="monitor-model-picker-heading"><strong>上游模型 <small>已选 {selectedModels.length}/5</small></strong><button type="button" className="button button-ghost" disabled={!siteId} onClick={e => { const form = e.currentTarget.form; if (form) void loadModels(form) }}>获取模型</button></div>
            {models.length ? <div className="monitor-model-select" onKeyDown={e => { if (e.key === 'Escape') setModelPickerOpen(false) }}>
              <div className="monitor-model-selection"><div className="monitor-selected-models">{selectedModels.map(id => <button type="button" key={id} onClick={() => setSelectedModels(previous => previous.filter(value => value !== id))} title={`取消选择 ${id}`}>{id} ×</button>)}{!selectedModels.length && <span>请选择 1–5 个模型</span>}</div><button type="button" className="monitor-picker-toggle" aria-label={modelPickerOpen ? '收起模型列表' : '展开模型列表'} aria-expanded={modelPickerOpen} aria-controls="monitor-model-dropdown" onClick={() => setModelPickerOpen(value => !value)}><ChevronDown size={16} /></button></div>
              {modelPickerOpen && <div className="monitor-model-dropdown" id="monitor-model-dropdown"><input type="search" aria-label="搜索上游模型" placeholder="搜索模型 ID" value={modelSearch} onChange={e => setModelSearch(e.target.value)} /><div className="monitor-model-options" role="group" aria-label="选择 1 至 5 个探测模型">{models.filter(id => id.toLowerCase().includes(modelSearch.toLowerCase())).map(id => <label key={id}><input type="checkbox" checked={selectedModels.includes(id)} disabled={!selectedModels.includes(id) && selectedModels.length >= 5} onChange={e => setSelectedModels(previous => e.target.checked ? [...previous, id] : previous.filter(value => value !== id))} /><span>{id}</span></label>)}{!models.some(id => id.toLowerCase().includes(modelSearch.toLowerCase())) && <small>没有匹配模型</small>}</div><button type="button" className="monitor-picker-done" onClick={() => setModelPickerOpen(false)}>完成选择（{selectedModels.length}/5）</button></div>}
            </div> : <small>使用当前分组 KEY 获取模型，然后多选 1–5 个；创建时再次验证。</small>}
          </div>
          <label>探测间隔（秒）<input type="number" min={900} max={86400} step={1} required value={interval} onChange={e => setInterval(Number(e.target.value))} /><small>900–86400 秒，预计每天约 {Number.isFinite(interval) && interval >= 900 && interval <= 86400 ? Math.ceil(86400 / interval) * selectedModels.length : '—'} 次调用</small></label>
        </div>
        <div className="monitor-consent"><label><input name="keyConfirmed" type="checkbox" required /><span>我有权使用此 KEY，已在服务商限制额度及分组，并同意 KEY 留在 Uptime。</span></label><label><input name="costConfirmed" type="checkbox" required /><span>我理解启用后的持续调用费用；平台无法保证预算硬上限。</span></label></div>
        <div className="monitor-create-footer"><span>最多 5 个分组任务 · 每组 1–5 个模型 · 创建后需手动启用</span><button className="button" disabled={busy || !selectedModels.length || selectedModels.some(model => !models.includes(model))}>{busy ? '处理中…' : '创建暂停任务'}</button></div>
      </fieldset></form>
    </section>}
    <section className="monitor-tasks" aria-labelledby="monitor-tasks-title" aria-busy={loading}>
      <div className="monitor-section-heading"><div><h3 id="monitor-tasks-title">我的监控 <span>{taskGroups.length} 组 · {tasks.length} 模型</span></h3><p>近 24 小时真实采样 · 手动刷新更新状态与历史</p></div><button className="button button-ghost" disabled={busy || loading} onClick={() => { setError(''); void load().catch(e => setError(e.message)) }}><RefreshCw size={14} className={loading ? 'monitor-spinning' : ''} />{loading ? '刷新中' : '刷新监控'}</button></div>
      <div className="monitor-legend">{[1, 0, 2, 3, -1].map(status => <span key={status}><i className={`beat-${status === -1 ? 'unknown' : status}`} />{beatLabels[status] || '未知'}</span>)}<small>采样成功率非 SLA · 完整响应耗时非 TTFT</small></div>
      {!tasks.length && <div className="monitor-empty"><Activity size={30} /><h4>{loading ? '正在加载监控…' : '还没有监控任务'}</h4><p>添加一个站点和模型，开始记录可用性与响应情况。</p>{!loading && <button className="button button-ghost" onClick={() => setShowCreate(true)}><Plus size={15} />创建第一个监控</button>}</div>}
      <div className="monitor-task-list">{taskGroups.map(([groupId, members]) => <div className="monitor-group" key={groupId}>
        <div className="monitor-group-heading"><div><strong>{sites.find(site => Number(site.id) === Number(members[0].siteId))?.name || `站点 ${members[0].siteId}`} · {members[0].groupName || '未指定分组'}</strong><small>{members.length} 个模型 · 独立探测与计费</small></div><div className="monitor-group-actions"><button type="button" disabled={!enabled || busy || loading || members.every(task => task.state === 'pending')} onClick={() => void actGroup(members, 'resume')}>全部启用</button><button type="button" disabled={!enabled || busy || loading || members.every(task => task.state === 'pending')} onClick={() => void actGroup(members, 'pause')}>全部暂停</button><button type="button" disabled={!enabled || busy || loading || members.every(task => task.state === 'pending')} onClick={() => void actGroup(members, 'delete')}>删除分组</button></div></div>
        {members.map(task => {
        const entry = histories[task.id]
        const active = entry?.data?.active ?? task.state === 'active'
        const taskOperation = operation?.ids.includes(task.id) ? operation.action : null
        const label = taskOperation ? taskOperation === 'resume' ? '启动中…' : taskOperation === 'pause' ? '暂停中…' : '删除中…' : task.state === 'pending' ? stateLabel.pending : active ? stateLabel.active : stateLabel.paused
        const summary = entry?.data ? historySummary(entry.data.beats) : null
        return <div className="monitor-model-row" key={task.id}>
          <div className="monitor-model-row-main"><div className="monitor-model-row-name"><strong title={task.model}>{task.model}</strong><span className={`monitor-state ${task.state === 'pending' ? 'is-pending' : active ? 'is-active' : ''}`}><i />{label}</span></div>
            <div className="monitor-model-row-timeline" aria-label={`${task.model} 近24小时探测历史`} aria-busy={entry?.loading || false}>
              {entry?.data?.beats.length ? <TaskBeats history={entry.data} /> : <span className="monitor-model-row-placeholder">{task.state === 'pending' ? '待绑定后开始探测' : entry?.loading ? '正在读取历史…' : entry?.error ? '历史加载失败，请展开详情重试' : entry?.data ? `暂无探测记录，${entry.data.active ? '等待首次检查' : '启用后将持续记录'}` : enabled ? '等待加载历史' : '监控服务未启用'}</span>}
              {entry?.data && entry.error && <span className="monitor-model-row-warning" role="status">历史更新失败，当前为上次结果</span>}
            </div>
            <div className="monitor-model-row-metrics"><span title="近24小时采样成功率">{summary?.successRate ?? '—'}</span><span title="平均完整响应耗时">{summary?.averagePing ?? '—'}</span></div>
            <div className="monitor-model-row-actions"><button type="button" className="button button-ghost" disabled={!enabled || busy || loading || task.state === 'pending'} onClick={() => void act(task, active ? 'pause' : 'resume')}>{taskOperation ? <RefreshCw size={13} className="monitor-spinning" /> : active ? <Pause size={13} /> : <Play size={13} />}{taskOperation ? label : active ? '暂停' : '启用'}</button><button type="button" className="monitor-delete" aria-label={`删除模型 ${task.model}`} disabled={!enabled || busy || loading || task.state === 'pending'} onClick={() => void act(task, 'delete')}><Trash2 size={14} /></button></div>
          </div>
          <details className="monitor-model-detail"><summary>探测历史与详情 <ChevronDown size={13} /></summary>
            <div className="monitor-task-meta"><span>间隔 <strong>{task.intervalSeconds / 60} 分钟</strong></span><span className="monitor-endpoint" title={task.endpoint}>{task.endpoint}</span></div>
            {task.state === 'pending' ? <p className="monitor-history-hint">任务尚未绑定，请联系管理员核对。请勿重复创建。</p> : <>
              {entry?.loading && <p className="monitor-history-hint" role="status">正在读取历史…{entry.data && '下方为上次结果'}</p>}
              {entry?.error && <div className="monitor-history-error" role="alert">{entry.error}{entry.data && '；下方为上次读取结果，非最新状态。'}<button type="button" disabled={loading || busy} onClick={() => void loadHistory(task, historyGeneration.current)}>重试</button></div>}
              {entry?.data ? <TaskHistory history={entry.data} /> : !entry?.loading && !entry?.error && <p className="monitor-history-hint">{enabled ? '等待加载历史' : '监控服务未启用'}</p>}
            </>}
            <p className="monitor-history-hint">任务 UUID：{task.id}</p>
          </details>
        </div>
      })}</div>)}</div>
    </section>
    <details className="monitor-explainer"><summary><ShieldCheck size={16} />探测规则、费用与 KEY 安全说明<ChevronDown size={15} /></summary><div><p>复用 Uptime，仅管理你绑定的 Lab 任务。真实 Chat Completions 非流式请求，每次最多请求 16 个输出 token；HTTP 200 且返回非空文本才算成功。不测 TTFT、不认证模型身份，也不保证语义正确。</p><p>每个模型近 24 小时最多展示 300 条采样，监控竖条直接显示在模型行中，悬停或聚焦可查看采样时间、状态和耗时；展开“探测历史与详情”可查看逐条记录。每条状态条对应一次实际探测，并非等时长分桶。采样成功率按展示记录中成功次数计算，不代表 SLA。无自动重试；服务重启可能触发额外检查，失败也可能计费，费用以服务商实际计费为准。</p><p>Lab 后端携 KEY 请求上游 /v1/models，创建时重新验证。Lab 不持久保存 KEY；Uptime 必须确认支持 AES-256-GCM 静态加密后才接收 KEY，管理接口不返回 KEY，探测时仅在内存解密。服务器管理员或被入侵的运行环境仍可能取得 KEY，并非绝对安全。务必使用专用低额度、已绑定所选分组的 KEY；分组仅为标签，不会自动切换上游 KEY 分组。</p><p>暂停保留历史；删除将永久移除任务及其 Uptime 历史。每组最多 5 个模型，每个模型独立调用并计费；新建任务需手动启用，启用前会再次确认费用。</p></div></details>
  </article>
}
