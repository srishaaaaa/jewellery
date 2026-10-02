// Scrolling utilities for smooth mobile and desktop scrolling

/**
 * Ensure element is visible in scrollable parent
 */
export function scrollIntoView(element: HTMLElement, options?: ScrollIntoViewOptions) {
  if (!element) return
  try {
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
      ...options,
    })
  } catch (err) {
    // Fallback for older browsers
    element.scrollIntoView()
  }
}

/**
 * Fix scrolling on iOS by enabling momentum scrolling
 */
export function enableMomentumScrolling(element: HTMLElement) {
  if (!element) return
  ;(element.style as any).WebkitOverflowScrolling = 'touch'
}

/**
 * Disable scroll on body/html
 */
export function disableScroll() {
  if (typeof document === 'undefined') return
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
  document.documentElement.style.overflow = 'hidden'
  if (scrollbarWidth > 0) {
    document.documentElement.style.paddingRight = `${scrollbarWidth}px`
  }
}

/**
 * Enable scroll on body/html
 */
export function enableScroll() {
  if (typeof document === 'undefined') return
  document.documentElement.style.overflow = ''
  document.documentElement.style.paddingRight = ''
}

/**
 * Check if element is scrollable
 */
export function isScrollable(element: HTMLElement): boolean {
  if (!element) return false
  const { clientHeight, scrollHeight } = element
  return scrollHeight > clientHeight
}

/**
 * Get scroll position info
 */
export function getScrollInfo(element: HTMLElement) {
  if (!element) return null
  return {
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    isAtTop: element.scrollTop === 0,
    isAtBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 10,
    isAtStart: element.scrollLeft === 0,
    isAtEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 10,
  }
}

/**
 * Smooth scroll to top
 */
export function scrollToTop(element?: HTMLElement, duration = 300) {
  const target = element || window
  const start = element ? element.scrollTop : window.scrollY
  const startTime = Date.now()

  const scroll = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / duration, 1)
    const easeOutQuad = 1 - (1 - progress) ** 2

    if (element) {
      element.scrollTop = start * (1 - easeOutQuad)
    } else {
      window.scrollTo(0, start * (1 - easeOutQuad))
    }

    if (progress < 1) {
      requestAnimationFrame(scroll)
    }
  }

  requestAnimationFrame(scroll)
}

/**
 * Hook to detect scroll position
 */
export function useScrollPosition() {
  const [scrollPosition, setScrollPosition] = React.useState(0)

  React.useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return scrollPosition
}

import React from 'react'
