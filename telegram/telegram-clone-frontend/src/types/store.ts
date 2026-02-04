// 聊天状态接口定义
import type { Message as BaseMessage } from './chat';

// 扩展的联系人类型
export interface Contact {
    id: string;
    odId: string;
    userId: string; // 用户ID，用于在线状态更新
    username: string;
    email?: string;
    alias?: string;
    avatarUrl?: string | null;
    isOnline: boolean;
    lastSeen?: string;
    lastMessage?: Message | null;
    unreadCount: number;
}

// 扩展的消息类型
export interface Message extends BaseMessage {
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
}

// 待处理联系人请求
export interface PendingRequest {
    id: string;
    userId: string;
    username: string;
    email?: string;
    avatarUrl?: string | null;
    alias?: string;
    message?: string;
    createdAt: string;
}

// Socket 连接状态
export interface SocketState {
    isConnected: boolean;
    lastError?: string;
    reconnectAttempts: number;
}

// 聊天视图状态
export interface ChatViewState {
    isAiChatMode: boolean;
    showAddContactModal: boolean;
    showEmojiPicker: boolean;
    isUploading: boolean;
}

// 消息输入状态
export interface MessageInputState {
    content: string;
    attachedFile?: File | null;
    replyTo?: Message | null;
}
