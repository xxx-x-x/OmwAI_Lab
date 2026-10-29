import { useEffect, useRef, useState } from 'react'
import { useTheme } from './useTheme'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
      reset: (widgetId: string) => void
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => { script.remove(); scriptPromise = null; reject(new Error('Turnstile failed to load')) }
    document.head.append(script)
  })
  return scriptPromise
}

export function Turnstile({ siteKey, action, resetKey, onToken, onError }: { siteKey: string; action: string; resetKey: number; onToken: (token: string) => void; onError: () => void }) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let disposed = false
    onToken('')
    loadTurnstile().then(() => {
      if (disposed || !containerRef.current || !window.turnstile) return
      setStatus('loading')
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme,
        size: 'flexible',
        retry: 'never',
        'refresh-expired': 'manual',
        'refresh-timeout': 'manual',
        callback: (token: string) => { if (!disposed) { setStatus('ready'); onToken(token) } },
        'expired-callback': () => { if (!disposed) { setStatus('expired'); onToken('') } },
        'timeout-callback': () => { if (!disposed) { setStatus('expired'); onToken('') } },
        'error-callback': () => { if (!disposed) { setStatus('error'); onToken(''); onError() } },
      })
    }).catch(() => { if (!disposed) { setStatus('error'); onError() } })
    return () => {
      disposed = true
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current)
      widgetRef.current = null
    }
  }, [action, loadAttempt, onError, onToken, siteKey, theme])

  const restart = () => {
    onToken('')
    setStatus('loading')
    if (widgetRef.current !== null && window.turnstile) window.turnstile.reset(widgetRef.current)
    else setLoadAttempt(value => value + 1)
  }

  useEffect(() => {
    if (resetKey > 0 && widgetRef.current !== null && window.turnstile) {
      onToken('')
      setStatus('loading')
      window.turnstile.reset(widgetRef.current)
    }
  }, [onToken, resetKey])

  return <div><div className="turnstile-widget" ref={containerRef} />{(status === 'expired' || status === 'error') && <div role="status"><p>{status === 'expired' ? '人机验证已过期，请在提交前重新验证。' : '人机验证未完成，请重试。'}</p><button type="button" onClick={restart}>重新验证</button></div>}</div>
}
