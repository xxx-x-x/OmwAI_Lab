import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isPublicAddress } from './site-logo.js'
import { validateMonitorTarget, type UptimeConfig } from './uptime.js'

type Address = { address: string; family: number }
export type ModelDependencies = { lookup: (host: string) => Promise<Address[]>; download: (url: URL, address: Address, key: string, signal: AbortSignal) => Promise<Buffer> }
const defaults: ModelDependencies = {
  lookup: host => lookup(host, { all: true, verbatim: true }),
  download: (url, address, key, signal) => new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', agent: false, signal, family: address.family, maxHeaderSize: 16384,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Accept-Encoding': 'identity' },
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    }, res => {
      res.on('error', reject)
      res.on('aborted', () => reject(new Error('Incomplete response')))
      if (res.statusCode !== 200 || Number(res.headers['content-length']) > 524288 || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
        res.destroy(); reject(new Error('Invalid model response')); return
      }
      const chunks: Buffer[] = []; let size = 0
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 524288) res.destroy(new Error('Model response too large')); else chunks.push(chunk) })
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject); req.end()
  }),
}
export function validMonitorKey(key: unknown): key is string { return typeof key === 'string' && /^[\x21-\x7e]{8,512}$/.test(key) }
export function validMonitorModel(model: unknown): model is string { return typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,190}$/.test(model) }
let inFlight = 0
export async function fetchAvailabilityModels(baseUrl: string, key: string, config: UptimeConfig, dependencies = defaults): Promise<string[]> {
  if (inFlight >= 4) throw new Error('模型列表获取失败：服务繁忙，请稍后重试')
  inFlight++
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
  const abort = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Deadline')), { once: true }))
  try {
    return await Promise.race([abort, (async () => {
      if (!validMonitorKey(key)) throw new Error('Invalid key')
      let records: Address[] = []
      const endpoint = await validateMonitorTarget(baseUrl, config, async host => {
        records = await Promise.race([dependencies.lookup(host), abort])
        return records
      })
      if (!records.length || records.some(record => !isPublicAddress(record.address))) throw new Error('Unsafe DNS')
      const url = new URL('/v1/models', endpoint)
      const data = await dependencies.download(url, records[0], key, controller.signal)
      if (data.length > 524288) throw new Error('Oversized models')
      const parsed: unknown = JSON.parse(data.toString('utf8'))
      if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !Array.isArray(parsed.data) || parsed.data.length > 1000) throw new Error('Invalid models')
      const models = [...new Set(parsed.data.flatMap((row: unknown) => row && typeof row === 'object' && 'id' in row && validMonitorModel(row.id) ? [row.id] : []))].sort()
      if (!models.length) throw new Error('Empty models')
      return models
    })()])
  } catch { throw new Error('模型列表获取失败：请检查地址、专用 KEY 权限及上游 /v1/models；禁止重定向，最多 1000 个模型/512 KiB/8 秒') }
  finally { clearTimeout(timer); inFlight-- }
}
