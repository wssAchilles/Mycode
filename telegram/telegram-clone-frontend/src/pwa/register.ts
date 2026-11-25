import { registerSW } from 'virtual:pwa-register';
import { getPushSubscription, isPushSupported, savePushSubscription } from './pushNotifications';

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 新版本 Service Worker 就绪广播事件名（供非阻塞更新提示条消费，避免会话途中强刷页面）
 */
export const APP_SW_UPDATE_AVAILABLE_EVENT = 'app:sw-update-available';

let pendingUpdateTrigger: ((reloadPage?: boolean) => Promise<void>) | null = null;

/**
 * 由用户主动确认触发待生效的 Service Worker 更新并刷新页面
 */
export async function applyPendingServiceWorkerUpdate(): Promise<void> {
  const trigger = pendingUpdateTrigger;
  pendingUpdateTrigger = null;
  if (!trigger) {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
    return;
  }

  await import('../core/bridge/chatCoreClient')
    .then(({ default: chatCoreClient }) => chatCoreClient.shutdown())
    .catch(() => undefined)
    .finally(() => {
      void trigger(true);
    });
}

/**
 * 若用户此前已开启推送权限且存在订阅，启动时静默同步至后端，避免重复弹窗请求权限
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
    // 后台尽最大努力重同步，不阻断启动流程
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
      // 严禁在聊天或弹窗操作途中静默强制整页重载，改为派发非阻塞更新提醒由用户自主决定时机
      pendingUpdateTrigger = updateSW;
      window.dispatchEvent(new CustomEvent(APP_SW_UPDATE_AVAILABLE_EVENT));
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

      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });

      void resyncExistingPushSubscription();
    },
    onRegisterError(error: unknown) {
      // eslint-disable-next-line no-console
      console.warn('[PWA] Service Worker register failed', error);
    },
  });
}
