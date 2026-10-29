import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import SiteDialog from './SiteDialog'
import './AdminModelPrices.css'

type Row = { source_id: string; provider_id: string; model_id: string; name: string; provider_name: string; input_price: number | null; output_price: number | null; cached_input_price: number | null; release_date: string | null; source_url: string; source_name: string; billing_unit: string | null; has_override: number; synced_input_price: number | null; synced_output_price: number | null; synced_cached_input_price: number | null; synced_release_date: string | null; synced_source_name: string | null; synced_source_url: string }
const value = (number: number | null) => number == null ? '未知' : String(number)

export default function AdminModelPrices({ onEditingChange }: { onEditingChange: (locked: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Row | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const blocker = useBlocker(dirty || busy)
  useEffect(() => { onEditingChange(Boolean(selected) || creating || busy); return () => onEditingChange(false) }, [selected, creating, busy, onEditingChange])
  useEffect(() => {
    if (!dirty && !busy) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, busy])
  useEffect(() => {
    const controller = new AbortController()
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize the list request status when its server query changes
    setLoading(true); setError('')
    void fetch(`/api/admin/model-prices?${new URLSearchParams({ q: search, page: String(page), pageSize: '25' })}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '加载失败')
      if (!controller.signal.aborted) { setRows(data.rows); setTotal(data.total) }
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '加载失败') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [search, page, revision])
  const close = () => { if (!busy && (!dirty || window.confirm('放弃尚未保存的修改？'))) { setSelected(null); setCreating(false); setDirty(false); setConfirmReset(false) } }
  const save = async (form: HTMLFormElement | null) => {
    if ((!selected && !creating) || busy) return
    const fields = form ? new FormData(form) : null
    const number = (key: string) => { const text = String(fields?.get(key) ?? '').trim(); return text ? Number(text) : null }
    const body = { sourceId: creating ? 'manual' : selected!.source_id, providerId: creating ? fields?.get('providerId') : selected!.provider_id, modelId: creating ? fields?.get('modelId') : selected!.model_id, ...(creating ? { name: fields?.get('name'), providerName: fields?.get('providerName'), billingUnit: fields?.get('billingUnit'), modality: fields?.get('modality'), reasoning: fields?.get('reasoning') === 'on', openWeights: fields?.get('openWeights') === 'on' } : {}), ...(fields ? { inputPrice: number('inputPrice'), outputPrice: number('outputPrice'), cacheReadPrice: number('cacheReadPrice'), releaseDate: fields.get('releaseDate') || null, sourceName: fields.get('sourceName'), sourceUrl: fields.get('sourceUrl') } : {}) }
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/admin/model-prices', { method: creating ? 'POST' : fields ? 'PUT' : 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '保存失败')
      setSelected(null); setCreating(false); setDirty(false); setConfirmReset(false); setRevision(number => number + 1)
      setMessage(creating ? '人工模型已创建，公开定价目录将读取该记录。' : fields ? '人工修正已保存，后续同步不会覆盖；公开价格目录将读取修正值。' : '人工修正已清除，已恢复底层原值。')
    } catch (error) { setError(error instanceof Error ? error.message : '网络异常，请重试') }
    finally { setBusy(false) }
  }
  return <section className="admin-model-prices" aria-label="模型价格与发布日期管理">
    <p className="admin-model-summary">按发布日期从新到旧排列，未知日期排在最后。价格为空表示未知，0 表示免费。</p>
    <form className="admin-model-toolbar" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); setRevision(number => number + 1) }}><input aria-label="搜索模型或提供商" placeholder="模型名称、模型 ID、提供商或来源" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /><button className="button" disabled={loading}>搜索</button><button className="button button-ghost" type="button" disabled={loading} onClick={() => setRevision(number => number + 1)}>刷新列表</button><button className="button" type="button" disabled={busy} onClick={() => { setSelected({ source_id: 'manual', provider_id: '', model_id: '', name: '', provider_name: '', input_price: null, output_price: null, cached_input_price: null, release_date: null, source_url: '', source_name: '', billing_unit: '百万 Tokens', has_override: 0, synced_input_price: null, synced_output_price: null, synced_cached_input_price: null, synced_release_date: null, synced_source_name: null, synced_source_url: '' }); setCreating(true); setDirty(false); setError('') }}>新增模型</button></form>
    {message && <p role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p role="status">正在加载模型资料…</p> : <><div className="admin-table-wrap"><table><thead><tr><th>模型 / 精确身份</th><th>输入 / 输出 / 缓存价格</th><th>发布日期 / 来源</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={JSON.stringify([row.source_id, row.provider_id, row.model_id])}><td><strong>{row.name}</strong><small>{row.source_id} / {row.provider_id} / {row.model_id}</small></td><td>{value(row.input_price)} / {value(row.output_price)} / {value(row.cached_input_price)}<small>USD · {row.billing_unit || '每百万 Tokens'}</small></td><td>{row.release_date?.slice(0, 10) || '未知'}<small>{row.source_name || row.source_id} · {row.has_override ? '人工修正' : row.source_id === 'manual' ? '人工录入' : '同步数据'}</small></td><td><button className="button button-ghost" onClick={() => { setSelected(row); setDirty(false); setConfirmReset(false); setError('') }}>编辑 / 恢复</button></td></tr>)}</tbody></table>{!rows.length && <p>没有匹配的记录，请调整搜索条件或新增真实模型记录。</p>}</div><div className="admin-model-toolbar"><button className="button button-ghost" disabled={page <= 1} onClick={() => setPage(number => number - 1)}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil(total / 25))} 页 · 共 {total} 条</span><button className="button button-ghost" disabled={page * 25 >= total} onClick={() => setPage(number => number + 1)}>下一页</button></div></>}
    {selected && <SiteDialog kicker="模型价格管理" title={creating ? '新增模型' : `编辑 · ${selected.name}`} onClose={close}><div className="admin-model-editor">
      {!creating && <div className="admin-model-identity"><strong>{selected.provider_name || selected.provider_id}</strong><code>{selected.model_id}</code><span>{selected.has_override ? '已人工修正' : selected.source_id === 'manual' ? '人工录入' : '同步数据'}</span></div>}
      <p className="admin-model-hint">价格单位：USD · {selected.billing_unit || '每百万 Tokens'}。留空为未知，0 为免费。</p>
      <form className="admin-model-form" onChange={() => setDirty(true)} onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}><fieldset disabled={busy}>{creating && <><label>提供商 ID *<input name="providerId" required maxLength={100} placeholder="真实提供商 ID，如 openai" /></label><label>API 模型 ID *<input name="modelId" required maxLength={191} placeholder="实际调用 ID，不是排行榜 slug" /></label><label>模型名称 *<input name="name" required maxLength={255} /></label><label>公司 / 提供商名称 *<input name="providerName" required maxLength={255} /></label><label>计费单位（USD） *<input name="billingUnit" required maxLength={128} defaultValue="百万 Tokens" /></label><label>模态<select name="modality" defaultValue="text"><option value="text">文本</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select></label><label><input type="checkbox" name="reasoning" />深度思考</label><label><input type="checkbox" name="openWeights" />开放权重</label></>}{(['inputPrice', 'outputPrice', 'cacheReadPrice'] as const).map((key, index) => <label key={key}>{['输入价格', '输出价格', '缓存读取价格'][index]}<input type="number" min="0" step="any" name={key} defaultValue={[selected.input_price, selected.output_price, selected.cached_input_price][index] ?? ''} placeholder="未知（留空）" /></label>)}<label>发布日期<input type="date" name="releaseDate" defaultValue={selected.release_date?.slice(0, 10) || ''} min="1000-01-01" /></label><label>核验来源 / 依据 *<input name="sourceName" required maxLength={255} defaultValue={selected.source_name || ''} /></label><label>来源链接 *<input type="url" name="sourceUrl" required maxLength={2048} defaultValue={selected.source_url} /></label></fieldset>{!creating && <details className="admin-model-original"><summary>查看原始数据{selected.has_override ? ' / 恢复预览' : ''}</summary><dl><div><dt>输入 / 输出 / 缓存</dt><dd>{value(selected.synced_input_price)} / {value(selected.synced_output_price)} / {value(selected.synced_cached_input_price)}</dd></div><div><dt>发布日期</dt><dd>{selected.synced_release_date?.slice(0, 10) || '未知'}</dd></div><div><dt>来源</dt><dd>{selected.synced_source_name || '未提供'}</dd></div><div><dt>来源链接</dt><dd>{selected.synced_source_url || '未提供'}</dd></div><div><dt>记录来源</dt><dd>{selected.source_id} / {selected.provider_id}</dd></div></dl></details>}
      {confirmReset && <div className="admin-model-reset" role="alert"><strong>确认恢复原始数据？</strong><p>将恢复原始价格、发布日期和来源，清除人工修正及未保存的修改。</p><div><button type="button" className="button" disabled={busy} onClick={() => void save(null)}>{busy ? '恢复中…' : '确认恢复'}</button><button type="button" className="button button-ghost" disabled={busy} onClick={() => setConfirmReset(false)}>取消恢复</button></div></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="admin-model-actions">{Boolean(selected.has_override) && <button type="button" className="button button-ghost admin-model-restore" disabled={busy || confirmReset} onClick={() => setConfirmReset(true)}>恢复原始数据</button>}<button type="button" className="button button-ghost" disabled={busy} onClick={close}>取消</button><button className="button" disabled={busy || confirmReset}>{busy ? '处理中…' : creating ? '创建模型' : '保存修改'}</button></div></form></div></SiteDialog>}
    {blocker.state === 'blocked' && <SiteDialog title="尚有未保存的修改" onClose={() => blocker.reset()}><p>是否放弃编辑并离开？</p><button className="button" disabled={busy} onClick={() => blocker.proceed()}>放弃并离开</button><button className="button button-ghost" onClick={() => blocker.reset()}>继续编辑</button></SiteDialog>}
  </section>
}
