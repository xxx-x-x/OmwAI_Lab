import { useCallback, useEffect, useState } from 'react'
import SiteDialog from './SiteDialog'
import { RevisionComparison } from './MySites'
import type { ManagedSite, SiteRevision } from './siteRevisionTypes'

type Review = SiteRevision & { siteId: number; siteName?: string; submitter_login?: string; current: ManagedSite }
export default function AdminSiteRevisions({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<Review[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const response = await fetch('/api/admin/site-revisions', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '修改审核列表加载失败')
      setRows(result.revisions)
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常') }
  }, [])
  // oxlint-disable-next-line react/set-state-in-effect -- load the API snapshot on mount
  useEffect(() => { void load() }, [load, refreshKey])
  const selected = rows.find(row => row.id === selectedId)
  const review = async (status: 'approved' | 'rejected') => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/admin/site-revisions/${selected.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, review_note: note }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '审核失败')
      setSelectedId(null); await load()
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常') }
    finally { setBusy(false) }
  }
  return <section><div className="admin-heading"><div><h2>修改申请</h2><p>审核通过前，目录始终保留原收录版本；通过后完整替换公开资料。</p></div></div>{error && !selected && <p className="form-error" role="alert">{error}</p>}<div className="admin-table-wrap"><table><thead><tr><th>站点</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.current?.name || row.siteName || row.proposal.name}</strong><small>{row.proposal.website}</small></td><td>{row.createdAt || '—'}</td><td><span className={`admin-badge ${row.status}`}>{row.status === 'pending' ? '待审核' : row.status === 'approved' ? '已通过' : row.status === 'withdrawn' ? '已撤回' : '已驳回'}</span></td><td><div className="admin-actions"><button type="button" onClick={() => { setSelectedId(row.id); setNote(''); setError('') }}>{row.status === 'pending' ? '查看并审核' : '查看'}</button></div></td></tr>)}</tbody></table>{!rows.length && <p className="admin-empty">暂无站点修改申请</p>}</div>{selected && <SiteDialog title={`审核修改 · ${selected.proposal.name}`} onClose={() => { if (!busy) setSelectedId(null) }}><p className="site-dialog-notice">核对当前已通过版本与本次修改。驳回不会影响线上站点；通过后新资料才会生效。</p><RevisionComparison site={selected.current || {}} proposal={selected.proposal} />{selected.status === 'pending' ? <><label className="billing-settings">审核说明<textarea style={{ width: '100%', marginTop: 12 }} rows={3} maxLength={10000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="可填写需要站点运营者调整的内容" /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="site-dialog-actions"><button type="button" className="button button-ghost danger" disabled={busy} onClick={() => void review('rejected')}>驳回修改</button><button type="button" className="button" disabled={busy} onClick={() => void review('approved')}>{busy ? '处理中…' : '通过并更新公开资料'}</button></div></> : <p>审核说明：{selected.reviewNote || '无'}</p>}</SiteDialog>}</section>
}
