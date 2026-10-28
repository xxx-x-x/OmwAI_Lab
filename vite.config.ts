import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createBackend } from './server/backend.js'

export default defineConfig(({ mode }) => ({
  plugins: [react(), {
    name: 'application-api',
    configureServer(server) {
      const backend = createBackend({ ...loadEnv(mode, process.cwd(), ''), ...process.env })
      server.middlewares.use(backend.handle)
      server.httpServer?.once('close', () => { void backend.close() })
    },
  }],
}))
