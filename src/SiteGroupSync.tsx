import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

async function syncSiteGroups(siteId: number) {
  const response = await fetch(`/api/user/sites/${siteId}/groups/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '分组同步失败')
  return result
}

export default function SiteGroupSync({ siteId, onSynced, disabled = false }: { siteId: number; onSynced?: () => Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const sync = async () => {
    setBusy(true); setMessage(''); setError('')
    try {
      await syncSiteGroups(siteId)
      await onSynced?.()
      setMessage('分组已同步并保存，报价未改动。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '同步失败，请稍后重试') }
    finally { setBusy(false) }
  }
  return <div className="site-group-sync"><button type="button" className="button button-ghost button-small" disabled={busy || disabled} onClick={() => void sync()}><RefreshCw size={14} />{busy ? '同步中…' : '同步分组'}</button>{error && <span className="form-error" role="alert">{error}</span>}{message && <span role="status">{message}</span>}</div>
}
