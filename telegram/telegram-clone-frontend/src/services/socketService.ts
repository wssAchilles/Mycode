import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SendMessageData } from '../types/chat';
import { authUtils } from './apiClient';

// Socket.IO 配置
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://telegram-clone-backend-88ez.onrender.com';

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  // 连接到 Socket.IO 服务器
  connect(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    const token = authUtils.getAccessToken();

    if (!token) {
      console.warn('没有访问令牌，无法连接到 Socket.IO 服务器');
      return null;
    }

    if (this.socket?.connected) {
      console.log('Socket.IO 已经连接');
      return this.socket;
    }

    try {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        timeout: 5000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        forceNew: true,
      });

      this.setupEventListeners();

      // 连接后立即认证
      this.socket.on('connect', () => {
        console.log('🔌 Socket.IO 连接成功');
        this.reconnectAttempts = 0;
        this.authenticate();
      });

      return this.socket;
    } catch (error) {
      console.error('Socket.IO 连接失败:', error);
      return null;
    }
  }

  // 设置事件监听器
  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect_error', (error) => {
      console.error('Socket.IO 连接错误:', error);
      this.reconnectAttempts++;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Socket.IO 重连次数超限，停止重连');
        this.disconnect();
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket.IO 连接断开:', reason);

      if (reason === 'io server disconnect') {
        // 服务器主动断开，可能是认证失败
        console.warn('服务器主动断开连接，可能是认证问题');
      }
    });

    // 注意：reconnect 和 reconnect_failed 事件在强类型模式下可能有问题
    // 使用 any 类型处理这些内置事件
    (this.socket as any).on('reconnect', (attemptNumber: number) => {
      console.log(`🔄 Socket.IO 重连成功 (第 ${attemptNumber} 次尝试)`);
      this.authenticate();
    });

    (this.socket as any).on('reconnect_failed', () => {
      console.error('Socket.IO 重连失败');
    });

    // 处理业务事件
    this.socket.on('authenticated', (data) => {
      console.log('🔐 认证成功:', data);
    });

    this.socket.on('authError', (error) => {
      console.error('🔐 认证失败:', error);
    });

    this.socket.on('error', (error) => {
      console.error('❗ Socket.IO 错误:', error);
    });

    this.socket.on('systemMessage', (message) => {
      console.log('📢 系统消息:', message);
    });

    this.socket.on('connectionStatus', (status) => {
      console.log('🔌 连接状态:', status);
    });
  }

  // 认证
  private authenticate(): void {
    const token = authUtils.getAccessToken();
    if (this.socket && token) {
      console.log('🔐 发送认证信息...');
      this.socket.emit('authenticate', { token });
    }
  }

  // 断开连接
  disconnect(): void {
    if (this.socket) {
      console.log('🔌 主动断开 Socket.IO 连接');
      this.socket.disconnect();
      this.socket = null;
    }
    this.reconnectAttempts = 0;
  }

  // 发送消息 (P1: 支持 ACK 回调)
  sendMessage(
    data: SendMessageData,
    onAck?: (response: { success: boolean; messageId?: string; seq?: number; error?: string }) => void,
    timeout = 10000
  ): void {
    if (!this.socket?.connected) {
      console.warn('Socket.IO 未连接，无法发送消息');
      onAck?.({ success: false, error: 'Socket 未连接' });
      return;
    }

    if (!data.chatType) {
      console.warn('chatType 未指定，消息未发送');
      onAck?.({ success: false, error: 'chatType 未指定' });
      return;
    }

    // 设置超时定时器
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isResolved = false;

    if (onAck) {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.warn('消息发送超时');
          onAck({ success: false, error: '发送超时' });
        }
      }, timeout);
    }

    // 使用 Socket.IO 回调
    this.socket.emit('sendMessage', data, (response: any) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (!isResolved && onAck) {
        isResolved = true;
        onAck(response);
      }
    });

    console.log('📤 发送消息:', data.content?.substring(0, 50));
  }

  // 简单发送消息（向后兼容）
  sendSimpleMessage(content: string, receiverId?: string, groupId?: string): void {
    this.sendMessage({
      content,
      type: 'text',
      chatType: groupId ? 'group' : 'private',
      receiverId,
      groupId
    });
  }

  // 加入群聊房间
  joinRoom(roomId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('joinRoom', { roomId });
      console.log('🏠 加入房间:', roomId);
    }
  }

  // 离开群聊房间
  leaveRoom(roomId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('leaveRoom', { roomId });
      console.log('🚶 离开房间:', roomId);
    }
  }

  // 更新用户状态
  updateStatus(status: 'online' | 'offline' | 'away'): void {
    if (this.socket?.connected) {
      this.socket.emit('updateStatus', status);
      console.log('📶 更新状态:', status);
    }
  }

  // 监听消息
  onMessage(callback: (data: any) => void): void {
    if (this.socket) {
      this.socket.on('message', callback);
    }
  }

  // 检查连接状态
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  // 监听用户上线
  onUserOnline(callback: (user: { userId: string; username: string }) => void): void {
    if (this.socket) {
      this.socket.on('userOnline', callback);
    }
  }

  // 监听用户下线
  onUserOffline(callback: (user: { userId: string; username: string }) => void): void {
    if (this.socket) {
      this.socket.on('userOffline', callback);
    }
  }

  // 监听在线用户列表
  onOnlineUsers(callback: (users: any[]) => void): void {
    if (this.socket) {
      this.socket.on('onlineUsers', callback);
    }
  }

  // 监听认证成功
  onAuthenticated(callback: (data: { userId: string; username: string }) => void): void {
    if (this.socket) {
      this.socket.on('authenticated', callback);
    }
  }

  // 监听认证失败
  onAuthError(callback: (error: string) => void): void {
    if (this.socket) {
      this.socket.on('authError', callback);
    }
  }

  // 清除事件监听器
  off(event: keyof ServerToClientEvents, callback?: (...args: any[]) => void): void {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  // 发送正在输入状态
  startTyping(receiverId: string, groupId?: string): void {
    if (this.socket?.connected) {
      this.socket.emit('typingStart', { receiverId, groupId });
    }
  }

  // 停止正在输入状态
  stopTyping(receiverId: string, groupId?: string): void {
    if (this.socket?.connected) {
      this.socket.emit('typingStop', { receiverId, groupId });
    }
  }

  // 监听正在输入
  onTypingStart(callback: (data: { userId: string; username: string; groupId?: string }) => void): void {
    if (this.socket) {
      this.socket.on('typingStart', callback);
    }
  }

  // 监听停止输入
  onTypingStop(callback: (data: { userId: string; username: string; groupId?: string }) => void): void {
    if (this.socket) {
      this.socket.on('typingStop', callback);
    }
  }

  // 订阅在线状态
  subscribeToPresence(userIds: string[]): void {
    if (this.socket?.connected) {
      this.socket.emit('presenceSubscribe', userIds);
    }
  }

  // 标记聊天已读
  markChatRead(chatId: string, seq: number): void {
    if (this.socket?.connected) {
      this.socket.emit('readChat', { chatId, seq });
    }
  }

  // 监听已读回执
  onReadReceipt(callback: (data: { chatId: string; seq: number; readCount: number; readerId: string }) => void): void {
    if (this.socket) {
      this.socket.on('readReceipt', callback);
    }
  }

  // 监听群组更新
  onGroupUpdate(callback: (data: any) => void): void {
    if (this.socket) {
      this.socket.on('groupUpdate', callback);
    }
  }

  // 取消订阅在线状态
  unsubscribeFromPresence(userIds: string[]): void {
    if (this.socket?.connected) {
      this.socket.emit('presenceUnsubscribe', userIds);
    }
  }

  // 获取 Socket 实例
  getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    return this.socket;
  }
}

// 单例模式
const socketService = new SocketService();
export default socketService;
