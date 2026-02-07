import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * 用户行为类型
 * 复刻 x-algorithm 的 UserAction 类型
 */
export enum ActionType {
    // 正向互动
    LIKE = 'like',
    REPLY = 'reply',
    REPOST = 'repost',
    QUOTE = 'quote',
    CLICK = 'click', // 点击查看详情
    PROFILE_CLICK = 'profile_click', // 点击查看作者主页
    SHARE = 'share', // 分享到外部

    // 曝光
    IMPRESSION = 'impression', // 帖子曝光
    VIDEO_VIEW = 'video_view', // 视频播放
    VIDEO_QUALITY_VIEW = 'video_quality_view', // 高质量视频播放 (>50%)
    DELIVERY = 'delivery', // 推荐送达

    // 负向信号
    DISMISS = 'dismiss', // 不感兴趣
    BLOCK_AUTHOR = 'block_author', // 拉黑作者
    REPORT = 'report', // 举报

    // 停留时间
    DWELL = 'dwell', // 停留
}

/**
 * 用户行为接口
 * 复刻 x-algorithm 的 AggregatedUserAction
 */
export interface IUserAction extends Document {
    userId: string;
    action: ActionType;
    targetPostId?: mongoose.Types.ObjectId;
    targetAuthorId?: string;

    // 追踪与可观测性
    requestId?: string; // 对齐 x-algorithm request_id

    // 附加数据 (用于更精细的评分)
    dwellTimeMs?: number; // 停留时间
    videoWatchPercentage?: number; // 视频观看比例

    // 来源信息 (用于分析)
    productSurface?: string; // 来源页面 (feed, profile, search)

    timestamp: Date;
}

const UserActionSchema = new Schema<IUserAction>(
    {
        userId: {
            type: String,
            required: true,
            index: true,
        },
        action: {
            type: String,
            enum: Object.values(ActionType),
            required: true,
        },
        targetPostId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            index: true,
        },
        targetAuthorId: {
            type: String,
            index: true,
        },
        requestId: {
            type: String,
            index: true,
        },
        dwellTimeMs: Number,
        videoWatchPercentage: Number,
        productSurface: String,
        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        collection: 'user_actions',
        // 不需要 updatedAt，行为记录不可修改
        timestamps: false,
    }
);

// 复合索引: 查询用户最近行为序列 (用于 UserActionSeqQueryHydrator)
UserActionSchema.index({ userId: 1, timestamp: -1 });

// 复合索引: 查询用户对特定作者的行为 (用于计算 author affinity)
UserActionSchema.index({ userId: 1, targetAuthorId: 1, timestamp: -1 });

// TTL 索引: 自动清理 30 天前的行为记录 (User requested permanent storage, so disabling TTL)
// UserActionSchema.index(
//     { timestamp: 1 },
//     { expireAfterSeconds: 30 * 24 * 60 * 60 }
// );

/**
 * 静态方法: 获取用户最近的行为序列
 * 复刻 x-algorithm 的 UserActionSequence
 */
UserActionSchema.statics.getUserActionSequence = async function (
    userId: string,
    limit: number = 50,
    actionTypes?: ActionType[]
): Promise<IUserAction[]> {
    const query: Record<string, unknown> = { userId };
    if (actionTypes && actionTypes.length > 0) {
        query.action = { $in: actionTypes };
    }
    return this.find(query).sort({ timestamp: -1 }).limit(limit);
};

/**
 * 静态方法: 获取用户对特定作者的互动历史
 * 用于计算 author affinity score
 */
UserActionSchema.statics.getAuthorAffinityActions = async function (
    userId: string,
    authorId: string,
    days: number = 30
): Promise<IUserAction[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.find({
        userId,
        targetAuthorId: authorId,
        timestamp: { $gte: since },
        action: { $in: [ActionType.LIKE, ActionType.REPLY, ActionType.REPOST] },
    }).sort({ timestamp: -1 });
};

/**
 * 静态方法: 批量记录行为
 */
UserActionSchema.statics.logActions = async function (
    actions: Partial<IUserAction>[]
): Promise<void> {
    await this.insertMany(
        actions.map((a) => ({
            ...a,
            timestamp: a.timestamp || new Date(),
        }))
    );
};

interface UserActionModel extends Model<IUserAction> {
    getUserActionSequence(
        userId: string,
        limit?: number,
        actionTypes?: ActionType[]
    ): Promise<IUserAction[]>;
    getAuthorAffinityActions(
        userId: string,
        authorId: string,
        days?: number
    ): Promise<IUserAction[]>;
    logActions(actions: Partial<IUserAction>[]): Promise<void>;
}

const UserAction = mongoose.model<IUserAction, UserActionModel>(
    'UserAction',
    UserActionSchema
);

export default UserAction;
