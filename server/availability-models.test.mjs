import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAvailabilityModels } from '../dist-server/availability-models.js'
import { requireUptimeEncryption } from '../dist-server/uptime.js'
const config = { origins: ['https://api.example.com'] }
const deps = (data, records = [{ address: '8.8.8.8', family: 4 }]) => ({ lookup: async () => records, download: async (url, address, key, signal) => { assert.equal(url.href, 'https://api.example.com/v1/models'); assert.equal(address.address, '8.8.8.8'); assert.equal(key, 'private-test-key'); assert.equal(signal.aborted, false); return Buffer.from(JSON.stringify(data)) } })
test('models pinned to validated DNS and canonical /v1/models, IDs deduplicated and bounded', async () => {
  assert.deepEqual(await fetchAvailabilityModels('https://api.example.com/v1', 'private-test-key', config, deps({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, { id: '<unsafe>' }] })), ['a', 'b'])
})
test('models rejects private/mixed DNS, bad format, large counts and masked secrets', async () => {
  for (const data of [{}, { data: [] }, { data: Array(1001).fill({ id: 'a' }) }]) await assert.rejects(fetchAvailabilityModels('https://api.example.com', 'private-test-key', config, deps(data)), /模型列表获取失败/)
  await assert.rejects(fetchAvailabilityModels('https://api.example.com', 'private-test-key', config, deps({ data: [{ id: 'a' }] }, [{ address: '8.8.8.8' }, { address: '127.0.0.1' }])), /模型列表获取失败/)
  await assert.rejects(fetchAvailabilityModels('https://api.example.com', 'private-test-key', config, { lookup: deps({}).lookup, download: async () => { throw new Error('private-test-key') } }), error => !error.message.includes('private-test-key'))
})
test('capability fail closed before a caller can send a credential', async () => {
  for (const capability of [undefined, {}, { version: 1, algorithm: 'AES-256-GCM', encryptedAtRest: true }]) await assert.rejects(requireUptimeEncryption(async () => ({ ok: true, labEncryption: capability })), /拒绝发送 KEY/)
  await requireUptimeEncryption(async () => ({ ok: true, labEncryption: { version: 1, algorithm: 'AES-256-GCM', encryptedAtRest: true, redactedManagement: true } }))
})
