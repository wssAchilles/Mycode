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
        
        // Authenticate the connection (simple authentication for now)
        this.socket?.emit('authenticate', { token });
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

  // Send a message to the AI through Socket.IO
  public sendMessage(message: string, imageData?: { mimeType: string; base64Data: string }): void {
    if (!this.isConnected || !this.socket) {
      console.error('❌ Cannot send message: Not connected to AI Socket.IO server');
      return;
    }

    console.log('🚀 Sending message to AI Socket.IO server:', message.substring(0, 50) + (message.length > 50 ? '...' : ''));
    
    this.socket.emit('aiChat', {
      message,
      imageData
    });
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
