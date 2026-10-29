import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

async function widget() {
  const source = await readFile(new URL('../src/Turnstile.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const effects = [], tokens = [], resets = [], states = []
  let options, errors = 0
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    window: { turnstile: { render: (_, value) => { options = value; return 'widget' }, reset: id => resets.push(id), remove() {} } },
    require: name => name === 'react' ? {
      useEffect: fn => effects.push(fn),
      useRef: value => ({ current: value ?? {} }),
      useState: value => { const index = states.length; states.push(value); return [value, next => { states[index] = typeof next === 'function' ? next(states[index]) : next }] },
    } : name === './useTheme' ? { useTheme: () => ({ theme: 'light' }) } : { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  })
  exports.Turnstile({ siteKey: 'test', action: 'login', resetKey: 0, onToken: token => tokens.push(token), onError: () => errors++ })
  const cleanup = effects[0]()
  await Promise.resolve()
  effects[1]()
  return { options, tokens, resets, states, cleanup, errors: () => errors }
}

test('idle expiry and timeout clear tokens without automatically restarting verification', async () => {
  const { options, tokens, resets, states } = await widget()
  assert.equal(options.retry, 'never')
  assert.equal(options['refresh-expired'], 'manual')
  assert.equal(options['refresh-timeout'], 'manual')
  options.callback('valid-token')
  assert.equal(states[0], 'ready')
  options['expired-callback']()
  assert.equal(states[0], 'expired')
  assert.equal(tokens.at(-1), '')
  options['timeout-callback']()
  assert.equal(states[0], 'expired')
  assert.deepEqual(resets, [])
})

test('errors stop verification and callbacks from removed widgets are ignored', async () => {
  const { options, states, tokens, cleanup, errors } = await widget()
  options['error-callback']()
  assert.equal(states[0], 'error')
  assert.equal(errors(), 1)
  cleanup()
  const count = tokens.length
  options.callback('stale-token')
  options['expired-callback']()
  options['error-callback']()
  assert.equal(tokens.length, count)
  assert.equal(errors(), 1)
})
