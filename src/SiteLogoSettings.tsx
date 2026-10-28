import { useEffect, useId, useState } from 'react'

type Settings = { customUrl: string; revision: number; status: string; hasImage: boolean; digest: string | null }
export default function SiteLogoSettings({ endpoint }: { endpoint: string }) {
  const inputId = useId()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState('')
  const [message, setMessage] = useState('')
  const [previewStatus, setPreviewStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(endpoint, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '图标设置加载失败')
      if (!controller.signal.aborted) { setSettings(result); setUrl(result.customUrl) }
    }).catch(error => { if (!controller.signal.aborted) setMessage(String(error.message)) })
    return () => controller.abort()
  }, [endpoint])
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    if (!url.trim() || url === settings?.customUrl) return () => controller.abort()
    const timer = setTimeout(async () => {
      setPreviewStatus('预览加载中…')
      try {
        const response = await fetch(`${endpoint}/preview`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
        if (!response.ok) { const result = await response.json(); throw new Error(result.error || '预览失败') }
        const blob = await response.blob()
        if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setPreview(objectUrl); setPreviewStatus('预览未保存') }
      } catch (error) { if (!controller.signal.aborted) setPreviewStatus(error instanceof Error ? error.message : '预览失败') }
    }, 600)
    return () => { clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [url, endpoint, settings?.customUrl])
  const save = async (refetch = false) => {
    if (!settings) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(endpoint + (refetch ? '/refetch' : ''), { method: refetch ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, revision: settings.revision }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '保存失败')
      setPreview(''); setPreviewStatus(''); setUrl(refetch ? settings.customUrl : url)
      setMessage(result.message)
    } catch (error) { setMessage(error instanceof Error ? error.message : '请求失败') }
    finally {
      try {
        const response = await fetch(endpoint, { cache: 'no-store' })
        if (response.ok) { const result = await response.json() as Settings; setSettings(result) }
      } catch { setMessage('图标设置重新加载失败，请刷新页面后重试') } finally { setBusy(false) }
    }
  }
  return <fieldset className="site-logo-settings" disabled={busy || !settings}><legend>站点 Logo</legend><div className="site-logo-preview">{preview || settings?.hasImage ? <img src={preview || `${endpoint}/image?v=${settings?.digest ?? ''}`} alt="站点 Logo 预览" width={48} height={48} /> : <span>暂无图标</span>}</div><label htmlFor={inputId}>自定义 Logo URL</label><input id={inputId} type="url" maxLength={2048} value={url} placeholder="https://example.com/logo.png" onChange={event => { setPreview(''); setPreviewStatus(''); setUrl(event.target.value) }} /><small>输入后自动预览，保存后生效；留空保存恢复自动发现。不支持上传或 SVG。</small><div className="admin-actions"><button type="button" onClick={() => void save()} disabled={!settings || busy}>保存 Logo</button><button type="button" onClick={() => void save(true)} disabled={!settings || busy}>重新抓取已保存图标</button></div><p role="status">{busy ? '抓取并保存中…' : message || (settings?.status === 'failed' ? '上次抓取失败，可重新抓取；已有图标保留。' : '')}</p>{previewStatus && <p role="status">{previewStatus}</p>}</fieldset>
}
