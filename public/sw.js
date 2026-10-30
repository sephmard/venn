// Venn's service worker: only notifications. It shows what the server pushes (src/push.js) when
// someone answers, and a tap opens the poll. It caches nothing, so pages load as they always do.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m;
  try {
    m = e.data?.json() || {};
  } catch {
    m = { body: e.data?.text() || '' };
  }
  e.waitUntil(
    self.registration.showNotification(m.title || 'Venn', {
      body: m.body || '',
      tag: m.tag, // a poll's newest news replaces its last
      renotify: !!m.tag,
      icon: '/icons/icon-192.png',
      data: { url: m.url || '/' },
    }),
  );
});

// A tap: back to the poll if it's open, or open it.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
      const tab = open.find((c) => c.url.split('#')[0] === url);
      return tab ? tab.focus() : self.clients.openWindow(url);
    }),
  );
});
