// 消息相关类型定义
export interface Message {
  id: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq?: number;
  content: string;
  senderId: string;      // 兼容旧的属性名
  senderUsername: string; // 兼容旧的属性名
  userId: string;        // 新的属性名
  username: string;      // 新的属性名
  receiverId?: string;   // 私聊接收者
  groupId?: string;      // 群聊ID
  timestamp: string;
  type: 'text' | 'image' | 'file' | 'document' | 'audio' | 'video' | 'system';
  isGroupChat: boolean;
  status?: 'sent' | 'delivered' | 'read' | 'failed' | 'pending';
  readCount?: number;
  // 文件相关字段
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  attachments?: {
    fileUrl: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
  }[];
}

export interface GroupUpdatePayload {
  action: string;
  groupId: string;
  actorId: string;
  targetId?: string;
  members?: any[];
  memberIds?: string[];
  mutedUntil?: string;
  name?: string;
  description?: string;
  avatarUrl?: string;
  previousOwnerId?: string;
  groupName?: string;
}

export type RealtimeBatchEvent =
  | { type: 'message'; payload: Message }
  | { type: 'presence'; payload: { userId: string; isOnline: boolean; lastSeen?: string } }
  | { type: 'readReceipt'; payload: { chatId: string; seq: number; readCount: number; readerId?: string } }
  | { type: 'groupUpdate'; payload: GroupUpdatePayload };

// Socket.IO 事件类型
export interface SocketMessage {
  type: 'chat' | 'success' | 'error';
  data?: Message;
  message?: string;
}

// 在线用户类型
export interface OnlineUser {
  userId: string;
  username: string;
  connectedAt: string;
}

// 用户认证数据
export interface AuthData {
  token: string;
  userId?: string;
}

// 发送消息数据
export interface SendMessageData {
  content: string;
  type?: 'text' | 'image' | 'file';
  chatType: 'private' | 'group';
  receiverId?: string; // 私聊接收者ID
  groupId?: string;    // 群聊ID
  attachments?: {
    fileUrl: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
  }[];
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
}

// P1: ACK 响应类型
export interface MessageAckResponse {
  success: boolean;
  messageId?: string;
  seq?: number;
  error?: string;
}

// Socket.IO 客户端到服务器事件
export interface ClientToServerEvents {
  // 用户认证
  authenticate: (data: AuthData) => void;

  // 发送消息 (P1: 支持 ACK 回调)
  sendMessage: (data: SendMessageData, ack?: (response: MessageAckResponse) => void) => void;

  // 加入聊天室（群聊）
  joinRoom: (data: { roomId: string }) => void;

  // 离开聊天室
  leaveRoom: (data: { roomId: string }) => void;

  // 用户状态更新
  updateStatus: (status: 'online' | 'offline' | 'away') => void;

  // 断开连接
  disconnect: () => void;

  // 正在输入
  typingStart: (data: { receiverId: string; groupId?: string }) => void;

  // 停止输入
  typingStop: (data: { receiverId: string; groupId?: string }) => void;

  // 订阅在线状态
  presenceSubscribe: (userIds: string[]) => void;

  // 取消订阅在线状态
  presenceUnsubscribe: (userIds: string[]) => void;

  // 标记聊天已读
  readChat: (data: { chatId: string; seq: number }) => void;
}

// Socket.IO 服务器到客户端事件
export interface ServerToClientEvents {
  // 接收消息
  message: (data: SocketMessage) => void;

  // 用户上线
  userOnline: (user: { userId: string; username: string }) => void;

  // 用户下线
  userOffline: (user: { userId: string; username: string }) => void;

  // 在线用户列表
  onlineUsers: (users: OnlineUser[]) => void;

  // 认证成功
  authenticated: (data: { userId: string; username: string }) => void;

  // 认证失败
  authError: (error: string) => void;

  // 系统消息
  systemMessage: (message: string) => void;

  // 错误消息
  error: (error: string) => void;

  // 连接状态
  connectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;

  // 对方正在输入
  typingStart: (data: { userId: string; username: string; groupId?: string }) => void;

  // 对方停止输入
  typingStop: (data: { userId: string; username: string; groupId?: string }) => void;

  // 在线状态更新
  presenceUpdate: (data: { userId: string; status: 'online' | 'offline'; lastSeen?: string }) => void;

  // 已读回执
  readReceipt: (data: { chatId: string; seq: number; readCount: number; readerId: string }) => void;

  // 群组更新
  groupUpdate: (data: GroupUpdatePayload) => void;

  // 批量实时事件
  realtimeBatch: (events: RealtimeBatchEvent[]) => void;
}
