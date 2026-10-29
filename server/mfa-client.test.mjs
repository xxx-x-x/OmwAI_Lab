import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

async function client(responses) {
  const source = await readFile(new URL('../src/Mfa.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const calls = [], resolvers = []
  const window = { location: { href: 'https://lab.example/admin', origin: 'https://lab.example' }, fetch: async (input, init) => { const request = new Request(input, init); calls.push({ url: request.url, method: request.method, body: await request.text() }); return responses.shift() } }
  const exports = {}
  const context = { exports, window, URL, Request, Promise, require: name => name === 'react' ? { useEffect: fn => fn(), useState: value => [value, setter => { if (typeof setter === 'function') resolvers.push(setter()) }] } : {} }
  vm.runInNewContext(compiled, context)
  exports.MfaGate()
  return { window, calls, resolvers }
}
const required = () => Response.json({ code: 'MFA_REQUIRED', error: 'verify' }, { status: 403 })

test('client MFA retry preserves write body and coalesces concurrent verification', async () => {
  const { window, calls, resolvers } = await client([required(), required(), Response.json({ ok: true }), Response.json({ ok: true })])
  const first = window.fetch('/api/admin/users/1', { method: 'PATCH', body: '{"role":"admin"}' })
  const second = window.fetch('/api/admin/providers/1', { method: 'DELETE' })
  while (!resolvers.length) await new Promise(done => setImmediate(done))
  await new Promise(done => setImmediate(done))
  assert.equal(resolvers.length, 1)
  resolvers[0](true)
  assert.equal((await first).status, 200)
  assert.equal((await second).status, 200)
  const retriedWrite = calls.slice(2).find(call => call.method === 'PATCH')
  assert.equal(retriedWrite.body, '{"role":"admin"}')
  assert.equal(calls.slice(2).filter(call => call.method === 'DELETE').length, 1)
})
test('cancelled verification returns original response and does not retry write', async () => {
  const { window, calls, resolvers } = await client([required()])
  const result = window.fetch('/api/admin/users/1', { method: 'PATCH', body: '{}' })
  while (!resolvers.length) await new Promise(done => setImmediate(done))
  resolvers[0](false)
  assert.equal((await result).status, 403)
  assert.equal(calls.length, 1)
})
