/**
 * RealGraphEdge - 社交关系分数模型
 * 
 * 复刻 X Algorithm 的 Real Graph
 * 参考: https://github.com/twitter/the-algorithm/blob/main/src/scala/com/twitter/interaction_graph/README.md
 * 
 * 核心概念:
 * - 用户对之间的交互边 (有向图)
 * - 交互计数 (按类型: like, reply, retweet, click 等)
 * - 衰减聚合 (decayed sum): 每日衰减旧交互权重
 * - ML 预测分数: 预测用户 A 与用户 B 未来交互的概率
 * 
 * 设计原则:
 * - 每对用户最多一条边 (sourceUserId, targetUserId) 唯一
 * - 边分数会随时间衰减, 保持新鲜度
 * - 支持双向计算 (A->B 和 B->A 是不同的边)
 */

import mongoose, { Document, Schema, Model } from 'mongoose';

// ========== 交互类型枚举 ==========
export enum InteractionType {
    // 公开交互 (public engagements)
    FOLLOW = 'follow',
    LIKE = 'like',
    REPLY = 'reply',
    RETWEET = 'retweet',
    QUOTE = 'quote',
    MENTION = 'mention',

    // 私密交互 (private engagements)
    PROFILE_VIEW = 'profile_view',
    TWEET_CLICK = 'tweet_click',
    DWELL = 'dwell',               // 停留时间
    ADDRESS_BOOK = 'address_book', // 通讯录关联 (需用户授权)

    // 负向信号
    MUTE = 'mute',
    BLOCK = 'block',
    UNFOLLOW = 'unfollow',
    REPORT = 'report',
}

// ========== 交互计数接口 ==========
export interface InteractionCounts {
    // 公开交互计数
    followCount: number;      // 关注状态 (0 或 1)
    likeCount: number;        // 点赞次数
    replyCount: number;       // 回复次数
    retweetCount: number;     // 转发次数
    quoteCount: number;       // 引用次数
    mentionCount: number;     // 提及次数

    // 私密交互计数
    profileViewCount: number; // 主页访问次数
    tweetClickCount: number;  // 帖子点击次数
    dwellTimeMs: number;      // 累计停留时间 (毫秒)

    // 负向信号
    muteCount: number;        // 静音次数 (通常 0 或 1)
    blockCount: number;       // 拉黑次数 (通常 0 或 1)
    reportCount: number;      // 举报次数
}

// ========== 主接口定义 ==========
export interface IRealGraphEdge extends Document {
    // ========== 边的端点 ==========
    // 有向边: source -> target
    sourceUserId: string;
    targetUserId: string;

    // ========== 交互计数 ==========
    // 当日新增计数 (每日重置)
    dailyCounts: InteractionCounts;

    // 滚动聚合计数 (含衰减)
    rollupCounts: InteractionCounts;

    // ========== 衰减聚合分数 ==========
    // 综合衰减分数 (所有交互的加权和)
    // 公式: decayedSum = Σ(count_i × weight_i × decay^days)
    decayedSum: number;

    // ========== ML 预测分数 ==========
    // 交互概率预测 (0-1)
    // 来源: Gradient Boosting Tree 模型
    interactionProbability: number;

    // 模型版本
    modelVersion?: string;

    // ========== 时间戳 ==========
    // 首次交互时间
    firstInteractionAt: Date;

    // 最后交互时间
    lastInteractionAt: Date;

    // 最后衰减应用时间
    lastDecayAppliedAt: Date;

    // 最后 ML 预测时间
    lastPredictionAt?: Date;

    // 记录更新时间
    updatedAt: Date;
}

// ========== 默认交互计数 ==========
const DEFAULT_COUNTS: InteractionCounts = {
    followCount: 0,
    likeCount: 0,
    replyCount: 0,
    retweetCount: 0,
    quoteCount: 0,
    mentionCount: 0,
    profileViewCount: 0,
    tweetClickCount: 0,
    dwellTimeMs: 0,
    muteCount: 0,
    blockCount: 0,
    reportCount: 0,
};

// ========== Schema 定义 ==========
const InteractionCountsSchema = new Schema<InteractionCounts>(
    {
        followCount: { type: Number, default: 0 },
        likeCount: { type: Number, default: 0 },
        replyCount: { type: Number, default: 0 },
        retweetCount: { type: Number, default: 0 },
        quoteCount: { type: Number, default: 0 },
        mentionCount: { type: Number, default: 0 },
        profileViewCount: { type: Number, default: 0 },
        tweetClickCount: { type: Number, default: 0 },
        dwellTimeMs: { type: Number, default: 0 },
        muteCount: { type: Number, default: 0 },
        blockCount: { type: Number, default: 0 },
        reportCount: { type: Number, default: 0 },
    },
    { _id: false }
);

const RealGraphEdgeSchema = new Schema<IRealGraphEdge>(
    {
        sourceUserId: {
            type: String,
            required: true,
            index: true,
        },
        targetUserId: {
            type: String,
            required: true,
            index: true,
        },

        // 交互计数
        dailyCounts: {
            type: InteractionCountsSchema,
            default: () => ({ ...DEFAULT_COUNTS }),
        },
        rollupCounts: {
            type: InteractionCountsSchema,
            default: () => ({ ...DEFAULT_COUNTS }),
        },

        // 分数
        decayedSum: {
            type: Number,
            default: 0,
            index: true, // 用于排序最亲密关系
        },
        interactionProbability: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        modelVersion: String,

        // 时间戳
        firstInteractionAt: {
            type: Date,
            default: Date.now,
        },
        lastInteractionAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        lastDecayAppliedAt: {
            type: Date,
            default: Date.now,
        },
        lastPredictionAt: Date,
    },
    {
        collection: 'real_graph_edges',
        timestamps: true,
    }
);

// ========== 唯一复合索引 ==========
// 每对用户只有一条边
RealGraphEdgeSchema.index(
    { sourceUserId: 1, targetUserId: 1 },
    { unique: true }
);

// 查询用户的所有出边 (我关注的人)
RealGraphEdgeSchema.index({ sourceUserId: 1, decayedSum: -1 });

// 查询用户的所有入边 (关注我的人)
RealGraphEdgeSchema.index({ targetUserId: 1, decayedSum: -1 });

// 衰减任务索引: 查找需要衰减的边
RealGraphEdgeSchema.index({ lastDecayAppliedAt: 1 });

// ========== 衰减配置 ==========
// 复刻 X 的衰减参数
const DECAY_CONFIG = {
    // 每日衰减系数 (典型值 0.85-0.95)
    dailyDecayRate: 0.9,

    // 各交互类型权重
    weights: {
        follow: 10.0,
        like: 1.0,
        reply: 3.0,
        retweet: 2.0,
        quote: 2.5,
        mention: 1.5,
        profileView: 0.5,
        tweetClick: 0.3,
        dwell: 0.001,
        mute: -5.0,
        block: -10.0,
        report: -8.0,
    },

    // 最小保留分数 (低于此值的边可能被清理)
    minRetainScore: 0.01,
};

// ========== 独立计算函数 ==========
/**
 * 计算衰减分数 (模块级函数, 避免 this 类型问题)
 */
function computeDecayedSumFromCounts(counts: InteractionCounts): number {
    const w = DECAY_CONFIG.weights;
    return (
        counts.followCount * w.follow +
        counts.likeCount * w.like +
        counts.replyCount * w.reply +
        counts.retweetCount * w.retweet +
        counts.quoteCount * w.quote +
        counts.mentionCount * w.mention +
        counts.profileViewCount * w.profileView +
        counts.tweetClickCount * w.tweetClick +
        counts.dwellTimeMs * w.dwell +
        counts.muteCount * w.mute +
        counts.blockCount * w.block +
        counts.reportCount * w.report
    );
}

// ========== 静态方法 ==========

interface RealGraphEdgeStatics {
    /**
     * 记录一次交互 (增量更新)
     * 复刻 real-graph 的 daily aggregation
     */
    recordInteraction(
        sourceUserId: string,
        targetUserId: string,
        interactionType: InteractionType,
        value?: number
    ): Promise<IRealGraphEdge>;

    /**
     * 获取边分数
     * 复刻 real-graph 的 getScore()
     */
    getEdgeScore(sourceUserId: string, targetUserId: string): Promise<number>;

    /**
     * 获取用户 Top-N 亲密关系
     * 复刻 real-graph 的 getTopConnections()
     */
    getTopConnections(userId: string, limit: number): Promise<IRealGraphEdge[]>;

    /**
     * 获取双向关系分数 (A->B + B->A)
     */
    getMutualScore(userId1: string, userId2: string): Promise<number>;

    /**
     * 应用每日衰减 (定时任务调用)
     * 复刻 real-graph 的 rollup job
     */
    applyDailyDecay(batchSize?: number): Promise<number>;

    /**
     * 计算衰减分数
     */
    computeDecayedSum(counts: InteractionCounts): number;
}

// 记录交互
RealGraphEdgeSchema.statics.recordInteraction = async function (
    sourceUserId: string,
    targetUserId: string,
    interactionType: InteractionType,
    value: number = 1
): Promise<IRealGraphEdge> {
    // 映射交互类型到字段名
    const fieldMap: Record<InteractionType, keyof InteractionCounts> = {
        [InteractionType.FOLLOW]: 'followCount',
        [InteractionType.LIKE]: 'likeCount',
        [InteractionType.REPLY]: 'replyCount',
        [InteractionType.RETWEET]: 'retweetCount',
        [InteractionType.QUOTE]: 'quoteCount',
        [InteractionType.MENTION]: 'mentionCount',
        [InteractionType.PROFILE_VIEW]: 'profileViewCount',
        [InteractionType.TWEET_CLICK]: 'tweetClickCount',
        [InteractionType.DWELL]: 'dwellTimeMs',
        [InteractionType.MUTE]: 'muteCount',
        [InteractionType.BLOCK]: 'blockCount',
        [InteractionType.UNFOLLOW]: 'followCount', // 减少
        [InteractionType.REPORT]: 'reportCount',
        [InteractionType.ADDRESS_BOOK]: 'followCount', // 视为关注加强
    };

    const field = fieldMap[interactionType];
    if (!field) {
        throw new Error(`Unknown interaction type: ${interactionType}`);
    }

    const now = new Date();
    const updateOp: Record<string, any> = {
        $set: { lastInteractionAt: now },
        $setOnInsert: { firstInteractionAt: now, lastDecayAppliedAt: now },
    };

    // 增量更新对应字段
    if (interactionType === InteractionType.UNFOLLOW) {
        // 取消关注是减少
        updateOp.$inc = {
            [`dailyCounts.${field}`]: -1,
            [`rollupCounts.${field}`]: -1,
        };
    } else if (interactionType === InteractionType.DWELL) {
        // 停留时间是累加毫秒
        updateOp.$inc = {
            [`dailyCounts.${field}`]: value,
            [`rollupCounts.${field}`]: value,
        };
    } else {
        updateOp.$inc = {
            [`dailyCounts.${field}`]: value,
            [`rollupCounts.${field}`]: value,
        };
    }

    const edge = await this.findOneAndUpdate(
        { sourceUserId, targetUserId },
        updateOp,
        { upsert: true, new: true }
    );

    // 重新计算衰减分数 (使用模块级函数)
    edge.decayedSum = computeDecayedSumFromCounts(edge.rollupCounts);
    await edge.save();

    return edge;
};

// 获取边分数
RealGraphEdgeSchema.statics.getEdgeScore = async function (
    sourceUserId: string,
    targetUserId: string
): Promise<number> {
    const edge = await this.findOne({ sourceUserId, targetUserId });
    return edge?.decayedSum || 0;
};

// 获取 Top-N 亲密关系
RealGraphEdgeSchema.statics.getTopConnections = async function (
    userId: string,
    limit: number = 50
): Promise<IRealGraphEdge[]> {
    return this.find({ sourceUserId: userId, decayedSum: { $gt: 0 } })
        .sort({ decayedSum: -1 })
        .limit(limit);
};

// 获取双向分数
RealGraphEdgeSchema.statics.getMutualScore = async function (
    userId1: string,
    userId2: string
): Promise<number> {
    const [edge1, edge2] = await Promise.all([
        this.findOne({ sourceUserId: userId1, targetUserId: userId2 }),
        this.findOne({ sourceUserId: userId2, targetUserId: userId1 }),
    ]);
    return (edge1?.decayedSum || 0) + (edge2?.decayedSum || 0);
};

// 应用每日衰减
RealGraphEdgeSchema.statics.applyDailyDecay = async function (
    batchSize: number = 1000
): Promise<number> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // 查找需要衰减的边
    const edges = await this.find({
        lastDecayAppliedAt: { $lt: yesterday },
        decayedSum: { $gt: DECAY_CONFIG.minRetainScore },
    }).limit(batchSize);

    let processedCount = 0;

    for (const edge of edges) {
        // 计算自上次衰减以来的天数
        const daysSinceDecay = Math.floor(
            (Date.now() - edge.lastDecayAppliedAt.getTime()) / (24 * 60 * 60 * 1000)
        );

        if (daysSinceDecay >= 1) {
            // 应用衰减
            const decayFactor = Math.pow(DECAY_CONFIG.dailyDecayRate, daysSinceDecay);

            // 衰减各计数字段
            const counts = edge.rollupCounts;
            counts.likeCount = Math.floor(counts.likeCount * decayFactor);
            counts.replyCount = Math.floor(counts.replyCount * decayFactor);
            counts.retweetCount = Math.floor(counts.retweetCount * decayFactor);
            counts.quoteCount = Math.floor(counts.quoteCount * decayFactor);
            counts.mentionCount = Math.floor(counts.mentionCount * decayFactor);
            counts.profileViewCount = Math.floor(counts.profileViewCount * decayFactor);
            counts.tweetClickCount = Math.floor(counts.tweetClickCount * decayFactor);
            counts.dwellTimeMs = Math.floor(counts.dwellTimeMs * decayFactor);
            // followCount 不衰减 (关注状态是持久的)
            // 负向信号不衰减 (惩罚是持久的)

            // 重新计算分数 (使用模块级函数)
            edge.decayedSum = computeDecayedSumFromCounts(counts);
            edge.lastDecayAppliedAt = new Date();

            // 重置每日计数
            edge.dailyCounts = { ...DEFAULT_COUNTS };

            await edge.save();
            processedCount++;
        }
    }

    return processedCount;
};

// 计算衰减分数 (调用模块级函数)
RealGraphEdgeSchema.statics.computeDecayedSum = function (
    counts: InteractionCounts
): number {
    return computeDecayedSumFromCounts(counts);
};

// ========== 模型导出 ==========
interface RealGraphEdgeModel extends Model<IRealGraphEdge>, RealGraphEdgeStatics { }

const RealGraphEdge = mongoose.model<IRealGraphEdge, RealGraphEdgeModel>(
    'RealGraphEdge',
    RealGraphEdgeSchema
);

export default RealGraphEdge;
export { DECAY_CONFIG, DEFAULT_COUNTS };
