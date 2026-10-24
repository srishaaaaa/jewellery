/**
 * Keeps the browser's "install this app" prompt so the login page can offer it.
 * The beforeinstallprompt event can fire before that page renders, so it is caught
 * here as soon as the app loads (imported from main.tsx).
 */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

export const isRunningInstalled = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export const canInstall = () => Boolean(deferred) && !isRunningInstalled()

export const subscribeInstall = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Shows the browser's install dialog; true when the user accepted. */
export const promptInstall = async () => {
  if (!deferred) return false
  const event = deferred
  await event.prompt()
  const { outcome } = await event.userChoice
  deferred = null
  notify()
  return outcome === 'accepted'
}
