import { API_BASE_URL } from '../utils/apiUrl';
import { useAuthStore } from '../stores/useAuthStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function extractKeys(subscription: PushSubscription): PushSubscriptionPayload['keys'] {
  const p256dh = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');
  if (!p256dh || !auth) {
    throw new Error('Push subscription is missing required keys');
  }
  return {
    p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
    auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Whether the current browser supports Push API + Notification API.
 */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Get the current push subscription, if any.
 */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Request notification permission, subscribe to push, and persist the
 * subscription on the backend.
 *
 * Returns the subscription on success, or `null` if the user denied
 * permission or the browser does not support push.
 */
export async function subscribeToPushNotifications(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidKey) {
    console.warn('[Push] VITE_VAPID_PUBLIC_KEY is not configured');
    return null;
  }

  // 1. Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('[Push] Notification permission denied');
    return null;
  }

  // 2. Subscribe via the service worker
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  // 3. Persist on backend
  await savePushSubscription(subscription);

  return subscription;
}

/**
 * POST the push subscription to the backend so it can send notifications.
 */
export async function savePushSubscription(subscription: PushSubscription): Promise<void> {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) {
    console.warn('[Push] No access token — cannot save subscription');
    return;
  }

  const payload: PushSubscriptionPayload = {
    endpoint: subscription.endpoint,
    keys: extractKeys(subscription),
  };

  const response = await fetch(`${API_BASE_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.warn('[Push] Failed to save subscription:', response.status);
  }
}
