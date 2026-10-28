import { useEffect, useRef } from 'react'
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
    script.onerror = () => reject(new Error('Turnstile failed to load'))
    document.head.append(script)
  })
  return scriptPromise
}

export function Turnstile({ siteKey, action, resetKey, onToken, onError }: { siteKey: string; action: string; resetKey: number; onToken: (token: string) => void; onError: () => void }) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)

  useEffect(() => {
    let disposed = false
    onToken('')
    loadTurnstile().then(() => {
      if (disposed || !containerRef.current || !window.turnstile) return
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme,
        size: 'flexible',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => { onToken(''); onError() },
      })
    }).catch(onError)
    return () => {
      disposed = true
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current)
      widgetRef.current = null
    }
  }, [action, onError, onToken, siteKey, theme])

  useEffect(() => {
    if (resetKey > 0 && widgetRef.current && window.turnstile) {
      window.turnstile.reset(widgetRef.current)
      onToken('')
    }
  }, [onToken, resetKey])

  return <div className="turnstile-widget" ref={containerRef} />
}
