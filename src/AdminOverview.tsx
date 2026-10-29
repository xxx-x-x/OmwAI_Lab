import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowUpRight, Clock3, Eye, FileCheck2, Globe2, MousePointerClick, RefreshCw, Users } from 'lucide-react'
import SiteDialog from './SiteDialog'
import './MySites.css'
import './AdminOverview.css'

type Range = 'today' | 'yesterday' | '7d' | '30d'
type Dashboard = {
  range: Range; startDate: string; endDate: string; collectedSince: string | null
  totals: { pv: number; uv: number; outboundClicks: number; outboundVisitors: number; conversionRate: number | null; newUsers: number; newSubmissions: number; publicProviders: number; localUsers: number }
  pending: { submissions: number; revisions: number; quotes: number; oldestAt: string | null; overdue: number }
  trend: Array<{ date: string; pv: number; uv: number; outboundClicks: number }>
  topProviders: Array<{ id: string | number; name: string; views: number; visitors: number; outboundClicks: number; outboundVisitors: number; conversionRate: number | null }>
  topPages: Array<{ path: string; pv: number; uv: number }>
  health: { rankingSyncedAt: string | null; rankingModels: number; pricesSyncedAt: string | null; priceModels: number; pricingFailures: number }
  recentLogs: Array<{ id: number; action: string; admin_name: string; created_at: string }>
}
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无记录'
const pageName = (path: string) => ({ '/': '服务目录', '/directory': '服务目录', '/models': '模型排行榜', '/pricing': '模型定价', '/pricing/model': '模型价格详情', '/welcome': '网站介绍' }[path] || '站点详情')

export default function AdminOverview({ onNavigate }: { onNavigate: (section: 'submissions' | 'site-revisions' | 'site-quotes' | 'users' | 'providers' | 'logs') => void }) {
  const [range, setRange] = useState<Range>('7d')
  const [showDailyDetails, setShowDailyDetails] = useState(false)
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [updatedAt, setUpdatedAt] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      setLoading(true); setError('')
      try {
        const response = await fetch(`/api/admin/dashboard?range=${range}`, { signal: controller.signal })
        const result = await response.json()
        if (!response.ok || !result.analytics) throw new Error(result.error || '概览数据暂不可用')
        if (!controller.signal.aborted) { setData(result.analytics); setUpdatedAt(new Date().toLocaleTimeString('zh-CN')) }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '加载失败') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [range, refresh])
  const t = data?.totals
  const max = Math.max(1, ...(data?.trend.map(day => day.pv) || []), ...(data?.trend.map(day => day.outboundClicks) || []))
  return <div className="overview">
    <div className="overview-toolbar"><div><strong>运营工作台</strong><p>访问、导流与审核，一处掌握</p></div><div className="overview-controls"><label>统计周期<select value={range} onChange={event => setRange(event.target.value as Range)}><option value="today">今日</option><option value="yesterday">昨日</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></label><button className="button button-ghost" disabled={loading} onClick={() => setRefresh(value => value + 1)} aria-label="刷新运营数据"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div></div>
    {error && <div className="form-error" role="alert">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>重试</button></div>}
    {loading ? <p className="admin-loading" role="status">正在加载运营数据…</p> : !error && data && t && <>
      <p className="overview-caption">{data.startDate} 至 {data.endDate} · 北京时间 · 更新于 {updatedAt}</p>
      <div className="overview-pending"><div><FileCheck2 size={20} /><strong>审核待办</strong></div><button onClick={() => onNavigate('submissions')}>收录 <b>{number(data.pending.submissions)}</b></button><button onClick={() => onNavigate('site-revisions')}>修改 <b>{number(data.pending.revisions)}</b></button><button onClick={() => onNavigate('site-quotes')}>报价 <b>{number(data.pending.quotes)}</b></button><span><Clock3 size={14} /> 超过 48 小时：{number(data.pending.overdue)} 项</span></div>
      <div className="overview-metrics">{[
        { label: '访问人数 UV', value: data.collectedSince ? number(t.uv) : '—', note: '所选周期匿名访客去重', icon: Users },
        { label: '浏览量 PV', value: data.collectedSince ? number(t.pv) : '—', note: '仅前台有效页面浏览', icon: Eye },
        { label: '官网跳转次数', value: data.collectedSince ? number(t.outboundClicks) : '—', note: `${number(t.outboundVisitors)} 位访客发起跳转`, icon: MousePointerClick },
        { label: '全站导流转化率', value: percent(t.conversionRate), note: '浏览后跳转的访客 / 前台 UV', icon: ArrowUpRight },
        { label: '新增本地账号', value: number(t.newUsers), note: `累计本地账号 ${number(t.localUsers)}`, icon: Users, action: () => onNavigate('users') },
        { label: '新增收录申请', value: number(t.newSubmissions), note: '所选周期成功提交的申请', icon: FileCheck2, action: () => onNavigate('submissions') },
        { label: '公开展示站点', value: number(t.publicProviders), note: '当前已通过、启用且公开的站点', icon: Globe2, action: () => onNavigate('providers') },
        { label: '待处理申请', value: number(data.pending.submissions + data.pending.revisions + data.pending.quotes), note: `最早提交：${time(data.pending.oldestAt)}`, icon: Clock3 },
      ].map(item => <article className="overview-metric" key={item.label}><div><span>{item.label}</span><item.icon size={18} /></div><strong>{item.value}</strong><small>{item.note}</small>{item.action && <button className="overview-card-link" onClick={item.action} aria-label={`查看${item.label}`}><ArrowUpRight size={16} /></button>}</article>)}</div>
      <div className="overview-notice">{data.collectedSince ? `流量采集始于 ${time(data.collectedSince)}，此前的历史数据不可追溯。` : '流量尚未开始采集，有效前台访问后将逐步生成数据。'} UV 为有效页面浏览的浏览器匿名标识去重，不等于真实自然人数。第三方登录暂不计入本地账号。</div>
      <div className="overview-grid"><section className="overview-panel overview-wide"><div className="overview-panel-heading"><h2>访问与导流趋势</h2><span>每日 PV / UV / 官网跳转</span></div><div className="overview-legend"><span>● 浏览量</span><span>● 官网跳转</span></div><div className="overview-chart" aria-label="每日访问与导流柱状图">{data.trend.map(day => <div className="overview-day" key={day.date}><div className="overview-bars" title={`${day.date}：PV ${day.pv}，UV ${day.uv}，官网跳转 ${day.outboundClicks}`}><i style={{ height: `${day.pv / max * 100}%` }} /><i style={{ height: `${day.outboundClicks / max * 100}%` }} /></div><small>{day.date.slice(5)}</small></div>)}</div><button type="button" className="overview-daily-trigger" aria-haspopup="dialog" onClick={() => setShowDailyDetails(true)}>查看每日明细（含 UV）<ArrowUpRight size={15} /></button>{showDailyDetails && <SiteDialog title="每日访问与导流明细" kicker="数据概览" onClose={() => setShowDailyDetails(false)}><p className="overview-caption">{data.startDate} 至 {data.endDate} · 北京时间</p><div className="overview-table-wrap"><table><thead><tr><th>日期</th><th>PV</th><th>UV</th><th>官网跳转</th></tr></thead><tbody>{data.trend.map(day => <tr key={day.date}><td>{day.date}</td><td>{number(day.pv)}</td><td>{number(day.uv)}</td><td>{number(day.outboundClicks)}</td></tr>)}</tbody></table></div></SiteDialog>}</section>
      <section className="overview-panel"><div className="overview-panel-heading"><h2>热门页面</h2><span>按浏览量</span></div>{!data.topPages.length ? <p className="overview-empty">暂无访问数据</p> : data.topPages.map(page => <div className="overview-list-row" key={page.path}><div><Link to={page.path}>{pageName(page.path)}</Link><small>{page.path}</small></div><div><strong>{number(page.pv)} PV</strong><small>{number(page.uv)} UV</small></div></div>)}</section></div>
      <section className="overview-panel"><div className="overview-panel-heading"><h2>热门站点</h2><span>按官网跳转人数排序 · 小样本仅供参考</span></div><div className="overview-table-wrap"><table><thead><tr><th>站点</th><th>详情 PV</th><th>详情 UV</th><th>跳转次数</th><th>跳转人数</th><th>详情导流率</th></tr></thead><tbody>{data.topProviders.map(site => <tr key={site.id}><td>{site.name}</td><td>{number(site.views)}</td><td>{number(site.visitors)}</td><td>{number(site.outboundClicks)}</td><td>{number(site.outboundVisitors)}</td><td>{percent(site.conversionRate)}</td></tr>)}</tbody></table></div>{!data.topProviders.length && <p className="overview-empty">暂无站点浏览或导流数据</p>}</section>
      <div className="overview-grid"><section className="overview-panel"><div className="overview-panel-heading"><h2>数据健康</h2><Activity size={18} /></div><div className="overview-list-row"><div><strong>模型能力排行榜</strong><small>最近成功同步：{time(data.health.rankingSyncedAt)}</small></div><b>{number(data.health.rankingModels)} 个</b></div><div className="overview-list-row"><div><strong>模型定价</strong><small>最近成功同步：{time(data.health.pricesSyncedAt)}</small></div><b>{number(data.health.priceModels)} 条</b></div><div className="overview-list-row"><div><strong>站点报价同步异常</strong><small>已启用同步、最近尝试失败的站点</small></div><b>{number(data.health.pricingFailures)} 个</b></div></section><section className="overview-panel"><div className="overview-panel-heading"><h2>最近操作</h2><button onClick={() => onNavigate('logs')}>全部日志 →</button></div>{data.recentLogs.map(log => <div className="overview-list-row" key={log.id}><div><strong>{log.action}</strong><small>{log.admin_name}</small></div><small>{time(log.created_at)}</small></div>)}{!data.recentLogs.length && <p className="overview-empty">暂无操作记录</p>}</section></div>
      <details className="overview-panel overview-details"><summary>统计口径与隐私说明</summary><p>访问与导流按所选周期统计；公开站点、待审核和同步健康为当前状态。仅在“确认并继续”时统计官网跳转，不代表外部网站加载、注册或成交。不统计后台、登录页与接口请求，不采集表单正文、密钥或 URL 查询参数。同一浏览器跨设备、清除存储后无法准确合并；明显机器人会被过滤，但客户端统计不能完全消除刷量。转化率只计入所选周期内先浏览、后跳转的匹配访客；分母为零显示“—”。管理员登录状态下的访问不参与采集。原始事件保留约 90 天，由有效访问触发分批清理。</p></details>
    </>}
  </div>
}
