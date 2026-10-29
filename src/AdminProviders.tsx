import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, Globe2, Search } from 'lucide-react'
import { useBlocker } from 'react-router-dom'
import SiteDialog from './SiteDialog'
import SiteLogoSettings from './SiteLogoSettings'
import './AdminProviders.css'

type Row = Record<string, string | number | null>
const billingTypes = ['按量计费', '按次计费', '包月订阅', '混合计费', '其他']
const visible = (row: Row) => Boolean(row.active && row.directory_listed && row.submission_status === 'approved')
const statusLabel = (row: Row) => !row.active ? '已停用' : visible(row) ? '公开展示' : '未公开'

export default function AdminProviders({ initialRows, onEditingChange }: { initialRows: Row[]; onEditingChange: (locked: boolean) => void }) {
  const [rows, setRows] = useState(initialRows)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Row | null>(null)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [action, setAction] = useState<{ row: Row; kind: 'toggle' | 'delete' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const blocker = useBlocker(dirty || busy)
  useEffect(() => {
    onEditingChange(Boolean(selected) || busy)
    return () => onEditingChange(false)
  }, [selected, busy, onEditingChange])
  useEffect(() => {
    if (!dirty && !busy) return
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [dirty, busy])
  const filtered = useMemo(() => rows.filter(row => String(row.name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter === 'all' || (filter === 'public' ? visible(row) : filter === 'disabled' ? !row.active : Boolean(row.active) && !visible(row)))), [rows, query, filter])
  const close = () => { if (busy) return; if (dirty) setConfirmClose(true); else setSelected(null) }
  const mutate = async (row: Row, method: string, body?: unknown) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/admin/providers/${row.id}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '操作失败，请重试')
      setSelected(null); setDirty(false); setAction(null)
      setMessage(method === 'DELETE' ? '站点已删除' : editing && body && !('active' in (body as object)) ? '站点资料已保存' : '站点状态已更新')
      try {
        const refreshed = await fetch('/api/admin/providers', { cache: 'no-store' })
        if (!refreshed.ok) throw new Error()
        const data = await refreshed.json()
        setRows(data.providers)
      } catch { setError('操作已成功，但列表刷新失败，请点击页面顶部刷新。') }
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || busy) return
    const data = new FormData(event.currentTarget)
    void mutate(selected, 'PATCH', { ...Object.fromEntries(data), invoice: data.get('invoice') === 'true' })
  }
  const text = (key: string) => String(selected?.[key] ?? '')
  return <section className="admin-providers" aria-label="站点管理列表">
    <p className="admin-provider-intro">管理已收录站点的公开资料。启用不代表公开展示，仍需运营者选择公开且收录审核通过。</p>
    <div className="admin-provider-stats">{[['全部站点', rows.length], ['公开展示', rows.filter(visible).length], ['未公开', rows.filter(row => row.active && !visible(row)).length], ['已停用', rows.filter(row => !row.active).length]].map(([label, count]) => <article key={label}><span>{label}</span><strong>{count}</strong></article>)}</div>
    <div className="admin-provider-toolbar"><label className="admin-provider-search"><Search size={18} /><input aria-label="按站点名称筛选" placeholder="搜索站点名称…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="筛选展示状态" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option><option value="public">公开展示</option><option value="private">未公开</option><option value="disabled">已停用</option></select><span>共 {filtered.length} / {rows.length} 个站点</span>{(query || filter !== 'all') && <button className="button button-ghost" onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</button>}</div>
    {message && <p className="admin-provider-success" role="status"><CheckCircle2 size={16} />{message}</p>}{error && !selected && !action && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-table-wrap"><table><thead><tr><th>站点 / 运营者</th><th>模型与计费</th><th>展示状态</th><th>操作</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><strong>{row.name}</strong><a href={String(row.website)} target="_blank" rel="noreferrer">{row.website}<ExternalLink size={12} /></a><small>{row.submitter_login ? `@${row.submitter_login}` : '无关联运营者'} · #{row.id}</small></td><td><span className="admin-provider-models">{row.models}</span><small>{row.billingType || '计费方式未填写'} · {row.invoice == null ? '发票情况未填写' : row.invoice ? '支持发票' : '不支持发票'}</small></td><td><span className={`admin-badge ${!row.active ? 'rejected' : visible(row) ? 'approved' : 'pending'}`}>{statusLabel(row)}</span>{Boolean(row.pendingRevision) && <small>有待审核修改</small>}</td><td><div className="admin-actions"><button disabled={busy} onClick={() => { setSelected(row); setEditing(false); setDirty(false); setError('') }}>详情 / 编辑</button><button disabled={busy} onClick={() => { setAction({ row, kind: 'toggle' }); setError('') }}>{row.active ? '停用' : '启用'}</button><button disabled={busy} className="danger" onClick={() => { setAction({ row, kind: 'delete' }); setError('') }}>删除</button></div></td></tr>)}</tbody></table>{!filtered.length && <div className="admin-empty"><Globe2 size={28} /><p>{rows.length ? '没有符合条件的站点，请调整名称或状态筛选。' : '暂无管理站点，通过收录审核后会自动加入。'}</p></div>}</div>
    {selected && <SiteDialog title={`${editing ? '编辑资料' : '站点详情'} · ${selected.name}`} onClose={close}>
      <p className="site-dialog-notice">{editing ? '保存后直接更新公开资料和运营者资料，不改变审核状态或运营者的公开展示选择。Logo 请返回详情模式后单独保存。' : `当前状态：${statusLabel(selected)}。可查看全部公开资料，或切换到编辑模式。`}</p>
      {!selected.submission_id && <p className="site-dialog-notice">该历史站点没有关联收录资料，暂不支持完整资料编辑，仍可启停或删除。</p>}
      {Boolean(selected.pendingRevision) && <p className="form-error">该站点有待审核修改，请先到“站点审核 → 修改申请”处理，再编辑资料。</p>}
      <form className="site-edit-form" onSubmit={submit} onChange={() => setDirty(true)}><fieldset className="admin-provider-fields" disabled={!editing || busy}>
        <h3>基本信息</h3><div className="form-grid"><label>站点名称 *<input name="name" defaultValue={text('name')} required maxLength={255} /></label><label>成立时间 *<input name="foundedAt" type="date" defaultValue={text('foundedAt').slice(0, 10)} max={today} required /></label><label className="full">站点网址 *<input name="website" type="url" defaultValue={text('website')} required maxLength={2048} /></label><label className="full">网站介绍 *<textarea name="description" defaultValue={text('description')} required maxLength={10000} rows={3} /></label><label className="full">模型覆盖 *<textarea name="models" defaultValue={text('models')} required maxLength={10000} rows={2} /><small>多个厂商用顿号或逗号分隔</small></label></div>
        <h3>计费与发票</h3><div className="form-grid"><label>计费方式 *<select name="billingType" defaultValue={text('billingType')} required><option value="" disabled>请选择</option>{billingTypes.map(type => <option key={type}>{type}</option>)}</select></label><label>支持发票 *<select name="invoice" defaultValue={selected.invoice == null ? '' : String(Boolean(selected.invoice))} required><option value="" disabled>请选择</option><option value="true">支持</option><option value="false">不支持</option></select></label><label className="full">计费补充说明<textarea name="billingDetails" defaultValue={text('billingDetails')} maxLength={1000} rows={2} /></label><label className="full">公开价格说明<textarea name="pricing" defaultValue={text('pricing')} maxLength={10000} rows={3} /></label><label className="full">补充说明<textarea name="notes" defaultValue={text('notes')} maxLength={10000} rows={3} /></label></div>
      </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="site-dialog-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>关闭</button>{editing ? <button className="button" disabled={busy}>{busy ? '保存中…' : '保存资料'}</button> : <button type="button" className="button" disabled={Boolean(selected.pendingRevision) || !selected.submission_id} onClick={() => setEditing(true)}>编辑资料</button>}</div></form>
      {selected.submission_status === 'approved' && !editing && <SiteLogoSettings endpoint={`/api/admin/providers/${selected.id}/logo`} />}
    </SiteDialog>}
    {blocker.state === 'blocked' && <SiteDialog title="离开站点管理？" onClose={() => blocker.reset()}><p>{busy ? '请求正在处理中，请等待操作完成后再离开。' : '离开后将丢失未保存的资料。'}</p><div className="site-dialog-actions"><button className="button button-ghost" onClick={() => blocker.reset()}>留在页面</button><button className="button" disabled={busy} onClick={() => blocker.proceed()}>放弃修改并离开</button></div></SiteDialog>}
    {confirmClose && <SiteDialog title="放弃未保存的修改？" onClose={() => setConfirmClose(false)}><p>关闭后，本次尚未保存的资料将丢失。</p><div className="site-dialog-actions"><button className="button button-ghost" onClick={() => setConfirmClose(false)}>继续编辑</button><button className="button" onClick={() => { setConfirmClose(false); setDirty(false); setSelected(null) }}>放弃修改</button></div></SiteDialog>}
    {action && <SiteDialog title={action.kind === 'delete' ? '确认删除站点？' : `确认${action.row.active ? '停用' : '启用'}站点？`} onClose={() => { if (!busy) setAction(null) }}><p>{action.kind === 'delete' ? `“${action.row.name}”将永久删除，此操作不可撤销。` : action.row.active ? `停用“${action.row.name}”后，该站点不再公开展示。` : `启用“${action.row.name}”后，仅在审核通过且运营者已选择公开时展示。`}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="site-dialog-actions"><button className="button button-ghost" disabled={busy} onClick={() => setAction(null)}>取消</button><button className={`button ${action.kind === 'delete' ? 'danger' : ''}`} disabled={busy} onClick={() => void mutate(action.row, action.kind === 'delete' ? 'DELETE' : 'PATCH', action.kind === 'delete' ? undefined : { active: !action.row.active })}>{busy ? '处理中…' : '确认操作'}</button></div></SiteDialog>}
  </section>
}
