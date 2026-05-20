import { registerSW } from 'virtual:pwa-register';
import { getPushSubscription, isPushSupported, savePushSubscription } from './pushNotifications';

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * If the user previously granted notification permission and already has a
 * subscription, re-send it to the backend on app start. This covers token
 * refresh / backend data loss without prompting the user again.
 */
async function resyncExistingPushSubscription(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const subscription = await getPushSubscription();
    if (subscription) {
      await savePushSubscription(subscription);
    }
  } catch {
    // best-effort — do not block app boot
  }
}

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
      void import('../core/bridge/chatCoreClient')
        .then(({ default: chatCoreClient }) => chatCoreClient.shutdown())
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

      // Re-sync any existing push subscription with the backend.
      void resyncExistingPushSubscription();
    },
    onRegisterError(error: unknown) {
      // eslint-disable-next-line no-console
      console.warn('[PWA] Service Worker register failed', error);
    },
  });
}
