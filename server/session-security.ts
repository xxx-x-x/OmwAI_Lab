import type { IncomingMessage } from 'node:http'

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000

export function sessionCookie(id: string, secure: boolean, maxAge = SESSION_TTL_MS / 1000) {
  return `omwai_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function sessionExpired(session: { expiresAt: number; lastSeenAt: number; user: { role: string } }, now = Date.now()) {
  const idle = session.user.role === 'admin' ? ADMIN_SESSION_IDLE_MS : SESSION_IDLE_MS
  return session.expiresAt <= now || session.lastSeenAt + idle <= now
}

export function validWriteOrigin(request: IncomingMessage, publicOrigin: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET')) return true
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  try {
    const expected = publicOrigin || `${'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`
    const origin = request.headers.origin
    if (origin !== undefined) return origin === new URL(expected).origin
    const referer = request.headers.referer
    return typeof referer === 'string' && new URL(referer).origin === new URL(expected).origin
  } catch {
    return false
  }
}
