import { useEffect, useRef, useCallback, useState } from 'react';
import socketService from '../services/socketService';
import { authUtils } from '../services/apiClient';
import { throttleWithTickEnd } from '../core/workers/schedulers';
import type { SocketRealtimeEvent } from '../core/chat/realtime';

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

  // 批量监听消息：降低高频 socket 事件对主线程函数调度的压力。
  const onMessageBatch = useCallback((callback: (batch: any[]) => void) => {
    let queue: any[] = [];
    const flush = throttleWithTickEnd(() => {
      if (!queue.length) return;
      const batch = queue;
      queue = [];
      callback(batch);
    });

    const handler = (data: any) => {
      queue.push(data);
      flush();
    };

    socketService.onMessage(handler);
    return () => {
      queue = [];
      socketService.off('message', handler);
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

  const onPresenceBatch = useCallback(
    (callback: (batch: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>) => void) => {
      let queue: Array<{ userId: string; isOnline: boolean; lastSeen?: string }> = [];
      const flush = throttleWithTickEnd(() => {
        if (!queue.length) return;
        const merged = new Map<string, { userId: string; isOnline: boolean; lastSeen?: string }>();
        for (const item of queue) {
          if (!item?.userId) continue;
          merged.set(item.userId, item);
        }
        queue = [];
        if (!merged.size) return;
        callback(Array.from(merged.values()));
      });

      const handleOnlineUsers = (users: any[]) => {
        if (!Array.isArray(users)) return;
        for (const user of users) {
          if (!user?.userId) continue;
          queue.push({
            userId: String(user.userId),
            isOnline: true,
            lastSeen: user.lastSeen ? String(user.lastSeen) : undefined,
          });
        }
        flush();
      };

      const handleUserOnline = (user: any) => {
        if (!user?.userId) return;
        queue.push({
          userId: String(user.userId),
          isOnline: true,
          lastSeen: user.lastSeen ? String(user.lastSeen) : undefined,
        });
        flush();
      };

      const handleUserOffline = (user: any) => {
        if (!user?.userId) return;
        queue.push({
          userId: String(user.userId),
          isOnline: false,
          lastSeen: user.lastSeen ? String(user.lastSeen) : undefined,
        });
        flush();
      };

      socketService.onOnlineUsers(handleOnlineUsers);
      socketService.onUserOnline(handleUserOnline);
      socketService.onUserOffline(handleUserOffline);

      return () => {
        queue = [];
        socketService.off('onlineUsers', handleOnlineUsers);
        socketService.off('userOnline', handleUserOnline);
        socketService.off('userOffline', handleUserOffline);
      };
    },
    [],
  );

  const onReadReceipt = useCallback((callback: (data: { chatId: string; seq: number; readCount: number; readerId: string }) => void) => {
    socketService.onReadReceipt(callback);

    return () => {
      socketService.off('readReceipt', callback);
    };
  }, []);

  const onReadReceiptBatch = useCallback(
    (callback: (batch: Array<{ chatId: string; seq: number; readCount: number; readerId: string }>) => void) => {
      let queue: Array<{ chatId: string; seq: number; readCount: number; readerId: string }> = [];
      const flush = throttleWithTickEnd(() => {
        if (!queue.length) return;
        const batch = queue;
        queue = [];
        callback(batch);
      });

      const handler = (data: { chatId: string; seq: number; readCount: number; readerId: string }) => {
        queue.push(data);
        flush();
      };

      socketService.onReadReceipt(handler);
      return () => {
        queue = [];
        socketService.off('readReceipt', handler);
      };
    },
    [],
  );

  const onGroupUpdate = useCallback((callback: (data: any) => void) => {
    socketService.onGroupUpdate(callback);

    return () => {
      socketService.off('groupUpdate', callback);
    };
  }, []);

  const onGroupUpdateBatch = useCallback((callback: (batch: any[]) => void) => {
    let queue: any[] = [];
    const flush = throttleWithTickEnd(() => {
      if (!queue.length) return;
      const batch = queue;
      queue = [];
      callback(batch);
    });

    const handler = (data: any) => {
      queue.push(data);
      flush();
    };

    socketService.onGroupUpdate(handler);
    return () => {
      queue = [];
      socketService.off('groupUpdate', handler);
    };
  }, []);

  const onRealtimeBatch = useCallback((callback: (events: SocketRealtimeEvent[]) => void) => {
    let queue: SocketRealtimeEvent[] = [];
    const flush = throttleWithTickEnd(() => {
      if (!queue.length) return;
      const batch = queue;
      queue = [];

      const messages: SocketRealtimeEvent[] = [];
      const presences = new Map<string, SocketRealtimeEvent>();
      const readReceipts = new Map<string, SocketRealtimeEvent>();
      const groupUpdates: SocketRealtimeEvent[] = [];

      for (const event of batch) {
        if (event.type === 'message') {
          messages.push(event);
          continue;
        }
        if (event.type === 'presence') {
          const userId = event.payload?.userId ? String(event.payload.userId) : '';
          if (!userId) continue;
          presences.set(userId, event);
          continue;
        }
        if (event.type === 'readReceipt') {
          const chatId = event.payload?.chatId ? String(event.payload.chatId) : '';
          const seq = event.payload?.seq;
          if (!chatId || typeof seq !== 'number') continue;
          const key = `${chatId}:${seq}`;
          const current = readReceipts.get(key);
          const nextCount = typeof event.payload.readCount === 'number' ? event.payload.readCount : 1;
          const curCount =
            current && typeof current.payload.readCount === 'number'
              ? current.payload.readCount
              : 0;
          if (!current || nextCount >= curCount) {
            readReceipts.set(key, event);
          }
          continue;
        }
        if (event.type === 'groupUpdate') {
          groupUpdates.push(event);
        }
      }

      callback([
        ...messages,
        ...presences.values(),
        ...readReceipts.values(),
        ...groupUpdates,
      ]);
    });

    const handleMessage = (data: any) => {
      if (data?.type !== 'chat' || !data?.data) return;
      const message = data.data;
      if (!message.content && !message.fileUrl && !message.attachments) return;
      queue.push({ type: 'message', payload: message });
      flush();
    };

    const handleOnlineUsers = (users: any[]) => {
      if (!Array.isArray(users)) return;
      for (const user of users) {
        if (!user?.userId) continue;
        queue.push({
          type: 'presence',
          payload: {
            userId: String(user.userId),
            isOnline: true,
            lastSeen: user.lastSeen ? String(user.lastSeen) : undefined,
          },
        });
      }
      flush();
    };

    const handleUserOnline = (user: any) => {
      if (!user?.userId) return;
      queue.push({
        type: 'presence',
        payload: {
          userId: String(user.userId),
          isOnline: true,
          lastSeen: user.lastSeen ? String(user.lastSeen) : undefined,
        },
      });
      flush();
    };

    const handleUserOffline = (user: any) => {
      if (!user?.userId) return;
      queue.push({
        type: 'presence',
        payload: {
          userId: String(user.userId),
          isOnline: false,
          lastSeen: user.lastSeen ? String(user.lastSeen) : undefined,
        },
      });
      flush();
    };

    const handleReadReceipt = (data: { chatId: string; seq: number; readCount: number; readerId: string }) => {
      if (!data?.chatId || typeof data.seq !== 'number') return;
      queue.push({
        type: 'readReceipt',
        payload: {
          chatId: data.chatId,
          seq: data.seq,
          readCount: typeof data.readCount === 'number' ? data.readCount : 1,
          readerId: data.readerId,
        },
      });
      flush();
    };

    const handleGroupUpdate = (data: any) => {
      if (!data?.groupId) return;
      queue.push({ type: 'groupUpdate', payload: data });
      flush();
    };

    socketService.onMessage(handleMessage);
    socketService.onOnlineUsers(handleOnlineUsers);
    socketService.onUserOnline(handleUserOnline);
    socketService.onUserOffline(handleUserOffline);
    socketService.onReadReceipt(handleReadReceipt);
    socketService.onGroupUpdate(handleGroupUpdate);

    return () => {
      queue = [];
      socketService.off('message', handleMessage);
      socketService.off('onlineUsers', handleOnlineUsers);
      socketService.off('userOnline', handleUserOnline);
      socketService.off('userOffline', handleUserOffline);
      socketService.off('readReceipt', handleReadReceipt);
      socketService.off('groupUpdate', handleGroupUpdate);
    };
  }, []);

  // 监听连接状态变化
  useEffect(() => {
    const onChange = (connected: boolean) => setIsConnected(connected);
    socketService.addConnectionListener(onChange);
    return () => socketService.removeConnectionListener(onChange);
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
    onMessageBatch,
    onUserOnline,
    onUserOffline,
    onOnlineUsers,
    onPresenceBatch,
    onReadReceipt,
    onReadReceiptBatch,
    onGroupUpdate,
    onGroupUpdateBatch,
    onRealtimeBatch,
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

    return () => {
      // 页面卸载时断开连接
      disconnectSocket();
    };
  }, [initializeSocket, disconnectSocket]);
};

export default useSocket;
