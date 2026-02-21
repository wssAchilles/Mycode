import { registerSW } from 'virtual:pwa-register';
import chatCoreClient from '../core/bridge/chatCoreClient';

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  let lastUpdateCheckAt = 0;
  const shouldCheckNow = () => {
    const now = Date.now();
    if (now - lastUpdateCheckAt < 60_000) return false;
    lastUpdateCheckAt = now;
    return true;
  };

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Keep it simple and explicit for now; later we can replace with in-app toast.
      const ok = window.confirm('检测到新版本，是否立即刷新？');
      if (!ok) return;
      void chatCoreClient
        .shutdown()
        .catch(() => undefined)
        .finally(() => {
          updateSW(true);
        });
    },
    onOfflineReady() {
      // eslint-disable-next-line no-console
      console.log('[PWA] 离线缓存已就绪');
    },
    onRegistered(r?: ServiceWorkerRegistration) {
      // eslint-disable-next-line no-console
      console.log('[PWA] Service Worker registered', r?.scope);
      if (!r) return;

      const checkForUpdate = () => {
        if (!shouldCheckNow()) return;
        r.update().catch(() => undefined);
      };

      // Periodic checks reduce worker/wasm version skew in long-lived tabs.
      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });
    },
    onRegisterError(error: unknown) {
      // eslint-disable-next-line no-console
      console.warn('[PWA] Service Worker register failed', error);
    },
  });
}
