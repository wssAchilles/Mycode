import { registerSW } from 'virtual:pwa-register';

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Keep it simple and explicit for now; later we can replace with in-app toast.
      const ok = window.confirm('检测到新版本，是否立即刷新？');
      if (ok) updateSW(true);
    },
    onOfflineReady() {
      // eslint-disable-next-line no-console
      console.log('[PWA] 离线缓存已就绪');
    },
    onRegistered(r?: ServiceWorkerRegistration) {
      // eslint-disable-next-line no-console
      console.log('[PWA] Service Worker registered', r?.scope);
    },
    onRegisterError(error: unknown) {
      // eslint-disable-next-line no-console
      console.warn('[PWA] Service Worker register failed', error);
    },
  });
}
