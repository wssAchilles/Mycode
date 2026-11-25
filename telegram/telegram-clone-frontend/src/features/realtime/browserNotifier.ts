/**
 * 浏览器标题未读数同步、桌面通知与轻量 Web Audio 提示音工具
 */

let sharedAudioCtx: AudioContext | null = null;
const lastNotifyAtByChat = new Map<string, number>();

const NOTIFY_COOLDOWN_MS = 1500;

/**
 * 同步浏览器标签页标题未读总数
 */
export function syncDocumentTitle(totalUnread: number, baseTitle = 'Telegram Clone'): void {
  if (typeof document === 'undefined') return;
  if (totalUnread > 0) {
    const label = totalUnread > 99 ? '99+' : String(totalUnread);
    document.title = `(${label}) ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }
}

/**
 * 播放柔和的双音提示（纯 Web Audio API 合成，零外部静态资源依赖）
 */
export function playMessageChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume().catch(() => undefined);
    }

    const now = sharedAudioCtx.currentTime;
    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.06);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  } catch {
    // 无音频设备或尚未获得手势激活时静默忽略
  }
}

/**
 * 安全申请浏览器桌面通知权限
 */
export async function requestDesktopNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export interface IncomingNotifyOptions {
  chatId: string;
  title: string;
  body: string;
  muted?: boolean;
  desktopEnabled?: boolean;
  soundEnabled?: boolean;
  now?: number;
  onClick?: () => void;
}

/**
 * 按免打扰规则、节流窗口与用户开关触发新消息声音及系统通知
 */
export function notifyIncomingMessage(options: IncomingNotifyOptions): boolean {
  if (options.muted) return false;
  const now = options.now ?? Date.now();
  const prevAt = lastNotifyAtByChat.get(options.chatId) ?? 0;
  if (now - prevAt < NOTIFY_COOLDOWN_MS) return false;
  lastNotifyAtByChat.set(options.chatId, now);

  let triggered = false;
  if (options.soundEnabled) {
    playMessageChime();
    triggered = true;
  }

  if (
    options.desktopEnabled
    && typeof Notification !== 'undefined'
    && Notification.permission === 'granted'
  ) {
    try {
      const notification = new Notification(options.title, {
        body: options.body,
        tag: `tg-chat-${options.chatId}`,
      });
      notification.onclick = () => {
        try {
          if (typeof window !== 'undefined') window.focus();
        } catch {
          // ignore
        }
        options.onClick?.();
        notification.close();
      };
      triggered = true;
    } catch {
      // 某些受限上下文不允许实例化 Notification
    }
  }

  return triggered;
}

export function resetNotifierThrottleForTests(): void {
  lastNotifyAtByChat.clear();
}
