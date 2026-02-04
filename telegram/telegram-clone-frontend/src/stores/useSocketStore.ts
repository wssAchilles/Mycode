/**
 * Socket 连接状态管理 Store
 * 管理 WebSocket 连接状态和消息收发
 */
import { create } from 'zustand';

interface SocketState {
    // 连接状态
    isConnected: boolean;
    isConnecting: boolean;
    lastError: string | null;
    reconnectAttempts: number;
    maxReconnectAttempts: number;

    // 记录
    lastMessageTime: number | null;
    messageCount: number;

    // 动作
    setConnected: (connected: boolean) => void;
    setConnecting: (connecting: boolean) => void;
    setError: (error: string | null) => void;
    incrementReconnectAttempts: () => void;
    resetReconnectAttempts: () => void;
    recordMessage: () => void;
    reset: () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
    // 初始状态
    isConnected: false,
    isConnecting: false,
    lastError: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    lastMessageTime: null,
    messageCount: 0,

    // 设置连接状态
    setConnected: (connected) =>
        set({
            isConnected: connected,
            isConnecting: false,
            lastError: connected ? null : get().lastError,
        }),

    // 设置连接中状态
    setConnecting: (connecting) =>
        set({
            isConnecting: connecting,
        }),

    // 设置错误
    setError: (error) =>
        set({
            lastError: error,
            isConnected: false,
            isConnecting: false,
        }),

    // 增加重连次数
    incrementReconnectAttempts: () =>
        set((state) => ({
            reconnectAttempts: state.reconnectAttempts + 1,
        })),

    // 重置重连次数
    resetReconnectAttempts: () =>
        set({
            reconnectAttempts: 0,
        }),

    // 记录消息
    recordMessage: () =>
        set((state) => ({
            lastMessageTime: Date.now(),
            messageCount: state.messageCount + 1,
        })),

    // 重置状态
    reset: () =>
        set({
            isConnected: false,
            isConnecting: false,
            lastError: null,
            reconnectAttempts: 0,
            lastMessageTime: null,
            messageCount: 0,
        }),
}));

// 选择器
export const selectIsConnected = (state: SocketState) => state.isConnected;
export const selectIsConnecting = (state: SocketState) => state.isConnecting;
export const selectConnectionError = (state: SocketState) => state.lastError;
