/**
 * Shows a phone / desktop notification. Android Chrome only allows notifications through the
 * service worker, so that is tried first; desktop browsers fall back to new Notification().
 * Asks for permission the first time.
 */
export async function systemNotify(title: string, body: string, tag = 'jewellery-pos'): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  let permission = Notification.permission
  if (permission === 'default') {
    try { permission = await Notification.requestPermission() } catch { return }
  }
  if (permission !== 'granted') return
  const options: NotificationOptions = { body, tag, icon: '/nandi-logo-192.jpeg' }
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg) { await reg.showNotification(title, options); return }
  } catch { /* fall back below */ }
  try { new Notification(title, options) } catch { /* not allowed here */ }
}
