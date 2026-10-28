import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Redis } from 'ioredis'
import { AuthRedisUnavailableError, CODE_COOLDOWN_MS, CODE_TTL_MS, createAuthRedis } from './auth-redis.ts'

test('missing Redis fails closed for all authentication storage operations', async () => {
  const store = createAuthRedis('', undefined, 'test-secret')
  try {
    await assert.rejects(store.allowRequest('127.0.0.1'), AuthRedisUnavailableError)
    await assert.rejects(store.issueCode('user@example.com', 'register', '123456'), AuthRedisUnavailableError)
    await assert.rejects(store.consumeCode('user@example.com', 'register', '123456'), AuthRedisUnavailableError)
  } finally { store.close() }
})

test('rejects non-Redis connection protocols', () => {
  assert.throws(() => createAuthRedis('https://example.com'), /REDIS_URL/)
})

test('missing verification secret rejects code storage', async () => {
  const store = createAuthRedis('redis://127.0.0.1:6379')
  try {
    await assert.rejects(store.issueCode('user@example.com', 'register', '123456'), AuthRedisUnavailableError)
  } finally { store.close() }
})

test('real Redis: TTL, isolation, cooldown, atomic consumption, attempts and shared rate limits', { skip: !process.env.REDIS_TEST_URL }, async () => {
  const prefix = `omwai-test:${randomUUID()}:`
  const url = process.env.REDIS_TEST_URL!
  const store = createAuthRedis(url, prefix, 'test-secret')
  const second = createAuthRedis(url, prefix, 'test-secret')
  const client = new Redis(url, { maxRetriesPerRequest: 1 })
  try {
    const email = 'user@example.com'
    const token = await store.issueCode(email, 'register', '123456')
    assert.ok(token)
    const keys = await client.keys(`${prefix}*`)
    const codeKey = keys.find(key => key.endsWith(':code'))!
    const cooldownKey = keys.find(key => key.endsWith(':cooldown'))!
    assert.ok(await client.pttl(codeKey) > CODE_TTL_MS - 5000)
    assert.ok(await client.pttl(cooldownKey) > CODE_COOLDOWN_MS - 5000)
    assert.notEqual(await client.hget(codeKey, 'hash'), '123456')
    assert.equal(await second.issueCode(email, 'register', '654321'), null)
    assert.equal(await store.consumeCode(email, 'reset-password', '123456'), false)
    const results = await Promise.all(Array.from({ length: 10 }, () => second.consumeCode(email, 'register', '123456')))
    assert.equal(results.filter(Boolean).length, 1)
    await store.cancelCode(email, 'register', token)

    const nextToken = await store.issueCode(email, 'register', '654321')
    assert.ok(nextToken)
    await store.cancelCode(email, 'register', token)
    assert.equal(await client.exists(codeKey), 1)
    for (let index = 0; index < 5; index++) assert.equal(await store.consumeCode(email, 'register', '000000'), false)
    assert.equal(await store.consumeCode(email, 'register', '654321'), false)
    await store.cancelCode(email, 'register', nextToken)

    assert.ok(await store.issueCode(email, 'register', '111111'))
    await client.pexpire(cooldownKey, 1)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(await second.issueCode(email, 'register', '222222'))
    assert.equal(await store.consumeCode(email, 'register', '111111'), false)
    await client.pexpire(codeKey, 1)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(await store.consumeCode(email, 'register', '222222'), false)

    const requests = await Promise.all(Array.from({ length: 25 }, (_, index) => (index % 2 ? store : second).allowRequest('127.0.0.1')))
    assert.equal(requests.filter(Boolean).length, 20)
    const rateKey = (await client.keys(`${prefix}rate:*`))[0]!
    assert.ok(await client.pttl(rateKey) > 0)
    await client.pexpire(rateKey, 1)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(await second.allowRequest('127.0.0.1'), true)
  } finally {
    const keys = await client.keys(`${prefix}*`)
    if (keys.length) await client.del(...keys)
    store.close()
    second.close()
    client.disconnect()
  }
})
