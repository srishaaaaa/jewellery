import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SoundProvider } from './context/SoundContext'

// Suppress benign Chrome extension / message channel disconnect noise
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const errorMsg =
      event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === 'string'
        ? event.reason
        : (event.reason && typeof event.reason === 'object' && 'message' in event.reason)
        ? String((event.reason as { message?: unknown }).message)
        : ''

    if (
      errorMsg.includes('message channel closed before a response was received') ||
      errorMsg.includes('A listener indicated an asynchronous response') ||
      errorMsg.includes('ResizeObserver loop completed with undelivered notifications')
    ) {
      event.preventDefault()
      event.stopImmediatePropagation?.()
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SoundProvider>
      <App />
    </SoundProvider>
  </StrictMode>,
)

