import React from 'react';
import { useMessageStore } from '../features/chat/store/messageStore';

// 实时连接状态轻量胶囊指示器（淡色高对比风格）
const ConnectionStatus: React.FC = () => {
  const isConnected = useMessageStore((state) => state.socketConnected);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '12px',
        right: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderRadius: '9999px',
        backgroundColor: '#FFFFFF',
        border: '1px solid #EFF3F4',
        boxShadow: '0 4px 12px rgba(15, 20, 25, 0.08)',
        color: '#0F1419',
        fontSize: '12px',
        fontWeight: 600,
        zIndex: 1000,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: isConnected ? '#00BA7C' : '#E11D48',
          flexShrink: 0,
        }}
      />
      <span>{isConnected ? '已连接' : '连接断开'}</span>
    </div>
  );
};

export default ConnectionStatus;
