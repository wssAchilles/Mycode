import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  APP_SW_UPDATE_AVAILABLE_EVENT,
  applyPendingServiceWorkerUpdate,
} from '../../pwa/register';
import './SwUpdateBanner.css';

/**
 * 非阻塞式应用更新提醒胶囊：在发现新版本时提示用户手动刷新，不打断当前聊天或表单操作
 */
export const SwUpdateBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleUpdateAvailable = () => {
      setVisible(true);
    };
    window.addEventListener(APP_SW_UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);
    return () => {
      window.removeEventListener(APP_SW_UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);
    };
  }, []);

  if (!visible) return null;

  return (
    <aside className="sw-update-banner" role="status" aria-live="polite" aria-label="发现应用新版本">
      <span className="sw-update-banner__text">发现新版本已就绪</span>
      <button
        type="button"
        className="sw-update-banner__btn is-primary"
        disabled={isUpdating}
        onClick={() => {
          setIsUpdating(true);
          void applyPendingServiceWorkerUpdate();
        }}
      >
        <RefreshCw size={13} className={isUpdating ? 'is-spinning' : ''} aria-hidden="true" />
        <span>{isUpdating ? '更新中...' : '立即更新'}</span>
      </button>
      <button
        type="button"
        className="sw-update-banner__close"
        aria-label="稍后提醒更新"
        onClick={() => setVisible(false)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </aside>
  );
};

export default SwUpdateBanner;
