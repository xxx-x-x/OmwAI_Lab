import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackEvent } from './analytics'

let lastNavigation = ''

export function AnalyticsTracker() {
  const location = useLocation()
  useEffect(() => {
    const navigation = `${location.key}:${location.pathname}:${location.search}`
    if (navigation === lastNavigation) return
    lastNavigation = navigation
    trackEvent('pageview', location.pathname)
  }, [location.key, location.pathname, location.search])
  return null
}
