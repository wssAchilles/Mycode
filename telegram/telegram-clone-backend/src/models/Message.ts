import mongoose, { Document, Schema, Types } from 'mongoose';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';

// 附件类型
export interface IAttachment {
  fileUrl: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
}

// 消息状态枚举
export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read'
}

// 消息类型枚举
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  SYSTEM = 'system'
}

// 消息接口
export interface IMessage extends Document {
  _id: Types.ObjectId;
  sender: string; // 使用 string 存储 UUID
  receiver: string; // 使用 string 存储 UUID
  chatId?: string;
  chatType?: 'private' | 'group';
  seq?: number;
  groupId?: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  status: MessageStatus;
  isGroupChat: boolean;
  replyTo?: Types.ObjectId;
  editedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // 文件相关字段
  fileUrl?: string;      // 文件URL
  fileName?: string;     // 原始文件名
  fileSize?: number;     // 文件大小(字节)
  mimeType?: string;     // MIME类型
  thumbnailUrl?: string; // 缩略图 URL(仅对图片/视频)
  attachments?: IAttachment[];
  
  // 实例方法
  softDelete(): Promise<IMessage>;
  editContent(newContent: string): Promise<IMessage>;
}

// 静态方法接口
export interface IMessageModel extends mongoose.Model<IMessage> {
  getConversation(userId1: string, userId2: string, page?: number, limit?: number): Promise<IMessage[]>;
  getGroupMessages(groupId: string, page?: number, limit?: number): Promise<IMessage[]>;
  markAsRead(messageIds: string[], userId: string): Promise<any>;
}

// 消息 Schema
const MessageSchema: Schema = new Schema({
  // 发送者 ID（关联到 PostgreSQL User 表）
  sender: {
    type: String, // 使用 String 存储 UUID，因为 PostgreSQL 使用 UUID
    required: true,
    index: true
  },
  
  // 接收者 ID（可以是用户 ID 或群组 ID）
  receiver: {
    type: String,
    required: true,
    index: true
  },

  // 聊天 ID（私聊: p:user1:user2, 群聊: g:groupId）
  chatId: {
    type: String,
    index: true,
    default: null
  },

  // 聊天类型
  chatType: {
    type: String,
    enum: ['private', 'group'],
    default: null,
    index: true
  },

  // 群聊 ID（冗余字段，便于兼容）
  groupId: {
    type: String,
    default: null,
    index: true
  },

  // 聊天内消息序列号
  seq: {
    type: Number,
    default: null,
    index: true
  },
  
  // 消息类型
  type: {
    type: String,
    enum: Object.values(MessageType),
    default: MessageType.TEXT,
    required: true
  },
  
  // 消息内容（文本内容或文件 URL）
  content: {
    type: String,
    required: true,
    maxlength: 10000
  },
  
  // 消息发送时间
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // 消息状态
  status: {
    type: String,
    enum: Object.values(MessageStatus),
    default: MessageStatus.SENT
  },
  
  // 是否为群聊消息
  isGroupChat: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // 回复的消息 ID（可选）
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  
  // 编辑时间（可选）
  editedAt: {
    type: Date,
    default: null
  },
  
  // 删除时间（软删除）
  deletedAt: {
    type: Date,
    default: null
  },
  
  // 文件相关字段
  fileUrl: {
    type: String,
    default: null
  },
  
  fileName: {
    type: String,
    default: null
  },
  
  fileSize: {
    type: Number,
    default: null
  },
  
  mimeType: {
    type: String,
    default: null
  },
  
  thumbnailUrl: {
    type: String,
    default: null
  },

  // 附件列表（推荐使用）
  attachments: {
    type: [
      {
        fileUrl: { type: String, required: true },
        fileName: { type: String, default: null },
        fileSize: { type: Number, default: null },
        mimeType: { type: String, default: null },
        thumbnailUrl: { type: String, default: null }
      }
    ],
    default: null
  }
}, {
  timestamps: true, // 自动添加 createdAt 和 updatedAt
  versionKey: false
});

// 索引优化
MessageSchema.index({ sender: 1, receiver: 1, timestamp: -1 });
MessageSchema.index({ receiver: 1, timestamp: -1 });
MessageSchema.index({ timestamp: -1 });
MessageSchema.index({ chatId: 1, seq: -1 });
MessageSchema.index({ chatId: 1, timestamp: -1 });
MessageSchema.index({ groupId: 1, seq: -1 });
MessageSchema.index({ deletedAt: 1 });
MessageSchema.index({ content: 'text' });

// 静态方法：获取两个用户之间的聊天记录
MessageSchema.statics.getConversation = async function(
  userId1: string, 
  userId2: string, 
  page: number = 1, 
  limit: number = 50
) {
  const skip = (page - 1) * limit;

  return this.find({
    $or: [
      { chatId: buildPrivateChatId(userId1, userId2) },
      { sender: userId1, receiver: userId2 },
      { sender: userId2, receiver: userId1 }
    ],
    deletedAt: null,
    isGroupChat: false
  })
    .sort({ seq: -1, timestamp: -1 }) // 最新消息在前
    .limit(limit)
    .skip(skip)
    .lean(); // 返回普通对象而不是 Mongoose 文档
};

// 静态方法：获取群聊消息
MessageSchema.statics.getGroupMessages = async function(
  groupId: string, 
  page: number = 1, 
  limit: number = 50
) {
  const skip = (page - 1) * limit;

  return this.find({
    $or: [
      { chatId: buildGroupChatId(groupId) },
      { receiver: groupId }
    ],
    deletedAt: null,
    isGroupChat: true
  })
  .sort({ seq: -1, timestamp: -1 })
  .limit(limit)
  .skip(skip)
  .lean();
};

// 静态方法：标记消息为已读
MessageSchema.statics.markAsRead = async function(
  messageIds: string[], 
  userId: string
) {
  return this.updateMany(
    {
      _id: { $in: messageIds },
      receiver: userId,
      status: { $ne: MessageStatus.READ }
    },
    {
      $set: { status: MessageStatus.READ }
    }
  );
};

// 实例方法：软删除消息
MessageSchema.methods.softDelete = function() {
  this.deletedAt = new Date();
  return this.save();
};

// 实例方法：编辑消息
MessageSchema.methods.editContent = function(newContent: string) {
  this.content = newContent;
  this.editedAt = new Date();
  return this.save();
};

// 虚拟字段：检查是否已删除
MessageSchema.virtual('isDeleted').get(function() {
  return this.deletedAt !== null;
});

// 虚拟字段：检查是否已编辑
MessageSchema.virtual('isEdited').get(function() {
  return this.editedAt !== null;
});

// 预处理：查询时排除已删除的消息
MessageSchema.pre(/^find/, function() {
  // @ts-ignore
  if (!this.getQuery().deletedAt) {
    // @ts-ignore
    this.where({ deletedAt: null });
  }
});

// JSON 序列化时的转换
MessageSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc: any, ret: any) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

// 创建模型
const Message = mongoose.model<IMessage, IMessageModel>('Message', MessageSchema);

export default Message;
