import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ModelBrandIcon } from './ModelBrandIcon'
import { SiteComparison } from './SiteQuotes'

type ModelPrice = {
  id: string; modelId: string; name: string; company: string; family: string
  capabilities: { label: string; description: string }[]
  modality: 'text' | 'image' | 'video'; billingUnit: string; pricingDetails: string
  priceCheckedAt?: string; releaseDate: string | null; priceSource: string
  inputPrice: number | null; outputPrice: number | null; cacheReadPrice: number | null; sourceUrl: string
}
type Response = { models: ModelPrice[]; latest: { syncedAt: string } | null }

export default function ModelPriceDetail() {
  const [params] = useSearchParams()
  const location = useLocation()
  const state = location.state as { returnTo?: string; scrollY?: number } | null
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/model-prices', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('模型定价加载失败')
      return response.json() as Promise<Response>
    }).then(setData).catch(() => { if (!controller.signal.aborted) setError('模型定价加载失败，请稍后重试。') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])
  const load = () => { setLoading(true); setError(''); setAttempt(value => value + 1) }
  const model = data?.models.find(item => item.id === params.get('id'))
  const back = <Link className="model-detail-back" to={state?.returnTo || '/pricing'} state={{ scrollY: state?.scrollY }}><ArrowLeft size={16} /> 返回模型定价</Link>
  const money = (value: number | null) => value == null ? '暂无报价' : `$${Number(value.toFixed(4))}`
  return <section className="model-detail-page"><div className="container">
    {back}
    {loading ? <div className="price-empty"><RefreshCw className="spin" /><strong>正在加载模型详情…</strong></div> : error ? <div className="price-empty" role="alert"><strong>{error}</strong><button className="inline-retry" type="button" onClick={load}><RefreshCw size={14} />重新加载</button></div> : !model ? <div className="price-empty"><strong>未找到该模型</strong><span>模型可能已下架或链接已失效。</span></div> : <>
      <header className="model-detail-header"><div className="model-detail-icon"><ModelBrandIcon brand={model.family} model={model.name} size={32} /></div><div><span className="kicker">模型详情</span><h1>{model.name}</h1><p>{model.company} · {model.modelId}</p><div className="price-tags">{model.capabilities.length ? model.capabilities.map(capability => <span key={capability.label} title={capability.description}>{capability.label}</span>) : <span>能力未说明</span>}</div></div></header>
      <div className="model-detail-grid"><article className="model-detail-card"><h2>价格明细</h2><div className="model-detail-prices">{([['输入价格', model.inputPrice], ['输出价格', model.outputPrice], ['缓存读取价格', model.cacheReadPrice]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value)}</strong>{value != null && <small>美元 / {model.billingUnit}</small>}</div>)}</div><p className="model-detail-muted">{model.pricingDetails || '暂无更详细的计费说明。'}</p></article>
      <article className="model-detail-card"><h2>基本信息</h2><dl><div><dt>模型 ID</dt><dd>{model.modelId}</dd></div><div><dt>厂商</dt><dd>{model.company}</dd></div><div><dt>模态</dt><dd>{{ text: '文本', image: '图片', video: '视频' }[model.modality] ?? '未说明'}</dd></div><div><dt>发布时间</dt><dd>{model.releaseDate || '暂无数据'}</dd></div></dl></article></div>
      <SiteComparison modelId={model.modelId} />
    </>}
  </div></section>
}

