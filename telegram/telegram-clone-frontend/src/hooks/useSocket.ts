import { useEffect, useRef, useCallback, useState } from 'react';
import socketService from '../services/socketService';
import { authUtils } from '../services/apiClient';

// useSocket Hook
export const useSocket = () => {
  const isInitialized = useRef(false);
  const [isConnected, setIsConnected] = useState(false);

  // 初始化 Socket 连接
  const initializeSocket = useCallback(() => {
    if (!isInitialized.current && authUtils.isAuthenticated()) {
      const socket = socketService.connect();
      if (socket) {
        isInitialized.current = true;
        console.log('🔌 Socket.IO Hook 初始化成功');
      }
    }
  }, []);

  // 断开 Socket 连接
  const disconnectSocket = useCallback(() => {
    if (isInitialized.current) {
      socketService.disconnect();
      isInitialized.current = false;
      console.log('🔌 Socket.IO Hook 断开连接');
    }
  }, []);

  // 发送消息
  const sendMessage = useCallback((content: string, receiverId?: string, groupId?: string) => {
    socketService.sendSimpleMessage(content, receiverId, groupId);
  }, []);

  const joinRoom = useCallback((roomId: string) => {
    socketService.joinRoom(roomId);
  }, []);

  const leaveRoom = useCallback((roomId: string) => {
    socketService.leaveRoom(roomId);
  }, []);

  const markChatRead = useCallback((chatId: string, seq: number) => {
    socketService.markChatRead(chatId, seq);
  }, []);

  // 监听消息
  const onMessage = useCallback((callback: (data: any) => void) => {
    socketService.onMessage(callback);

    // 返回清理函数
    return () => {
      socketService.off('message', callback);
    };
  }, []);

  // 监听用户上线
  const onUserOnline = useCallback((callback: (user: { userId: string; username: string }) => void) => {
    socketService.onUserOnline(callback);

    return () => {
      socketService.off('userOnline', callback);
    };
  }, []);

  // 监听用户下线
  const onUserOffline = useCallback((callback: (user: { userId: string; username: string }) => void) => {
    socketService.onUserOffline(callback);

    return () => {
      socketService.off('userOffline', callback);
    };
  }, []);

  // 监听在线用户列表
  const onOnlineUsers = useCallback((callback: (users: any[]) => void) => {
    socketService.onOnlineUsers(callback);

    return () => {
      socketService.off('onlineUsers', callback);
    };
  }, []);

  const onReadReceipt = useCallback((callback: (data: { chatId: string; seq: number; readCount: number; readerId: string }) => void) => {
    socketService.onReadReceipt(callback);

    return () => {
      socketService.off('readReceipt', callback);
    };
  }, []);

  // 监听连接状态变化
  useEffect(() => {
    const checkConnection = () => {
      setIsConnected(socketService.isConnected());
    };

    // 初始检查
    checkConnection();

    // 定期检查连接状态
    const interval = setInterval(checkConnection, 1000);

    return () => clearInterval(interval);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      // 组件卸载时不立即断开连接，让其他组件也能使用
      // disconnectSocket();
    };
  }, []);

  return {
    initializeSocket,
    disconnectSocket,
    sendMessage,
    joinRoom,
    leaveRoom,
    markChatRead,
    onMessage,
    onUserOnline,
    onUserOffline,
    onOnlineUsers,
    onReadReceipt,
    isConnected,
  };
};

// useSocketEffect Hook - 用于自动连接和清理
export const useSocketEffect = () => {
  const { initializeSocket, disconnectSocket } = useSocket();

  useEffect(() => {
    // 如果用户已认证，则自动连接
    if (authUtils.isAuthenticated()) {
      initializeSocket();
    }

    // 监听认证状态变化
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'accessToken') {
        if (e.newValue) {
          // 用户登录，初始化连接
          initializeSocket();
        } else {
          // 用户登出，断开连接
          disconnectSocket();
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [initializeSocket, disconnectSocket]);
};

export default useSocket;
