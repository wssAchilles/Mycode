import mongoose, { Document, Schema, Model } from 'mongoose';

// AI对话接口
export interface IAiConversation extends Document {
  userId: string;
  conversationId: string;
  title: string;
  messages: Array<{
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
  }>;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

export interface IAiConversationModel extends Model<IAiConversation> {
  createNewConversation(userId: string, firstMessage: any): Promise<IAiConversation>;
  getUserConversations(userId: string, limit?: number): Promise<IAiConversation[]>;
  getConversationById(conversationId: string): Promise<IAiConversation | null>;
}

// AI对话Schema
const AiConversationSchema = new Schema<IAiConversation>({
  userId: {
    type: String,
    required: true,
    index: true
  },
  conversationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    default: '新的AI对话'
  },
  messages: [{
    id: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['text', 'image'],
      default: 'text'
    },
    imageData: {
      mimeType: String,
      fileName: String,
      fileSize: Number
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// 索引
AiConversationSchema.index({ userId: 1, createdAt: -1 });
AiConversationSchema.index({ conversationId: 1 });

// 实例方法
AiConversationSchema.methods.addMessage = function(message: any) {
  this.messages.push(message);
  this.updatedAt = new Date();
  
  // 如果是第一条用户消息，用它作为标题
  if (this.messages.length === 1 && message.role === 'user') {
    this.title = message.content.length > 30 
      ? message.content.substring(0, 30) + '...' 
      : message.content;
  }
  
  return this.save();
};

// 静态方法
AiConversationSchema.statics.createNewConversation = async function(userId: string, firstMessage: any) {
  const conversationId = `ai_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const conversation = new this({
    userId,
    conversationId,
    title: firstMessage.content.length > 30 
      ? firstMessage.content.substring(0, 30) + '...' 
      : firstMessage.content,
    messages: [firstMessage],
    isActive: true
  });
  
  return conversation.save();
};

AiConversationSchema.statics.getUserConversations = function(userId: string, limit: number = 20) {
  return this.find({ userId, isActive: true })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('conversationId title updatedAt messages')
    .exec();
};

AiConversationSchema.statics.getConversationById = function(conversationId: string) {
  return this.findOne({ conversationId, isActive: true }).exec();
};

export const AiConversation = mongoose.model<IAiConversation, IAiConversationModel>('AiConversation', AiConversationSchema);
