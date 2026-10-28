import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createBackend } from './backend.js'
import { createStaticHandler } from './static.js'

export function productionConfig(env: NodeJS.ProcessEnv) {
  const port = Number(env.PORT || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535')
  if (env.PUBLIC_ORIGIN) {
    const origin = new URL(env.PUBLIC_ORIGIN)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== env.PUBLIC_ORIGIN || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a trailing slash')
  }
  if (env.TRUST_PROXY === 'true' && !env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN is required with TRUST_PROXY')
  return { host: env.HOST || '127.0.0.1', port }
}

export function createProductionServer(env: NodeJS.ProcessEnv, directory: string) {
  const backend = createBackend(env)
  const serve = createStaticHandler(directory)
  const server = createServer((request, response) => {
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
    response.setHeader('x-frame-options', 'SAMEORIGIN')
    void backend.handle(request, response, () => { void serve(request, response) })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  const close = async () => {
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000)
    deadline.unref()
    try { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) }
        finally { try { await backend.close() } finally { clearTimeout(deadline) } }
  }
  return { server, close }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = productionConfig(process.env)
    const directory = fileURLToPath(new URL('../dist/', import.meta.url))
    if (!existsSync(resolve(directory, 'index.html'))) throw new Error('Missing dist/index.html; run npm run build first')
    const app = createProductionServer(process.env, directory)
    app.server.once('error', () => { console.error('Production server failed to listen'); void app.close().finally(() => { process.exitCode = 1 }) })
    app.server.listen(config.port, config.host, () => console.log(`OmwAI Lab listening on http://${config.host}:${config.port}`))
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      const deadline = setTimeout(() => process.exit(1), 15_000)
      deadline.unref()
      void app.close().catch(() => { process.exitCode = 1 }).finally(() => clearTimeout(deadline))
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  } catch { console.error('Production startup failed: check HOST, PORT, PUBLIC_ORIGIN and build output'); process.exitCode = 1 }
}
