type Identity = { visitorId: string; sessionId: string; lastSeen: number }
let identity: Identity | undefined
const publicPath = (path: string) => /^(?:\/|\/directory|\/models|\/pricing|\/pricing\/model|\/welcome|\/provider\/managed-\d+)$/.test(path)

function visitorIdentity(): Identity {
  const now = Date.now()
  try {
    const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    const storedVisitor = localStorage.getItem('omwai-visitor')
    const visitorId = validId(storedVisitor) ? storedVisitor : crypto.randomUUID()
    localStorage.setItem('omwai-visitor', visitorId)
    const saved = JSON.parse(sessionStorage.getItem('omwai-analytics-session') || 'null') as Identity | null
    identity = { visitorId, sessionId: saved && validId(saved.sessionId) && Number.isFinite(saved.lastSeen) && now >= saved.lastSeen && now - saved.lastSeen < 30 * 60_000 ? saved.sessionId : crypto.randomUUID(), lastSeen: now }
    sessionStorage.setItem('omwai-analytics-session', JSON.stringify(identity))
  } catch {
    identity = { visitorId: identity?.visitorId || crypto.randomUUID(), sessionId: identity && now - identity.lastSeen < 30 * 60_000 ? identity.sessionId : crypto.randomUUID(), lastSeen: now }
  }
  return identity
}

export function trackEvent(kind: 'pageview' | 'outbound_intent' | 'outbound_click', path = location.pathname, providerId?: string) {
  if (!publicPath(path)) return
  try {
    const { visitorId, sessionId } = visitorIdentity()
    void fetch('/api/analytics/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: crypto.randomUUID(), visitorId, sessionId, kind, path, ...(providerId ? { providerId } : {}) }), keepalive: true }).catch(() => {})
  } catch { /* Analytics must never interrupt navigation. */ }
}

