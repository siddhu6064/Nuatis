// Minimal service worker for PWA installability + push notifications
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : { title: 'Nuatis', body: 'New notification' }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.url ? { url: data.url } : undefined,
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  if (e.notification.data && e.notification.data.url) {
    e.waitUntil(self.clients.openWindow(e.notification.data.url))
  }
})
