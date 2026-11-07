// Loaded into the app's service worker: shows customer alerts even when the portal is closed.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* not JSON */ }
  event.waitUntil(self.registration.showNotification(data.title || 'New notification', {
    body: data.body || '',
    icon: '/nandi-logo-192.jpeg',
    tag: data.tag || undefined,
    data: { url: data.url || '/customer/notifications' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data && event.notification.data.url
  if (!url) return
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
    const portal = open.find((c) => new URL(c.url).pathname.startsWith('/customer'))
    if (portal) return portal.focus().then((c) => c.navigate(url)).catch(() => self.clients.openWindow(url))
    return self.clients.openWindow(url)
  }))
})
