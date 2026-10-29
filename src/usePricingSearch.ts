import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export function usePricingSearch() {
  const [params, setParams] = useSearchParams()
  const urlQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<string | null>(null)
  useEffect(() => {
    if (pending.current !== null) return
    // oxlint-disable-next-line react/set-state-in-effect -- restore search after browser navigation
    setQuery(urlQuery)
  }, [urlQuery])
  useEffect(() => () => clearTimeout(timer.current), [])
  const updateQuery = (value: string) => {
    setQuery(value)
    pending.current = value
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      pending.current = null
      setParams(current => { const next = new URLSearchParams(current); if (value) next.set('q', value); else next.delete('q'); next.delete('page'); return next }, { replace: true })
    }, 250)
  }
  const updateFilter = (key: string, value: string) => {
    clearTimeout(timer.current)
    pending.current = null
    setParams(current => {
      const next = new URLSearchParams(current)
      if (query) next.set('q', query); else next.delete('q')
      if (!value || value === '全部模型') next.delete(key); else next.set(key, value)
      if (key !== 'page') next.delete('page')
      return next
    }, { replace: true })
  }
  const currentParams = new URLSearchParams(params)
  if (query) currentParams.set('q', query); else currentParams.delete('q')
  return { params: currentParams, query, updateQuery, updateFilter }
}
