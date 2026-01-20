import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * 用户互动类型枚举
 * 借鉴 X 算法的多行为预测思想
 */
export enum InteractionType {
  // 正面互动
  MESSAGE_SENT = 'message_sent',           // 发送消息
  MESSAGE_READ = 'message_read',           // 阅读消息
  MESSAGE_REPLIED = 'message_replied',     // 回复消息
  CONTACT_ADDED = 'contact_added',         // 添加联系人
  GROUP_JOINED = 'group_joined',           // 加入群组
  GROUP_MESSAGE_SENT = 'group_message_sent', // 群组发言
  PROFILE_VIEWED = 'profile_viewed',       // 查看资料
  
  // 负面互动
  MESSAGE_IGNORED = 'message_ignored',     // 忽略消息
  CONTACT_REMOVED = 'contact_removed',     // 删除联系人
  CONTACT_BLOCKED = 'contact_blocked',     // 屏蔽联系人
  GROUP_LEFT = 'group_left',               // 退出群组
  GROUP_MUTED = 'group_muted',             // 静音群组
  CONVERSATION_HIDDEN = 'conversation_hidden', // 隐藏会话
}

/**
 * 互动目标类型
 */
export enum TargetType {
  USER = 'user',
  GROUP = 'group',
  MESSAGE = 'message',
}

/**
 * 用户互动记录接口
 */
export interface IUserInteraction extends Document {
  _id: Types.ObjectId;
  userId: string;              // 执行互动的用户 ID
  targetId: string;            // 互动目标 ID (用户/群组/消息)
  targetType: TargetType;      // 目标类型
  interactionType: InteractionType; // 互动类型
  timestamp: Date;             // 互动时间
  metadata?: {                 // 额外元数据
    messageId?: string;        // 相关消息 ID
    duration?: number;         // 阅读/停留时长 (毫秒)
    context?: string;          // 上下文信息
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 用户互动统计接口
 * 用于快速查询聚合数据
 */
export interface IUserInteractionStats extends Document {
  _id: Types.ObjectId;
  userId: string;              // 用户 ID
  targetId: string;            // 目标 ID
  targetType: TargetType;      // 目标类型
  
  // 正面互动计数
  messagesSent: number;        // 发送消息数
  messagesRead: number;        // 已读消息数
  repliesCount: number;        // 回复数
  
  // 负面互动标记
  isBlocked: boolean;          // 是否已屏蔽
  isMuted: boolean;            // 是否已静音
  isHidden: boolean;           // 是否已隐藏
  
  // 时间相关
  lastInteractionAt: Date;     // 最后互动时间
  firstInteractionAt: Date;    // 首次互动时间
  
  // 计算分数 (预计算以提高查询性能)
  cachedScore: number;         // 缓存的推荐分数
  scoreUpdatedAt: Date;        // 分数更新时间
  
  createdAt: Date;
  updatedAt: Date;
}

// ==================== UserInteraction Schema ====================

const UserInteractionSchema: Schema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  targetId: {
    type: String,
    required: true,
    index: true,
  },
  targetType: {
    type: String,
    enum: Object.values(TargetType),
    required: true,
    index: true,
  },
  interactionType: {
    type: String,
    enum: Object.values(InteractionType),
    required: true,
    index: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
  collection: 'user_interactions',
});

// 复合索引：用于查询用户对特定目标的互动历史
UserInteractionSchema.index({ userId: 1, targetId: 1, interactionType: 1 });
// 复合索引：用于时间范围查询
UserInteractionSchema.index({ userId: 1, timestamp: -1 });
// TTL 索引：自动清理 90 天前的数据
UserInteractionSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// ==================== UserInteractionStats Schema ====================

const UserInteractionStatsSchema: Schema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  targetId: {
    type: String,
    required: true,
    index: true,
  },
  targetType: {
    type: String,
    enum: Object.values(TargetType),
    required: true,
    index: true,
  },
  
  // 互动计数
  messagesSent: {
    type: Number,
    default: 0,
  },
  messagesRead: {
    type: Number,
    default: 0,
  },
  repliesCount: {
    type: Number,
    default: 0,
  },
  
  // 负面互动标记
  isBlocked: {
    type: Boolean,
    default: false,
    index: true,
  },
  isMuted: {
    type: Boolean,
    default: false,
  },
  isHidden: {
    type: Boolean,
    default: false,
  },
  
  // 时间字段
  lastInteractionAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  firstInteractionAt: {
    type: Date,
    default: Date.now,
  },
  
  // 缓存分数
  cachedScore: {
    type: Number,
    default: 0,
    index: true,
  },
  scoreUpdatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  collection: 'user_interaction_stats',
});

// 唯一复合索引：确保每个用户-目标对只有一条统计记录
UserInteractionStatsSchema.index(
  { userId: 1, targetId: 1, targetType: 1 },
  { unique: true }
);

// 用于排序的复合索引
UserInteractionStatsSchema.index({ userId: 1, cachedScore: -1 });
UserInteractionStatsSchema.index({ userId: 1, lastInteractionAt: -1 });

// ==================== 静态方法 ====================

/**
 * 记录用户互动
 */
UserInteractionSchema.statics.recordInteraction = async function(
  userId: string,
  targetId: string,
  targetType: TargetType,
  interactionType: InteractionType,
  metadata?: any
): Promise<IUserInteraction> {
  const interaction = new this({
    userId,
    targetId,
    targetType,
    interactionType,
    metadata,
    timestamp: new Date(),
  });
  
  await interaction.save();
  
  // 更新统计数据
  await UserInteractionStats.updateStats(userId, targetId, targetType, interactionType);
  
  return interaction;
};

/**
 * 获取用户的互动历史
 */
UserInteractionSchema.statics.getUserHistory = async function(
  userId: string,
  options: {
    limit?: number;
    targetType?: TargetType;
    interactionTypes?: InteractionType[];
    since?: Date;
  } = {}
): Promise<IUserInteraction[]> {
  const query: any = { userId };
  
  if (options.targetType) {
    query.targetType = options.targetType;
  }
  
  if (options.interactionTypes?.length) {
    query.interactionType = { $in: options.interactionTypes };
  }
  
  if (options.since) {
    query.timestamp = { $gte: options.since };
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100)
    .exec();
};

/**
 * 更新互动统计
 */
UserInteractionStatsSchema.statics.updateStats = async function(
  userId: string,
  targetId: string,
  targetType: TargetType,
  interactionType: InteractionType
): Promise<IUserInteractionStats> {
  const update: any = {
    lastInteractionAt: new Date(),
  };
  
  // 根据互动类型更新不同字段
  switch (interactionType) {
    case InteractionType.MESSAGE_SENT:
    case InteractionType.GROUP_MESSAGE_SENT:
      update.$inc = { messagesSent: 1 };
      break;
    case InteractionType.MESSAGE_READ:
      update.$inc = { messagesRead: 1 };
      break;
    case InteractionType.MESSAGE_REPLIED:
      update.$inc = { repliesCount: 1 };
      break;
    case InteractionType.CONTACT_BLOCKED:
      update.isBlocked = true;
      break;
    case InteractionType.GROUP_MUTED:
      update.isMuted = true;
      break;
    case InteractionType.CONVERSATION_HIDDEN:
      update.isHidden = true;
      break;
    // 解除屏蔽/静音时的处理可以在这里添加
  }
  
  return this.findOneAndUpdate(
    { userId, targetId, targetType },
    {
      ...update,
      $setOnInsert: { firstInteractionAt: new Date() },
    },
    { upsert: true, new: true }
  );
};

/**
 * 获取用户的推荐候选列表
 */
UserInteractionStatsSchema.statics.getRecommendationCandidates = async function(
  userId: string,
  options: {
    targetType?: TargetType;
    limit?: number;
    excludeBlocked?: boolean;
  } = {}
): Promise<IUserInteractionStats[]> {
  const query: any = {
    userId,
    isBlocked: options.excludeBlocked !== false ? false : undefined,
  };
  
  if (options.targetType) {
    query.targetType = options.targetType;
  }
  
  // 移除 undefined 字段
  Object.keys(query).forEach(key => {
    if (query[key] === undefined) {
      delete query[key];
    }
  });
  
  return this.find(query)
    .sort({ cachedScore: -1, lastInteractionAt: -1 })
    .limit(options.limit || 50)
    .exec();
};

/**
 * 批量更新缓存分数
 */
UserInteractionStatsSchema.statics.updateCachedScores = async function(
  updates: Array<{ userId: string; targetId: string; targetType: TargetType; score: number }>
): Promise<void> {
  const bulkOps = updates.map(({ userId, targetId, targetType, score }) => ({
    updateOne: {
      filter: { userId, targetId, targetType },
      update: { cachedScore: score, scoreUpdatedAt: new Date() },
    },
  }));
  
  if (bulkOps.length > 0) {
    await this.bulkWrite(bulkOps);
  }
};

// ==================== 模型导出 ====================

export const UserInteraction = mongoose.model<IUserInteraction>(
  'UserInteraction',
  UserInteractionSchema
);

export const UserInteractionStats = mongoose.model<IUserInteractionStats>(
  'UserInteractionStats',
  UserInteractionStatsSchema
);

export default { UserInteraction, UserInteractionStats };
