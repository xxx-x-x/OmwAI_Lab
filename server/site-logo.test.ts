import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSiteLogoFetcher, iconCandidates, imageContentType, isPublicAddress, validateLogoUrl } from './site-logo.ts'
import type { SiteLogoDependencies } from './site-logo.ts'

const png = Buffer.alloc(24)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
png.write('IHDR', 12)
png.writeUInt32BE(128, 16)
png.writeUInt32BE(128, 20)
const publicAddress = { address: '93.184.216.34', family: 4 }
function fixture(routes: Record<string, { status?: number; type?: string; data?: Buffer; location?: string }>, lookup: SiteLogoDependencies['lookup'] = async () => [publicAddress]) {
  const calls: string[] = []
  const fetch = createSiteLogoFetcher({ lookup, request: async (url, address) => {
    assert.deepEqual(address, publicAddress)
    calls.push(url.href)
    const route = routes[url.href] ?? { status: 404 }
    return { status: route.status ?? 200, headers: { 'content-type': route.type, location: route.location }, data: route.data ?? Buffer.alloc(0) }
  } })
  return { fetch, calls }
}

test('public-address policy rejects private, special-use, mapped and transition addresses', () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.8', '192.0.2.1', '198.18.1.1', '198.19.1.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1', '64:ff9b::808:808', '2002:0808:0808::', '2001::1', '2001:db8::1', '3fff::1', 'fe80::1%eth0', 'invalid']) assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8', '93.184.216.34', '100.128.0.1', '172.32.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address)
})

test('URL validation normalizes obfuscated IPs and rejects credentials and non-web ports', () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'https://user:password@example.com', 'http://localhost', 'http://sub.localhost', 'https://host.local', 'http://service.internal', 'http://2130706433', 'http://0x7f000001', 'http://127.1', 'http://[::1]', 'http://[::ffff:8.8.8.8]', 'https://example.com:8443']) assert.throws(() => validateLogoUrl(url), url)
  assert.equal(validateLogoUrl('https://example.com/path#fragment').href, 'https://example.com/path')
  assert.equal(validateLogoUrl('http://example.com:443').port, '443')
})

test('icon parsing ranks apple and resolution, decodes entities, deduplicates and reserves fallback', () => {
  const html = `<script><link rel="icon" href="/script.png"></script><!-- <link rel="icon" href="/comment.png"> -->
  <link href='/small.png' rel='shortcut icon' sizes='16x16'>
  <link rel=icon href=/large.png sizes=512x512>
  <link rel="apple-touch-icon" href="/apple.png?a=1&amp;b=2" sizes="180x180">
  <link rel=icon href=/large.png sizes=512x512>
  <link rel=icon href="http://example.com/downgrade.png">
  <link rel=icon href="http://127.0.0.1/private.png">
  <link rel=icon href=/extra.png sizes=32x32>`
  assert.deepEqual(iconCandidates(html, new URL('https://example.com/path')).map(url => url.href), [
    'https://example.com/apple.png?a=1&b=2', 'https://example.com/large.png', 'https://example.com/extra.png', 'https://example.com/favicon.ico',
  ])
})

test('signature checks allow only supported raster image types, not declared MIME', () => {
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'binary')
  const ico = Buffer.alloc(23)
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt32LE(1, 14); ico.writeUInt32LE(22, 18)
  for (const [data, type] of [[png, 'image/png'], [Buffer.from([255, 216, 255, 224]), 'image/jpeg'], [gif, 'image/gif'], [Buffer.from('RIFF1234WEBPVP8 '), 'image/webp'], [ico, 'image/x-icon']] as const) assert.equal(imageContentType(data), type)
  for (const data of [Buffer.alloc(0), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('<html>image.png</html>'), png.subarray(0, 10), Buffer.from('RIFF1234WEBPHTML'), Buffer.alloc(22)]) assert.equal(imageContentType(data), null)
})

test('downloads ranked icon with pinned validated DNS address and signature-derived MIME', async () => {
  const f = fixture({
    'https://example.com/': { type: 'text/html; charset=utf-8', data: Buffer.from('<link rel="apple-touch-icon" href="/apple.png">') },
    'https://example.com/apple.png': { type: 'text/plain', data: png },
  })
  assert.deepEqual(await f.fetch('https://example.com'), { data: png, contentType: 'image/png' })
  assert.deepEqual(f.calls, ['https://example.com/api/status', 'https://example.com/', 'https://example.com/apple.png'])
})

test('fallback works for HTTP websites, failed homepages and invalid image declarations', async () => {
  const f = fixture({
    'http://example.com/favicon.ico': { type: 'image/svg+xml', data: png },
  })
  assert.equal((await f.fetch('http://example.com'))?.contentType, 'image/png')
  const g = fixture({
    'https://example.com/': { type: 'text/html', data: Buffer.from('<link rel=icon href=/evil.svg>') },
    'https://example.com/evil.svg': { type: 'image/png', data: Buffer.from('<svg/>') },
    'https://example.com/favicon.ico': { data: png },
  })
  assert.equal((await g.fetch('https://example.com'))?.contentType, 'image/png')
  assert.equal(g.calls.length, 4)
})

test('rejects mixed public/private DNS, empty DNS, invalid families and DNS errors before requests', async () => {
  for (const answers of [[], [publicAddress, { address: '127.0.0.1', family: 4 }], [{ address: '::ffff:8.8.8.8', family: 6 }], [{ ...publicAddress, family: 6 }]]) {
    const f = fixture({}, async () => answers)
    assert.equal(await f.fetch('https://example.com'), null)
    assert.equal(f.calls.length, 0)
  }
  const f = fixture({}, async () => { throw new Error('DNS failed') })
  assert.equal(await f.fetch('https://example.com'), null)
})

test('revalidates DNS on redirects, refuses unsafe redirects and HTTPS downgrades', async () => {
  for (const location of ['http://example.com/icon', 'https://127.0.0.1/icon', 'https://user:pass@example.com/icon', 'https://example.com:8080/icon', 'https://internal.example/icon']) {
    const f = fixture({
      'https://example.com/': { type: 'text/html', data: Buffer.from('<link rel=icon href=/icon>') },
      'https://example.com/icon': { status: 302, location },
    }, async host => host === 'internal.example' ? [{ address: '10.0.0.1', family: 4 }] : [publicAddress])
    assert.equal(await f.fetch('https://example.com'), null)
    assert.ok(!f.calls.includes(location))
  }
})

test('redirects use final homepage URL and permit at most three hops', async () => {
  const f = fixture({
    'https://example.com/': { status: 302, location: 'https://cdn.example/page' },
    'https://cdn.example/page': { type: 'text/html', data: Buffer.from('<link rel=icon href=relative.png>') },
    'https://cdn.example/relative.png': { data: png },
  })
  assert.ok(await f.fetch('https://example.com'))
  assert.equal(f.calls.at(-1), 'https://cdn.example/relative.png')
  let calls = 0
  const loop = createSiteLogoFetcher({ lookup: async () => [publicAddress], request: async () => {
    calls++
    return { status: 302, headers: { location: '/loop' }, data: Buffer.alloc(0) }
  } })
  assert.equal(await loop('https://example.com'), null)
  assert.equal(calls, 12) // Four requests each for status, homepage and fallback.
})

test('bounds candidates and rejects oversized HTML and images', async () => {
  const many = Array.from({ length: 100 }, (_, i) => `<link rel=icon href=/${i}.png>`).join('')
  const f = fixture({ 'https://example.com/': { type: 'text/html', data: Buffer.from(many) } })
  assert.equal(await f.fetch('https://example.com'), null)
  assert.equal(f.calls.length, 6)
  const huge = Buffer.alloc(512 * 1024 + 1)
  png.copy(huge)
  const g = fixture({
    'https://example.com/': { type: 'text/html', data: huge },
    'https://example.com/favicon.ico': { data: huge },
  })
  assert.equal(await g.fetch('https://example.com'), null)
  assert.equal(g.calls.length, 3)
})

test('per-request timeout aborts stalled transports and tries the fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const signals: AbortSignal[] = []
  const fetch = createSiteLogoFetcher({ lookup: async () => [publicAddress], request: (url, _address, signal) => {
    if (url.pathname === '/api/status') return Promise.resolve({ status: 404, headers: {}, data: Buffer.alloc(0) })
    signals.push(signal)
    return new Promise(() => {})
  } })
  const pending = fetch('https://example.com')
  for (let i = 0; i < 20 && signals.length === 0; i++) await Promise.resolve()
  assert.equal(signals.length, 1)
  t.mock.timers.tick(5000)
  for (let i = 0; i < 20 && signals.length < 2; i++) await Promise.resolve()
  assert.equal(signals[0].aborted, true)
  assert.equal(signals.length, 2)
  t.mock.timers.tick(5000)
  assert.equal(await pending, null)
  assert.equal(signals[1].aborted, true)
})

test('stalled New API status times out without blocking HTML fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let statusSignal: AbortSignal | undefined
  const fetch = createSiteLogoFetcher({ lookup: async () => [publicAddress], request: (url, _address, signal) => {
    if (url.pathname === '/api/status') {
      statusSignal = signal
      return new Promise(() => {})
    }
    return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, data: url.pathname === '/'
      ? Buffer.from('<link rel=icon href=/html.png>') : png })
  } })
  const pending = fetch('https://example.com')
  for (let i = 0; i < 20 && !statusSignal; i++) await Promise.resolve()
  assert.ok(statusSignal)
  t.mock.timers.tick(5000)
  assert.deepEqual(await pending, { data: png, contentType: 'image/png' })
  assert.equal(statusSignal.aborted, true)
})

test('New API custom logo takes precedence without fetching framework homepage icons', async () => {
  for (const logo of ['https://cdn.example/custom.png', '/custom.png', 'custom.png']) {
    const resolved = new URL(logo, 'https://example.com/api/status').href
    const f = fixture({
      'https://example.com/api/status': { data: Buffer.from(JSON.stringify({ success: true, data: { logo } })) },
      [resolved]: { data: png },
    })
    assert.deepEqual(await f.fetch('https://example.com'), { data: png, contentType: 'image/png' })
    assert.deepEqual(f.calls, ['https://example.com/api/status', resolved])
  }
})

test('New API relative logo resolves against redirected status response URL', async () => {
  const f = fixture({
    'https://example.com/api/status': { status: 302, location: 'https://cdn.example/config/status' },
    'https://cdn.example/config/status': { data: Buffer.from(JSON.stringify({ success: true, data: { logo: 'logo.png' } })) },
    'https://cdn.example/config/logo.png': { data: png },
  })
  assert.ok(await f.fetch('https://example.com'))
  assert.equal(f.calls.at(-1), 'https://cdn.example/config/logo.png')
})

test('unsafe, unsuccessful, malformed and oversized New API configuration falls back to HTML', async () => {
  const configs: unknown[] = [null, [], {}, { success: false, data: { logo: '/custom.png' } },
    { success: 'true', data: { logo: '/custom.png' } }, { success: true, data: null },
    ...[null, 42, {}, '', ' ', 'http://example.com/custom.png', 'https://127.0.0.1/custom.png', 'https://user:pass@example.com/custom.png', 'file:///logo.png', 'data:image/png;base64,AA==', 'https://internal.example/logo.png'].map(logo => ({ success: true, data: { logo } }))]
  for (const data of [...configs.map(config => Buffer.from(JSON.stringify(config))), Buffer.from('{broken'), Buffer.alloc(512 * 1024 + 1)]) {
    const f = fixture({
      'https://example.com/api/status': { data },
      'https://example.com/': { type: 'text/html', data: Buffer.from('<link rel=icon href=/html.png>') },
      'https://example.com/html.png': { data: png },
    }, async host => host === 'internal.example' ? [{ address: '10.0.0.1', family: 4 }] : [publicAddress])
    assert.ok(await f.fetch('https://example.com'))
    assert.equal(f.calls.at(-1), 'https://example.com/html.png')
    assert.ok(!f.calls.some(url => url.includes('custom.png') || url.includes('internal.example')))
  }
})

test('invalid custom image falls back and shares the four-image budget with HTML icons', async () => {
  for (const customData of [Buffer.from('<svg/>'), Buffer.from('<html/>'), Buffer.alloc(512 * 1024 + 1)]) {
    const f = fixture({
      'https://example.com/api/status': { data: Buffer.from(JSON.stringify({ success: true, data: { logo: '/custom.png' } })) },
      'https://example.com/custom.png': { data: customData },
      'https://example.com/': { type: 'text/html', data: Buffer.from('<link rel=icon href=/a.png><link rel=icon href=/b.png><link rel=icon href=/c.png>') },
      'https://example.com/favicon.ico': { data: png },
    })
    assert.ok(await f.fetch('https://example.com'))
    assert.equal(f.calls.length, 6)
    assert.ok(!f.calls.includes('https://example.com/c.png'))
    assert.equal(f.calls.at(-1), 'https://example.com/favicon.ico')
  }
})

test('total deadline also bounds a DNS lookup that never completes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const fetch = createSiteLogoFetcher({ lookup: () => { calls++; return new Promise(() => {}) }, request: async () => { throw new Error('Must not request') } })
  const pending = fetch('https://example.com')
  t.mock.timers.tick(15000)
  assert.equal(await pending, null)
  assert.equal(calls, 1)
})
