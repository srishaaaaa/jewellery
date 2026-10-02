import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders a pop-up directly under <body>. Pop-ups opened from inside the
 * dashboard's scrolling content area are otherwise clipped to that area on
 * iPhone Safari, so the app header and footer cover their top and bottom.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>
  return createPortal(children, document.body)
}
