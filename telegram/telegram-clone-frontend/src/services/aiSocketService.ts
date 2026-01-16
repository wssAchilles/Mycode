import { io, Socket } from 'socket.io-client';
import { authUtils } from './apiClient';

// AI Socket.IO service for handling real-time AI chat communication
class AiSocketService {
  private socket: Socket | null = null;
  private isConnected: boolean = false;
  private connectionAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout: number = 3000;
  private reconnectTimer: any | null = null;

  private connectionListeners: Array<(isConnected: boolean) => void> = [];
  private messageListeners: Array<(message: any) => void> = [];

  private readonly AI_SOCKET_URL =
    import.meta.env.VITE_AI_SOCKET_URL || 'http://localhost:5850';

  // Initialize and connect to the AI Socket.IO server
  public connect(): void {
    if (this.socket) {
      console.log('🤖 AI Socket already connected or connecting');
      return;
    }

    try {
      console.log('🔌 Connecting to AI Socket.IO server...');

      const token = authUtils.getAccessToken();
      if (!token) {
        console.warn('❌ 无法连接 AI Socket：缺少访问令牌');
        return;
      }

      this.socket = io(this.AI_SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000,
        autoConnect: true,
      });

      // Set up event listeners
      this.setupEventListeners();

    } catch (error) {
      console.error('❌ Failed to initialize AI Socket.IO connection:', error);
      this.handleConnectionError();
    }
  }

  // Set up Socket.IO event listeners
  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('✅ Connected to AI Socket.IO server');
      this.isConnected = true;
      this.connectionAttempts = 0;
      this.notifyConnectionListeners(true);

      // Authenticate the connection
      const token = authUtils.getAccessToken();
      if (token) {
        this.socket?.emit('authenticate', { token });
      }
    });

    this.socket.on('authenticated', (data: any) => {
      console.log('🔐 AI Socket.IO authentication response:', data);
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Disconnected from AI Socket.IO server');
      this.isConnected = false;
      this.notifyConnectionListeners(false);
      this.handleConnectionError();
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ AI Socket.IO connection error:', error);
      this.isConnected = false;
      this.notifyConnectionListeners(false);
      this.handleConnectionError();
    });

    this.socket.on('aiResponse', (response) => {
      console.log('🤖 Received AI response:', response);
      this.notifyMessageListeners(response);
    });

    this.socket.on('authError', (error) => {
      console.error('❌ AI Socket authentication error:', error);
      this.disconnect();
    });
  }

  // Handle connection errors and reconnection
  private handleConnectionError(): void {
    this.isConnected = false;
    this.connectionAttempts++;

    if (this.connectionAttempts < this.maxReconnectAttempts) {
      console.log(`🔄 Attempting to reconnect to AI Socket.IO server (${this.connectionAttempts}/${this.maxReconnectAttempts})...`);

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }

      this.reconnectTimer = setTimeout(() => {
        this.reconnect();
      }, this.reconnectTimeout);
    } else {
      console.error(`❌ Failed to connect to AI Socket.IO server after ${this.maxReconnectAttempts} attempts`);
    }
  }

  // Reconnect to the Socket.IO server
  private reconnect(): void {
    if (this.socket) {
      this.disconnect();
    }
    this.connect();
  }

  // Send a message to the AI through Socket.IO or HTTP fallback
  public async sendMessage(message: string, imageData?: { mimeType: string; base64Data: string }): Promise<void> {
    // 优先尝试 Socket 连接
    if (this.isConnected && this.socket) {
      console.log('🚀 Sending message to AI Socket.IO server:', message.substring(0, 50) + (message.length > 50 ? '...' : ''));
      this.socket.emit('aiChat', {
        message,
        imageData
      });
      return;
    }

    // 如果 Socket 未连接，使用 HTTP 回退
    console.warn('⚠️ AI Socket未连接，尝试使用 HTTP API 回退...');

    try {
      const token = authUtils.getAccessToken();
      if (!token) {
        console.error('❌ 无法通过 HTTP 发送 AI 消息：缺少访问令牌');
        return;
      }

      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

      const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message,
          imageData
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'AI服务暂时不可用');
      }

      const data = await response.json();

      if (data.success && data.data) {
        console.log('✅ 通过 HTTP 收到 AI 响应:', data.data);

        // 构造与 Socket 响应相同的格式
        const aiResponse = {
          message: data.data.message,
          timestamp: data.data.timestamp || new Date().toISOString(),
          sender: 'Gemini AI',
          isStreamConfig: false
        };

        // 通知监听器
        this.notifyMessageListeners(aiResponse);
      }
    } catch (error) {
      console.error('❌ HTTP AI 请求失败:', error);

      // 通知错误给监听器（可选，取决于 UI 如何处理错误）
      this.notifyMessageListeners({
        error: 'AI 连接失败，请稍后再试',
        message: '抱歉，我目前无法连接到服务器。请检查网络连接或稍后再试。',
        sender: 'System'
      });
    }
  }

  // Disconnect from the Socket.IO server
  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.notifyConnectionListeners(false);
  }

  // Check connection status
  public isSocketConnected(): boolean {
    return this.isConnected;
  }

  // Add a connection status listener
  public addConnectionListener(listener: (isConnected: boolean) => void): void {
    this.connectionListeners.push(listener);
    // Immediately notify the listener of the current connection status
    listener(this.isConnected);
  }

  // Remove a connection status listener
  public removeConnectionListener(listener: (isConnected: boolean) => void): void {
    const index = this.connectionListeners.indexOf(listener);
    if (index !== -1) {
      this.connectionListeners.splice(index, 1);
    }
  }

  // Add a message listener
  public addMessageListener(listener: (message: any) => void): void {
    this.messageListeners.push(listener);
  }

  // Remove a message listener
  public removeMessageListener(listener: (message: any) => void): void {
    const index = this.messageListeners.indexOf(listener);
    if (index !== -1) {
      this.messageListeners.splice(index, 1);
    }
  }

  // Notify all connection listeners
  private notifyConnectionListeners(isConnected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(isConnected);
    }
  }

  // Notify all message listeners
  private notifyMessageListeners(message: any): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}

// Create and export a singleton instance
export const aiSocketService = new AiSocketService();
export default aiSocketService;
