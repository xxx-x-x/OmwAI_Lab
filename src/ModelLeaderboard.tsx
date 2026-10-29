import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ChevronDown, RefreshCw, Search, Trophy } from 'lucide-react'
import { ModelBrandIcon } from './ModelBrandIcon'
import './ModelLeaderboard.css'

type ModelRanking = { id: string; name: string; creator: string; color: string; logo: string; contextWindowTokens: number; score: number; scoreEstimated: number; costPerTask: number | null; inputPrice: number | null; outputPrice: number | null; speed: number | null; latency: number | null; totalResponse: number | null; reasoning: number; openWeights: number }
type ModelSort = 'score' | 'speed' | 'contextWindowTokens' | 'costPerTask'
type ModelFilter = '全部模型' | '推理模型' | '开源权重'
type RankingResponse = { models: ModelRanking[]; latest: { modelCount: number; syncedAt: string; sourceUrl: string } | null }

export default function ModelLeaderboardPage() {
  const [rankings, setRankings] = useState<RankingResponse>({ models: [], latest: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [creator, setCreator] = useState('全部厂商')
  const [filter, setFilter] = useState<ModelFilter>('全部模型')
  const [sort, setSort] = useState<ModelSort>('score')
  const loadRankings = useCallback(() => {
    setLoading(true)
    setError('')
    fetch('/api/model-rankings')
      .then(async response => { if (!response.ok) throw new Error('排行榜加载失败'); return response.json() as Promise<RankingResponse> })
      .then(setRankings)
      .catch(error => setError(error instanceof Error ? error.message : '排行榜加载失败'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadRankings() }, [loadRankings])
  const creators = useMemo(() => ['全部厂商', ...new Set(rankings.models.map(model => model.creator))], [rankings.models])
  const visibleModels = useMemo(() => rankings.models
    .filter(model => creator === '全部厂商' || model.creator === creator)
    .filter(model => filter === '全部模型' || filter === '推理模型' && Boolean(model.reasoning) || filter === '开源权重' && Boolean(model.openWeights))
    .filter(model => `${model.name}${model.creator}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'costPerTask' ? (a.costPerTask ?? Number.POSITIVE_INFINITY) - (b.costPerTask ?? Number.POSITIVE_INFINITY) : (b[sort] ?? -1) - (a[sort] ?? -1)), [creator, filter, query, rankings.models, sort])
  const [requestedPage, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(visibleModels.length / 30))
  const page = Math.min(requestedPage, pageCount)
  const pagedModels = visibleModels.slice((page - 1) * 30, page * 30)
  const sortLabels: Record<ModelSort, string> = { score: '能力指数', speed: '输出速度', contextWindowTokens: '上下文', costPerTask: '任务成本' }

  return <section className="model-page"><div className="container model-hero"><div><span className="model-kicker"><Trophy size={15} /> MODEL LEADERBOARD</span><h1>模型能力排行榜</h1><p>聚焦模型本身的综合能力，对智能水平、推理能力与上下文能力进行直观比较。无需登录即可查看。</p></div><div className="model-hero-stat"><small>收录模型</small><strong>{rankings.models.length}</strong><span>{rankings.latest ? `更新于 ${new Date(rankings.latest.syncedAt).toLocaleDateString('zh-CN')}` : '等待同步'}</span></div></div><div className="container model-toolbar"><label className="model-search"><Search size={18} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="搜索模型或厂商" /></label><div className="select-wrap"><select value={creator} onChange={event => { setCreator(event.target.value); setPage(1) }} aria-label="按厂商筛选">{creators.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div><div className="model-filter-tabs">{(['全部模型', '推理模型', '开源权重'] as ModelFilter[]).map(item => <button className={filter === item ? 'active' : ''} onClick={() => { setFilter(item); setPage(1) }} key={item}>{item}</button>)}</div></div><div className="container model-board"><div className="model-board-title"><div><h2>综合能力排名</h2><p>能力指数越高，表示模型在多项公开基准中的综合表现越强</p></div><span>共 {visibleModels.length} 个结果</span></div><div className="model-table-scroll"><table className="model-table"><thead><tr><th>排名</th><th>模型</th><th><SortButton name="能力指数" active={sort === 'score'} onClick={() => setSort('score')} /></th><th><SortButton name="上下文" active={sort === 'contextWindowTokens'} onClick={() => setSort('contextWindowTokens')} /></th><th><SortButton name="输出速度" active={sort === 'speed'} onClick={() => setSort('speed')} /></th><th><SortButton name="任务成本" active={sort === 'costPerTask'} onClick={() => setSort('costPerTask')} /></th><th>特性</th></tr></thead><tbody>{pagedModels.map((model, index) => <ModelRow model={model} rank={(page - 1) * 30 + index + 1} key={model.id} />)}</tbody></table>{loading && <div className="model-empty"><RefreshCw className="spinning" size={30} />正在读取排行榜…</div>}{!loading && !visibleModels.length && <div className={`model-empty ${error ? 'model-error' : ''}`}><Search size={30} /><strong>{error || '没有匹配的模型'}</strong><span>{error ? '排行榜数据暂时无法读取，请稍后重试。' : rankings.models.length ? '请尝试其他关键词或筛选条件。' : '数据库中暂无排行榜数据，请管理员先执行同步。'}</span>{error && <button className="model-retry" type="button" onClick={loadRankings}><RefreshCw size={14} />重新加载</button>}</div>}</div><div className="pricing-pagination" aria-label="排行榜分页"><button className="button button-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {pageCount} 页 · 每页 30 条</span><button className="button button-ghost" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一页</button></div><div className="model-note"><span>当前按<strong>{sortLabels[sort]}</strong>排序</span><small>{rankings.latest ? `数据来源：Artificial Analysis · 本地数据库同步于 ${new Date(rankings.latest.syncedAt).toLocaleString('zh-CN')}` : '排行榜数据存储于本地数据库'}</small></div></div></section>
}

function SortButton({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{name} <ArrowDown size={13} /></button>
}

function ModelRow({ model, rank }: { model: ModelRanking; rank: number }) {
  const context = model.contextWindowTokens >= 1_000_000 ? `${Number((model.contextWindowTokens / 1_000_000).toFixed(2))}M` : `${Math.round(model.contextWindowTokens / 1000)}K`
  return <tr className="model-table-row"><td><span className={`model-rank rank-${rank}`}>{rank < 4 && <Trophy size={16} />}{rank}</span></td><td><div className="model-identity"><i style={{ color: model.color }}><ModelBrandIcon brand={model.creator} model={model.name} size={25} /></i><div><strong>{model.name}</strong><small>{model.creator}{model.reasoning ? ' · 推理模型' : ''}</small></div></div></td><td><div className="score-cell"><strong>{Math.round(model.score)}{model.scoreEstimated ? '*' : ''}</strong><span><i style={{ width: `${Math.min(100, model.score)}%` }} /></span></div></td><td><span className="metric"><strong>{context}</strong><small>tokens</small></span></td><td><span className="metric"><strong>{model.speed == null ? '—' : Math.round(model.speed)}</strong><small>tokens/s</small></span></td><td><span className="metric"><strong>{model.costPerTask == null ? '—' : `$${model.costPerTask.toFixed(2)}`}</strong><small>per task</small></span></td><td><div className="model-badges">{Boolean(model.reasoning) && <span>推理</span>}{Boolean(model.openWeights) && <span>开源</span>}{!model.reasoning && !model.openWeights && <span>通用</span>}</div></td></tr>
}
