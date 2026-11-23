/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: unknown[] };

const AVATAR_CACHE_NAME = 'tg-avatars-immutable-v1';
const AVATAR_CACHE_PREFIX = 'tg-avatars-immutable-';
const AVATAR_CACHE_MAX_ENTRIES = 400;
const PUBLIC_SPACE_UPLOAD_PATH = '/api/public/space/uploads/';

// ---------------------------------------------------------------------------
// 1. Workbox precache — injected at build time by vite-plugin-pwa
// ---------------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ---------------------------------------------------------------------------
// 2. 不可变头像与公共图片 CacheFirst 持久缓存（最高 400 条，LRU 顺序淘汰）
// ---------------------------------------------------------------------------
async function putImmutableAvatarCache(request: Request, response: Response): Promise<void> {
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    await cache.put(request, response);
    const keys = await cache.keys();
    if (keys.length > AVATAR_CACHE_MAX_ENTRIES) {
      const evictCount = keys.length - AVATAR_CACHE_MAX_ENTRIES;
      await Promise.all(keys.slice(0, evictCount).map((oldKey) => cache.delete(oldKey)));
    }
  } catch {
    // 磁盘配额不足时静默降级，不影响图片展示
  }
}

async function handleImmutableAvatarFetch(
  event: FetchEvent,
  request: Request,
): Promise<Response> {
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    const networkResponse = await fetch(request);
    if (networkResponse.ok && networkResponse.status === 200) {
      const cloned = networkResponse.clone();
      event.waitUntil(putImmutableAvatarCache(request, cloned));
    }
    return networkResponse;
  } catch {
    return fetch(request);
  }
}

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter(
            (name) => name.startsWith(AVATAR_CACHE_PREFIX) && name !== AVATAR_CACHE_NAME,
          )
          .map((obsoleteName) => caches.delete(obsoleteName)),
      ),
    ),
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return;
  }

  if (!parsedUrl.pathname.startsWith(PUBLIC_SPACE_UPLOAD_PATH)) {
    return;
  }

  event.respondWith(handleImmutableAvatarFetch(event, request));
});

// ---------------------------------------------------------------------------
// 3. Push notification handler
// ---------------------------------------------------------------------------
self.addEventListener('push', (event: PushEvent) => {
  let data: { title?: string; body?: string; icon?: string; badge?: string; tag?: string; url?: string } = {};

  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Telegram', body: event.data?.text() ?? '' };
  }

  const title = data.title ?? 'Telegram';
  const options: NotificationOptions = {
    body: data.body ?? '',
    icon: data.icon ?? '/pwa-192x192.png',
    badge: data.badge ?? '/pwa-192x192.png',
    tag: data.tag ?? 'default',
    data: { url: data.url ?? '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------------
// 4. Notification click handler — focus existing window or open a new one
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const targetUrl = (event.notification.data?.url as string) ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 如果已有匹配窗口打开则直接聚焦
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // 否则打开新窗口
      return self.clients.openWindow(targetUrl);
    }),
  );
});
