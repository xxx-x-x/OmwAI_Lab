import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from './mysql.js'
import { publicComparisonQuotes } from './public-pricing.ts'

export function isRetiredSiteGroupsRoute(path: string) {
  return /^\/api\/user\/sites\/\d+\/(?:authorizations|quotes)(?:\/[^/]+)?\/?$/.test(path) || /^\/api\/admin\/site-quotes(?:\/[^/]+)?\/?$/.test(path)
}

type Context = { database: Database; request: IncomingMessage; response: ServerResponse; url: URL; json: (response: ServerResponse, status: number, payload: unknown) => void }

export async function handleSiteGroups(c: Context) {
  const { database, request, response, url } = c
  const send = (status: number, payload: unknown) => c.json(response, status, payload)
  response.setHeader('cache-control', 'no-store')
  if (isRetiredSiteGroupsRoute(url.pathname)) return send(410, { error: 'Manual site quotes and authorizations have been retired' })
  if (url.pathname !== '/api/site-comparison' || request.method !== 'GET') return send(404, { error: 'Not found' })
  const model = url.searchParams.get('modelId')
  if (!model || model.length > 191) return send(400, { error: 'modelId is required' })
  return send(200, { quotes: await publicComparisonQuotes(database, model) })
}
