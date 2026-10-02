import React, { Suspense } from 'react'

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-96">
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent)]"></div>
      <p className="mt-4 text-sm text-[#6B7280]">Loading...</p>
    </div>
  </div>
)

// Lazy load wrapper
export function lazyComponent<P extends object>(
  loader: () => Promise<{ default: React.ComponentType<P> }>,
  name = 'LazyComponent'
) {
  const Component = React.lazy(loader)

  const LazyWrapper = (props: P) => (
    <Suspense fallback={<LoadingFallback />}>
      <Component {...props} />
    </Suspense>
  )
  LazyWrapper.displayName = name

  return LazyWrapper
}

// Preload utility for critical components
export function preloadComponent(
  loader: () => Promise<{ default: React.ComponentType<any> }>
) {
  loader()
}
