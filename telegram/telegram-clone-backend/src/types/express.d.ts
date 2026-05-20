import { Request } from 'express';

/**
 * 认证用户信息
 */
export interface AuthUser {
  id: string;
  username: string;
  email?: string;
}

/**
 * 带认证信息的请求接口
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  userId?: string;
}

/**
 * 分页查询参数
 */
export interface PaginationQuery {
  page?: string;
  limit?: string;
}

/**
 * 消息游标分页参数
 */
export interface CursorPaginationQuery {
  limit?: string;
  beforeSeq?: string;
  afterSeq?: string;
}

/**
 * 搜索查询参数
 */
export interface SearchQuery extends PaginationQuery {
  q?: string;
  targetId?: string;
}

/**
 * MongoDB 消息文档
 */
export interface MessageDocument {
  _id: unknown;
  id?: string;
  chatId?: string;
  content: string;
  sender: string;
  receiver: string;
  timestamp: Date;
  type: string;
  status?: string;
  seq?: number;
  isGroupChat: boolean;
  deletedAt?: Date | null;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  attachments?: Attachment[];
}

/**
 * 消息附件
 */
export interface Attachment {
  fileUrl: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
}

/**
 * 格式化后的消息响应
 */
export interface FormattedMessage {
  id: string;
  chatId: string | null;
  groupId: string | null;
  chatType: string;
  seq: number | null;
  content: string;
  senderId: string;
  senderUsername: string;
  userId: string;
  username: string;
  receiverId: string;
  timestamp: Date;
  type: string;
  status?: string;
  isGroupChat: boolean;
  attachments: Attachment[] | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  thumbnailUrl: string | null;
}

/**
 * ChatCounter 文档
 */
export interface ChatCounterDocument {
  _id: string;
  seq: number;
}

/**
 * ChatMemberState 文档
 */
export interface ChatMemberStateDocument {
  chatId: string;
  userId: string;
  lastReadSeq?: number;
  lastDeliveredSeq?: number;
  lastSeenAt?: Date;
  mutedUntil?: Date | null;
  role?: string;
}

/**
 * 联系人最后消息
 */
export interface LastMessage {
  id: string;
  content: string;
  timestamp: Date;
  senderId: string;
  senderUsername: string;
  type: string;
  seq?: number;
  chatId?: string;
}

/**
 * 富化的联系人信息
 */
export interface EnrichedContact {
  id: string;
  userId: string;
  contactId: string;
  status: string;
  alias?: string | null;
  addedAt: Date;
  lastMessage: LastMessage | null;
  unreadCount: number;
  contact?: {
    id: string;
    username: string;
    email?: string;
    avatarUrl?: string;
  };
}

/**
 * 群组成员行
 */
export interface GroupMemberRow {
  group: {
    id: string;
    name: string;
    description?: string;
    ownerId: string;
    type: string;
    maxMembers: number;
    memberCount: number;
    isActive: boolean;
    avatarUrl?: string;
    createdAt: Date;
    owner?: {
      id: string;
      username: string;
      avatarUrl?: string;
    };
  };
  memberRole: string;
  joinedAt: Date;
}

/**
 * 富化的群组信息
 */
export interface EnrichedGroup {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  type: string;
  maxMembers: number;
  memberCount: number;
  isActive: boolean;
  avatarUrl?: string;
  memberRole: string;
  joinedAt: Date;
  lastMessage: LastMessage | null;
  unreadCount: number;
}

/**
 * AI 对话消息记录
 */
export interface AiMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  type: 'text' | 'image';
  imageData?: {
    mimeType: string;
    fileName: string;
    fileSize: number;
  };
}

/**
 * AI 聊天请求体
 */
export interface AiChatRequestBody {
  message: string;
  imageData?: {
    mimeType: string;
    base64Data: string;
  };
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  conversationId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * 发送消息请求体
 */
export interface SendMessageBody {
  receiverId?: string;
  groupId?: string;
  content?: string;
  type?: string;
  chatType: 'private' | 'group';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  clientTempId?: string;
}
