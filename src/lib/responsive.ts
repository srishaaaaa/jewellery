// Responsive utility classes for consistent mobile design
// Use these classes to ensure mobile-first design patterns

export const responsive = {
  // Touch-friendly button sizes (44px minimum)
  button: {
    sm: 'h-11 min-h-11 px-3',        // Small button: 44px height
    md: 'h-12 min-h-12 px-4',        // Medium button: 48px height
    lg: 'h-13 min-h-13 px-5',        // Large button: 52px height
  },

  // Input field sizes (44px minimum on mobile)
  input: {
    sm: 'h-11 min-h-11 px-3 text-sm',    // Small input: 44px height
    md: 'h-12 min-h-12 px-3.5 text-base', // Medium input: 48px height
    lg: 'h-13 min-h-13 px-4 text-base',   // Large input: 52px height
  },

  // Responsive font sizes (16px on mobile to prevent iOS zoom)
  text: {
    xs: 'text-xs md:text-[10px]',
    sm: 'text-sm md:text-xs',
    base: 'text-base md:text-sm',
    lg: 'text-lg md:text-base',
    xl: 'text-xl md:text-lg',
    '2xl': 'text-2xl md:text-xl',
    '3xl': 'text-3xl md:text-2xl',
  },

  // Responsive padding
  padding: {
    mobile: 'px-3 py-3 sm:px-4 sm:py-3.5',
    form: 'p-4 sm:p-5 md:p-6',
    card: 'p-3 sm:p-4',
    section: 'px-3 py-4 sm:px-4 sm:py-5',
  },

  // Responsive spacing for touchable elements
  spacing: {
    touch: 'space-y-3 sm:space-y-4',  // Better spacing for touch on mobile
    dense: 'space-y-2 sm:space-y-2.5',
  },

  // Table responsive wrapper
  tableWrapper: 'overflow-x-auto rounded-xl border border-[#E5E7EB]/30',
  tableScroll: 'scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100',

  // Card responsive
  card: 'rounded-2xl border border-[#ECE9E2] bg-white p-3 sm:p-4 shadow-sm',
  cardCompact: 'rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-sm',

  // Modal responsive
  modal: {
    container: 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs',
    content: 'bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl',
    header: 'px-4 sm:px-5 py-3 border-b border-gray-200 bg-[#FBFAF6]',
    body: 'p-4 sm:p-5 space-y-3',
    footer: 'px-4 sm:px-5 py-3 border-t border-gray-200 bg-[#FBFAF6] flex gap-2',
  },

  // Grid responsive
  grid: {
    cols2: 'grid gap-3 sm:grid-cols-2',
    cols3: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3',
    cols4: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
  },

  // Flex responsive
  flexBetween: 'flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3',
  flexCenter: 'flex items-center justify-center',
  flexStart: 'flex items-start justify-start',
}

// Helper to check viewport
export const useIsMobile = (breakpoint = 768) => {
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isMobile
}

import React from 'react'
