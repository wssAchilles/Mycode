import React from 'react';
import { useSocket } from '../hooks/useSocket';

const ConnectionStatus: React.FC = () => {
  const { isConnected } = useSocket();

  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      right: '10px',
      padding: '8px 12px',
      borderRadius: '4px',
      color: 'white',
      fontSize: '12px',
      fontWeight: 'bold',
      backgroundColor: isConnected ? '#4CAF50' : '#f44336',
      zIndex: 1000
    }}>
      {isConnected ? '🟢 已连接' : '🔴 连接断开'}
    </div>
  );
};

export default ConnectionStatus;
