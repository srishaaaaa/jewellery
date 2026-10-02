// Simple in-memory cache with TTL support
interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class ResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>()

  set<T>(key: string, data: T, ttlSeconds = 300): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000,
    })
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null

    const isExpired = Date.now() - entry.timestamp > entry.ttl
    if (isExpired) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  invalidate(keyPattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(keyPattern)) {
        this.cache.delete(key)
      }
    }
  }

  clear(): void {
    this.cache.clear()
  }
}

export const responseCache = new ResponseCache()

// Helper to create cache keys
export const cacheKey = {
  products: () => 'products:all',
  categories: () => 'categories:all',
  orders: (filter?: string) => `orders:${filter || 'all'}`,
  customers: () => 'customers:all',
  expenses: (range?: string) => `expenses:${range || 'all'}`,
  settings: () => 'settings:store',
}

// Helper hook for debounced API calls with caching
export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = 300
): { data: T | null; isLoading: boolean; error: Error | null; refetch: () => Promise<void> } {
  const [data, setData] = React.useState<T | null>(() => responseCache.get<T>(key))
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<Error | null>(null)

  const refetch = React.useCallback(async () => {
    const cached = responseCache.get<T>(key)
    if (cached && !isLoading) {
      setData(cached)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      responseCache.set(key, result, ttlSeconds)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Fetch failed'))
    } finally {
      setIsLoading(false)
    }
  }, [key, fetcher, ttlSeconds])

  React.useEffect(() => {
    refetch()
  }, [key, refetch])

  return { data, isLoading, error, refetch }
}

// Export for use in non-React code
import React from 'react'
