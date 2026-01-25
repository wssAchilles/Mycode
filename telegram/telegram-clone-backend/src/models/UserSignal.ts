/**
 * UserSignal - 实时用户信号模型
 * 
 * 复刻 X Algorithm 的 User Signal Service (USS)
 * 参考: https://github.com/twitter/the-algorithm/blob/main/user-signal-service/README.md
 * 
 * 核心概念:
 * - 显式信号 (Explicit): favorite, retweet, reply
 * - 隐式信号 (Implicit): click, video view, profile visit, dwell
 * - 信号标准化: 将不同来源的信号处理为统一格式
 * - 供下游使用: 候选召回和排序特征
 * 
 * 设计原则:
 * - 信号是不可变的 (append-only)
 * - 使用 TTL 自动清理旧信号
 * - 支持批量查询和聚合
 */

import mongoose, { Document, Schema, Model } from 'mongoose';

// ========== 信号类型枚举 ==========
export enum SignalType {
    // ===== 显式信号 (Explicit Signals) =====
    FAVORITE = 'favorite',           // 点赞
    UNFAVORITE = 'unfavorite',       // 取消点赞
    RETWEET = 'retweet',             // 转发
    UNRETWEET = 'unretweet',         // 取消转发
    REPLY = 'reply',                 // 回复
    QUOTE = 'quote',                 // 引用
    FOLLOW = 'follow',               // 关注
    UNFOLLOW = 'unfollow',           // 取关
    BLOCK = 'block',                 // 拉黑
    UNBLOCK = 'unblock',             // 取消拉黑
    MUTE = 'mute',                   // 静音
    UNMUTE = 'unmute',               // 取消静音
    REPORT = 'report',               // 举报
    SHARE = 'share',                 // 分享到外部
    BOOKMARK = 'bookmark',           // 书签
    UNBOOKMARK = 'unbookmark',       // 取消书签

    // ===== 隐式信号 (Implicit Signals) =====
    TWEET_CLICK = 'tweet_click',             // 帖子点击
    PROFILE_CLICK = 'profile_click',         // 主页点击
    VIDEO_VIEW = 'video_view',               // 视频播放开始
    VIDEO_QUALITY_VIEW = 'video_quality_view', // 高质量播放 (>50%)
    VIDEO_COMPLETE = 'video_complete',       // 视频播放完成
    DWELL = 'dwell',                         // 停留
    IMPRESSION = 'impression',               // 曝光
    OPEN_LINK = 'open_link',                 // 打开链接
    HASHTAG_CLICK = 'hashtag_click',         // 话题点击
    CASHTAG_CLICK = 'cashtag_click',         // 股票标签点击

    // ===== 搜索信号 =====
    SEARCH_QUERY = 'search_query',           // 搜索查询
    SEARCH_RESULT_CLICK = 'search_result_click', // 搜索结果点击

    // ===== 通知信号 =====
    NOTIFICATION_CLICK = 'notification_click',   // 通知点击
    NOTIFICATION_DISMISS = 'notification_dismiss', // 通知关闭
}

// ========== 信号来源 (Product Surface) ==========
export enum ProductSurface {
    HOME_FEED = 'home_feed',         // 首页 Feed
    SEARCH = 'search',               // 搜索页
    PROFILE = 'profile',             // 个人主页
    NOTIFICATIONS = 'notifications', // 通知页
    EXPLORE = 'explore',             // 探索页
    MOMENTS = 'moments',             // 时刻
    LISTS = 'lists',                 // 列表
    BOOKMARKS = 'bookmarks',         // 书签
    DIRECT_MESSAGE = 'dm',           // 私信
    EXTERNAL = 'external',           // 外部链接
}

// ========== 目标类型 ==========
export enum TargetType {
    POST = 'post',           // 帖子/推文
    USER = 'user',           // 用户
    TOPIC = 'topic',         // 话题
    LIST = 'list',           // 列表
    NOTIFICATION = 'notification', // 通知
    SEARCH_QUERY = 'search_query', // 搜索词
}

// ========== 主接口定义 ==========
export interface IUserSignal extends Document {
    // ===== 核心字段 =====
    userId: string;                  // 产生信号的用户
    signalType: SignalType;          // 信号类型

    // ===== 目标信息 =====
    targetId: string;                // 目标 ID
    targetType: TargetType;          // 目标类型
    targetAuthorId?: string;         // 目标作者 (如果是帖子)

    // ===== 上下文信息 =====
    productSurface: ProductSurface;  // 来源页面
    requestId?: string;              // 请求追踪 ID

    // ===== 附加数据 =====
    metadata?: {
        // 停留时间
        dwellTimeMs?: number;

        // 视频相关
        videoWatchPercentage?: number;
        videoDurationMs?: number;

        // 搜索相关
        searchQuery?: string;
        searchResultPosition?: number;

        // 推荐相关
        recommendationPosition?: number;
        recommendationSource?: string;

        // 其他
        [key: string]: any;
    };

    // ===== 时间戳 =====
    timestamp: Date;

    // ===== TTL 过期字段 =====
    expiresAt: Date;
}

// ========== 输入类型 (用于服务层调用) ==========
export interface UserSignalInput {
    userId: string;
    signalType: SignalType;
    targetId: string;
    targetType: TargetType;
    targetAuthorId?: string;
    productSurface: ProductSurface;
    requestId?: string;
    metadata?: {
        dwellTimeMs?: number;
        videoWatchPercentage?: number;
        videoDurationMs?: number;
        searchQuery?: string;
        searchResultPosition?: number;
        recommendationPosition?: number;
        recommendationSource?: string;
        [key: string]: unknown;
    };
}

// ========== Schema 定义 ==========
const UserSignalSchema = new Schema<IUserSignal>(
    {
        userId: {
            type: String,
            required: true,
            index: true,
        },
        signalType: {
            type: String,
            enum: Object.values(SignalType),
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
        },
        targetAuthorId: {
            type: String,
            index: true,
        },
        productSurface: {
            type: String,
            enum: Object.values(ProductSurface),
            required: true,
        },
        requestId: String,
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
        timestamp: {
            type: Date,
            required: true,
            default: Date.now,
            index: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 天后
        },
    },
    {
        collection: 'user_signals',
        timestamps: false, // 信号不可变,不需要 updatedAt
    }
);

// ========== 索引 ==========

// TTL 索引: 自动清理过期信号
UserSignalSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

// 用户最近信号查询 (核心查询路径)
UserSignalSchema.index({ userId: 1, timestamp: -1 });

// 用户 + 信号类型查询
UserSignalSchema.index({ userId: 1, signalType: 1, timestamp: -1 });

// 用户 + 目标作者查询 (用于计算 author affinity)
UserSignalSchema.index({ userId: 1, targetAuthorId: 1, timestamp: -1 });

// 目标查询 (分析某帖子的信号)
UserSignalSchema.index({ targetId: 1, signalType: 1, timestamp: -1 });

// ========== 信号配置 ==========
const SIGNAL_CONFIG = {
    // 各信号类型的权重 (用于聚合评分)
    weights: {
        [SignalType.FAVORITE]: 1.0,
        [SignalType.UNFAVORITE]: -0.5,
        [SignalType.RETWEET]: 2.0,
        [SignalType.UNRETWEET]: -1.0,
        [SignalType.REPLY]: 3.0,
        [SignalType.QUOTE]: 2.5,
        [SignalType.FOLLOW]: 5.0,
        [SignalType.UNFOLLOW]: -3.0,
        [SignalType.BLOCK]: -10.0,
        [SignalType.UNBLOCK]: 0,
        [SignalType.MUTE]: -5.0,
        [SignalType.UNMUTE]: 0,
        [SignalType.REPORT]: -8.0,
        [SignalType.SHARE]: 1.5,
        [SignalType.BOOKMARK]: 1.0,
        [SignalType.UNBOOKMARK]: -0.5,
        [SignalType.TWEET_CLICK]: 0.3,
        [SignalType.PROFILE_CLICK]: 0.5,
        [SignalType.VIDEO_VIEW]: 0.2,
        [SignalType.VIDEO_QUALITY_VIEW]: 0.8,
        [SignalType.VIDEO_COMPLETE]: 1.0,
        [SignalType.DWELL]: 0.001,
        [SignalType.IMPRESSION]: 0.01,
        [SignalType.OPEN_LINK]: 0.4,
        [SignalType.HASHTAG_CLICK]: 0.3,
        [SignalType.CASHTAG_CLICK]: 0.3,
        [SignalType.SEARCH_QUERY]: 0.1,
        [SignalType.SEARCH_RESULT_CLICK]: 0.5,
        [SignalType.NOTIFICATION_CLICK]: 0.3,
        [SignalType.NOTIFICATION_DISMISS]: -0.1,
    } as Record<SignalType, number>,

    // 各信号类型的 TTL (天)
    ttlDays: {
        default: 7,
        [SignalType.IMPRESSION]: 1,
        [SignalType.DWELL]: 1,
        [SignalType.FOLLOW]: 30,
        [SignalType.BLOCK]: 365,
        [SignalType.REPORT]: 365,
    } as Record<string, number>,
};

// ========== 静态方法 ==========

interface UserSignalStatics {
    /**
     * 记录信号 (核心方法)
     * 复刻 USS 的 logSignal()
     */
    logSignal(signal: UserSignalInput): Promise<IUserSignal>;

    /**
     * 批量记录信号
     */
    logSignalsBatch(signals: UserSignalInput[]): Promise<void>;

    /**
     * 获取用户最近信号
     * 复刻 USS 的 getRecentSignals()
     */
    getRecentSignals(
        userId: string,
        signalTypes?: SignalType[],
        limit?: number
    ): Promise<IUserSignal[]>;

    /**
     * 获取用户对特定作者的信号
     * 用于计算 author affinity
     */
    getSignalsForAuthor(
        userId: string,
        authorId: string,
        days?: number
    ): Promise<IUserSignal[]>;

    /**
     * 聚合统计用户信号
     * 返回各类型信号的计数和加权分数
     */
    aggregateSignals(
        userId: string,
        days?: number
    ): Promise<{
        counts: Record<SignalType, number>;
        weightedScore: number;
    }>;

    /**
     * 检查用户是否对目标有特定信号
     */
    hasSignal(
        userId: string,
        targetId: string,
        signalType: SignalType
    ): Promise<boolean>;

    /**
     * 获取信号权重配置
     */
    getSignalWeight(signalType: SignalType): number;
}

// 记录单个信号
UserSignalSchema.statics.logSignal = async function (
    signal: UserSignalInput
): Promise<IUserSignal> {
    const now = new Date();

    // 计算 TTL
    const ttlDays = SIGNAL_CONFIG.ttlDays[signal.signalType as keyof typeof SIGNAL_CONFIG.ttlDays]
        || SIGNAL_CONFIG.ttlDays.default;
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

    const doc = new this({
        ...signal,
        timestamp: now,
        expiresAt,
    });

    return doc.save();
};

// 批量记录信号
UserSignalSchema.statics.logSignalsBatch = async function (
    signals: UserSignalInput[]
): Promise<void> {
    const now = new Date();

    const docs = signals.map(signal => {
        const ttlDays = SIGNAL_CONFIG.ttlDays[signal.signalType as keyof typeof SIGNAL_CONFIG.ttlDays]
            || SIGNAL_CONFIG.ttlDays.default;
        const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

        return {
            ...signal,
            timestamp: now,
            expiresAt,
        };
    });

    await this.insertMany(docs, { ordered: false });
};

// 获取用户最近信号
UserSignalSchema.statics.getRecentSignals = async function (
    userId: string,
    signalTypes?: SignalType[],
    limit: number = 100
): Promise<IUserSignal[]> {
    const query: Record<string, unknown> = { userId };

    if (signalTypes && signalTypes.length > 0) {
        query.signalType = { $in: signalTypes };
    }

    return this.find(query)
        .sort({ timestamp: -1 })
        .limit(limit);
};

// 获取用户对特定作者的信号
UserSignalSchema.statics.getSignalsForAuthor = async function (
    userId: string,
    authorId: string,
    days: number = 30
): Promise<IUserSignal[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.find({
        userId,
        targetAuthorId: authorId,
        timestamp: { $gte: since },
    }).sort({ timestamp: -1 });
};

// 聚合统计
UserSignalSchema.statics.aggregateSignals = async function (
    userId: string,
    days: number = 7
): Promise<{ counts: Record<SignalType, number>; weightedScore: number }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const results = await this.aggregate([
        {
            $match: {
                userId,
                timestamp: { $gte: since },
            },
        },
        {
            $group: {
                _id: '$signalType',
                count: { $sum: 1 },
                totalDwell: {
                    $sum: {
                        $cond: [
                            { $eq: ['$signalType', SignalType.DWELL] },
                            { $ifNull: ['$metadata.dwellTimeMs', 0] },
                            0,
                        ],
                    },
                },
            },
        },
    ]);

    const counts = {} as Record<SignalType, number>;
    let weightedScore = 0;

    for (const result of results) {
        const signalType = result._id as SignalType;
        counts[signalType] = result.count;

        const weight = SIGNAL_CONFIG.weights[signalType] || 0;

        if (signalType === SignalType.DWELL) {
            // 停留时间特殊处理
            weightedScore += result.totalDwell * weight;
        } else {
            weightedScore += result.count * weight;
        }
    }

    return { counts, weightedScore };
};

// 检查是否有信号
UserSignalSchema.statics.hasSignal = async function (
    userId: string,
    targetId: string,
    signalType: SignalType
): Promise<boolean> {
    const count = await this.countDocuments({
        userId,
        targetId,
        signalType,
    });
    return count > 0;
};

// 获取信号权重
UserSignalSchema.statics.getSignalWeight = function (
    signalType: SignalType
): number {
    return SIGNAL_CONFIG.weights[signalType] || 0;
};

// ========== 模型导出 ==========
interface UserSignalModel extends Model<IUserSignal>, UserSignalStatics { }

const UserSignal = mongoose.model<IUserSignal, UserSignalModel>(
    'UserSignal',
    UserSignalSchema
);

export default UserSignal;
export { SIGNAL_CONFIG };
