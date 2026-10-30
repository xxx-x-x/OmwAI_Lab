type SiteQuote = { id: string | number; modelId?: string; siteId?: number; website?: string; siteName?: string; groupMultiplier?: string | number | null }

export function multiplier(quote: SiteQuote) {
  const value = quote.groupMultiplier
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function compareMultipliers(a: SiteQuote, b: SiteQuote, descending = false) {
  const left = multiplier(a), right = multiplier(b)
  if (left == null || right == null) return left == null ? right == null ? 0 : 1 : -1
  return descending ? right - left : left - right
}

export function lowestPerSite<T extends SiteQuote>(quotes: T[]): T[] {
  const sites = new Map<string, T>()
  for (const quote of quotes) {
    const site = quote.siteId != null ? `id:${quote.siteId}` : quote.website ? `url:${quote.website}` : quote.siteName ? `name:${quote.siteName}` : `quote:${quote.id}`
    const key = JSON.stringify([site, quote.modelId ?? null])
    const current = sites.get(key)
    if (!current || compareMultipliers(quote, current) < 0) sites.set(key, quote)
  }
  return [...sites.values()]
}
