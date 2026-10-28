import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

const MAX_BYTES = 512 * 1024
const MAX_CANDIDATES = 4
export type SiteLogo = { data: Buffer; contentType: string }
type Address = { address: string; family: number }
type Download = { status: number; headers: Record<string, string | string[] | undefined>; data: Buffer }
export type SiteLogoDependencies = {
  lookup: (hostname: string) => Promise<Address[]>
  request: (url: URL, address: Address, signal: AbortSignal) => Promise<Download>
}

/** Conservative public-unicast policy; IPv4-mapped and transition IPv6 are not accepted. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) !== 6 || address.includes('%')) return false
  const [first, second = '0'] = address.split(':')
  const a = parseInt(first, 16), b = parseInt(second || '0', 16)
  return a >= 0x2000 && a <= 0x3fff
    && !(a === 0x2001 && (b < 0x200 || b === 0xdb8))
    && a !== 0x2002 && !(a === 0x3fff && b < 0x1000)
}

export function validateLogoUrl(value: string | URL): URL {
  if (String(value).length > 2048) throw new Error('Logo URL too long')
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || (url.port && url.port !== '80' && url.port !== '443')
    || !hostname || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.internal')
    || (isIP(hostname) && !isPublicAddress(hostname))) throw new Error('Unsafe logo URL')
  url.hash = ''
  if (url.href.length > 2048) throw new Error('Logo URL too long')
  return url
}

export function imageContentType(data: Buffer): string | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && data.toString('ascii', 12, 16) === 'IHDR' && data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0) return 'image/png'
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data[3] !== 0 && data[3] !== 0xff) return 'image/jpeg'
  if (data.length >= 13 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))
    && data.readUInt16LE(6) > 0 && data.readUInt16LE(8) > 0) return 'image/gif'
  if (data.length >= 16 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(data.toString('ascii', 12, 16))) return 'image/webp'
  if (data.length >= 22 && data.readUInt32LE(0) === 0x00010000 && data.readUInt16LE(4) > 0) {
    const count = data.readUInt16LE(4)
    if (6 + count * 16 <= data.length) {
      const size = data.readUInt32LE(14), offset = data.readUInt32LE(18)
      if (size > 0 && offset >= 6 + count * 16 && offset + size <= data.length) return 'image/x-icon'
    }
  }
  return null
}

function decodeAttribute(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (original, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[entity.toLowerCase()] ?? original
  })
}

/** At most three declared icons, leaving one slot for the conventional favicon. */
export function iconCandidates(html: string, homepage: URL): URL[] {
  const icons: { url: URL; score: number }[] = []
  const cleaned = html.slice(0, MAX_BYTES).replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  for (const tag of cleaned.match(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attrs: Record<string, string> = {}
    for (const match of tag.slice(5, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const name = match[1].toLowerCase()
      if (!(name in attrs)) attrs[name] = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? '')
    }
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/)
    const apple = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')
    if ((!apple && !rel.includes('icon')) || !attrs.href) continue
    try {
      const url = validateLogoUrl(new URL(attrs.href, homepage))
      if (homepage.protocol === 'https:' && url.protocol !== 'https:') continue
      const sizes = [...(attrs.sizes ?? '').matchAll(/(?:^|\s)(\d+)x(\d+)(?=\s|$)/gi)]
      const size = Math.max(0, ...sizes.map(m => Math.min(4096, Number(m[1]), Number(m[2]))))
      icons.push({ url, score: (apple ? 10000 : 0) + size })
    } catch { /* Ignore malformed and unsafe declarations. */ }
  }
  const unique = new Map<string, URL>()
  for (const icon of icons.sort((a, b) => b.score - a.score)) unique.set(icon.url.href, icon.url)
  const fallback = new URL('/favicon.ico', homepage)
  return [...unique.values()].filter(url => url.href !== fallback.href).slice(0, MAX_CANDIDATES - 1).concat(fallback)
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Logo deadline exceeded'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

const defaultDependencies: SiteLogoDependencies = {
  lookup: hostname => lookup(hostname, { all: true, verbatim: true }),
  request: (url, address, signal) => new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', agent: false, family: address.family, signal, maxHeaderSize: 16 * 1024,
      headers: { Accept: 'text/html,image/png,image/jpeg,image/gif,image/webp,image/x-icon', 'Accept-Encoding': 'identity', 'User-Agent': 'OmwAI-SiteLogo/1.0' },
      // Keep the URL hostname for Host, TLS SNI and certificate verification, but never resolve again.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, response => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400) {
        resolve({ status, headers: response.headers, data: Buffer.alloc(0) })
        response.destroy()
        return
      }
      const length = Number(response.headers['content-length'])
      if (length > MAX_BYTES || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.destroy(new Error('Oversized or encoded logo response'))
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BYTES) response.destroy(new Error('Logo response too large'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve({ status, headers: response.headers, data: Buffer.concat(chunks) }))
      response.on('error', reject)
      response.on('aborted', () => reject(new Error('Incomplete logo response')))
    })
    request.on('error', reject)
    request.end()
  }),
}

/** Dependency injection is for trusted deterministic tests, never for caller-controlled transports. */
export function createSiteLogoFetcher(dependencies: SiteLogoDependencies = defaultDependencies, directImage = false) {
  return async (website: string): Promise<SiteLogo | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const deadline = controller.signal
    try {
      let homepage = validateLogoUrl(website)
      async function download(initial: URL): Promise<{ response: Download; url: URL }> {
        let url = initial
        for (let redirects = 0; ; redirects++) {
          url = validateLogoUrl(url)
          const requestController = new AbortController()
          const onDeadline = () => requestController.abort()
          deadline.addEventListener('abort', onDeadline, { once: true })
          if (deadline.aborted) requestController.abort()
          const requestTimer = setTimeout(() => requestController.abort(), 5000)
          try {
            const hostname = url.hostname.replace(/^\[|\]$/g, '')
            const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
              : await abortable(dependencies.lookup(hostname), requestController.signal)
            if (!addresses.length || addresses.some(a => !isPublicAddress(a.address) || isIP(a.address) !== a.family)) throw new Error('Unsafe DNS answer')
            const response = await abortable(dependencies.request(url, addresses[0], requestController.signal), requestController.signal)
            if (response.data.length > MAX_BYTES) throw new Error('Response too large')
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              if (redirects >= 3 || typeof response.headers.location !== 'string') throw new Error('Invalid redirect')
              const next = validateLogoUrl(new URL(response.headers.location, url))
              if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('Insecure redirect')
              url = next
              continue
            }
            if (response.status !== 200) throw new Error('Logo request failed')
            return { response, url }
          } finally {
            clearTimeout(requestTimer)
            deadline.removeEventListener('abort', onDeadline)
          }
        }
      }
      async function image(url: URL): Promise<SiteLogo | null> {
        const { response } = await download(url)
        const contentType = imageContentType(response.data)
        return contentType ? { data: response.data, contentType } : null
      }
      if (directImage) return await image(homepage)
      let customAttempted = false
      try {
        const status = await download(new URL('/api/status', homepage))
        const config: unknown = JSON.parse(status.response.data.toString('utf8'))
        if (config && typeof config === 'object' && 'success' in config && config.success === true
          && 'data' in config && config.data && typeof config.data === 'object'
          && 'logo' in config.data && typeof config.data.logo === 'string' && config.data.logo.trim()) {
          const custom = validateLogoUrl(new URL(config.data.logo.trim(), status.url))
          if (status.url.protocol === 'https:' && custom.protocol !== 'https:') throw new Error('Insecure custom logo')
          customAttempted = true
          const logo = await image(custom)
          if (logo) return logo
        }
      } catch { /* New API configuration is optional; continue with ordinary website icons. */ }
      if (deadline.aborted) return null
      let candidates: URL[]
      try {
        const page = await download(homepage)
        homepage = page.url
        const contentType = page.response.headers['content-type']
        const html = typeof contentType === 'string' && /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)
          ? page.response.data.toString('utf8') : ''
        candidates = iconCandidates(html, homepage)
      } catch {
        candidates = [new URL('/favicon.ico', homepage)]
      }
      // The optional custom image shares the four-image budget; always retain favicon fallback.
      if (customAttempted && candidates.length === MAX_CANDIDATES) candidates = candidates.slice(0, MAX_CANDIDATES - 2).concat(candidates.slice(-1))
      for (const candidate of candidates) {
        if (deadline.aborted) break
        try {
          const logo = await image(candidate)
          if (logo) return logo
        } catch { /* Try the next bounded candidate. */ }
      }
      return null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}

export const fetchSiteLogo: (website: string) => Promise<SiteLogo | null> = createSiteLogoFetcher()
export const fetchLogoImage: (url: string) => Promise<SiteLogo | null> = createSiteLogoFetcher(defaultDependencies, true)
