import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }

export function createStaticHandler(directory: string) {
  const inside = (root: string, file: string) => { const path = relative(root, file); return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`) }
  return async (request: IncomingMessage, response: ServerResponse) => {
    const fail = (status: number) => { response.statusCode = status; response.end() }
    let path: string
    try { path = decodeURIComponent((request.url || '/').split('?')[0]) } catch { return fail(400) }
    if (path === '/api' || path.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.statusCode = 404
      return response.end(JSON.stringify({ error: '接口不存在' }))
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('allow', 'GET, HEAD'); return fail(405) }
    if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) return fail(404)
    try {
      const root = await realpath(directory)
      const requested = resolve(root, `.${path}`)
      if (!inside(root, requested)) return fail(404)
      let file: string
      try { file = await realpath(requested); if (!(await stat(file)).isFile()) throw new Error('not a file') }
      catch {
        if (extname(path) || path.startsWith('/assets/') || (path !== '/' && !request.headers.accept?.includes('text/html'))) return fail(404)
        file = await realpath(resolve(root, 'index.html'))
      }
      if (!inside(root, file)) return fail(404)
      const info = await stat(file)
      response.setHeader('content-type', types[extname(file)] || 'application/octet-stream')
      response.setHeader('content-length', info.size)
      response.setHeader('cache-control', relative(root, file).startsWith(`assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
      if (request.method === 'HEAD') return response.end()
      const stream = createReadStream(file)
      stream.on('error', () => response.destroy())
      response.on('close', () => stream.destroy())
      stream.pipe(response)
    } catch { fail(404) }
  }
}
