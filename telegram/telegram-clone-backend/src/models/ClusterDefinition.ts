/**
 * ClusterDefinition - SimClusters 聚类定义模型
 * 
 * 复刻 X Algorithm 的 SimClusters KnownFor 社区定义
 * 参考: https://github.com/twitter/the-algorithm/blob/main/src/scala/com/twitter/simclusters_v2/README.md
 * 
 * 核心概念:
 * - 社区是通过 MH 采样在 Producer-Producer 相似度图上检测出的
 * - 每个社区由一组 Top Producers (KnownFor 用户) 定义
 * - 社区有质心向量, 用于将新内容/用户分类到社区
 * - 典型规模: ~145,000 个社区, 覆盖 Top 20M 生产者
 * 
 * 设计原则:
 * - 社区定义相对稳定, 不频繁更新 (每周/每月)
 * - 支持层级结构 (未来可扩展)
 * - 支持社区标签 (人工或自动生成)
 */

import mongoose, { Document, Schema, Model } from 'mongoose';

// ========== 社区成员类型 ==========
export interface ClusterMember {
    userId: string;      // 用户 ID
    score: number;       // KnownFor 分数 (0-1)
    rank: number;        // 在该社区中的排名
    joinedAt: Date;      // 加入时间
}

// ========== 社区统计信息 ==========
export interface ClusterStats {
    // 成员统计
    totalMembers: number;          // 总成员数 (KnownFor 用户)
    activeMembers: number;         // 活跃成员数 (30 天内有活动)
    avgMemberScore: number;        // 平均 KnownFor 分数

    // 兴趣用户统计
    interestedInCount: number;     // 对该社区感兴趣的用户数

    // 内容统计
    avgDailyPosts: number;         // 日均帖子数
    avgEngagementRate: number;     // 平均互动率

    // 增长统计
    memberGrowthRate: number;      // 成员增长率 (月)
    engagementGrowthRate: number;  // 互动增长率 (月)
}

// ========== 社区类型枚举 ==========
export enum ClusterType {
    USER_COMMUNITY = 'user_community',       // 用户社区 (基于关注图)
    TOPIC_CLUSTER = 'topic_cluster',         // 话题聚类
    INTEREST_GROUP = 'interest_group',       // 兴趣组
    GEOGRAPHIC = 'geographic',               // 地理聚类
    LANGUAGE = 'language',                   // 语言聚类
}

// ========== 主接口定义 ==========
export interface IClusterDefinition extends Document {
    // ===== 核心标识 =====
    clusterId: number;               // 聚类 ID (唯一)
    clusterType: ClusterType;        // 聚类类型

    // ===== 描述信息 =====
    name?: string;                   // 社区名称 (自动生成或人工标注)
    description?: string;            // 社区描述
    tags?: string[];                 // 标签 (用于搜索和分类)

    // ===== 代表性成员 =====
    // Top Producers: 该社区的 KnownFor 用户
    topProducers: ClusterMember[];

    // 代表性内容 ID (热门帖子)
    representativePostIds?: string[];

    // ===== 向量表示 =====
    // 社区质心向量 (用于将新用户/内容分类)
    // 维度与 Two-Tower 嵌入一致 (64 维)
    centroidEmbedding?: number[];

    // 稀疏表示 (与其他社区的关联)
    relatedClusters?: Array<{ clusterId: number; similarity: number }>;

    // ===== 统计信息 =====
    stats: ClusterStats;

    // ===== 层级结构 (可选) =====
    parentClusterId?: number;        // 父聚类 ID
    childClusterIds?: number[];      // 子聚类 ID 列表
    level: number;                   // 层级 (0 = 顶层)

    // ===== 元数据 =====
    version: number;                 // 模型版本
    isActive: boolean;               // 是否激活
    createdAt: Date;
    updatedAt: Date;
    lastRecomputedAt: Date;          // 最后重新计算时间
}

// ========== 默认统计 ==========
const DEFAULT_STATS: ClusterStats = {
    totalMembers: 0,
    activeMembers: 0,
    avgMemberScore: 0,
    interestedInCount: 0,
    avgDailyPosts: 0,
    avgEngagementRate: 0,
    memberGrowthRate: 0,
    engagementGrowthRate: 0,
};

// ========== Schema 定义 ==========
const ClusterMemberSchema = new Schema<ClusterMember>(
    {
        userId: { type: String, required: true },
        score: { type: Number, required: true, min: 0, max: 1 },
        rank: { type: Number, required: true },
        joinedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const ClusterStatsSchema = new Schema<ClusterStats>(
    {
        totalMembers: { type: Number, default: 0 },
        activeMembers: { type: Number, default: 0 },
        avgMemberScore: { type: Number, default: 0 },
        interestedInCount: { type: Number, default: 0 },
        avgDailyPosts: { type: Number, default: 0 },
        avgEngagementRate: { type: Number, default: 0 },
        memberGrowthRate: { type: Number, default: 0 },
        engagementGrowthRate: { type: Number, default: 0 },
    },
    { _id: false }
);

const ClusterDefinitionSchema = new Schema<IClusterDefinition>(
    {
        clusterId: {
            type: Number,
            required: true,
            unique: true,
            index: true,
        },
        clusterType: {
            type: String,
            enum: Object.values(ClusterType),
            default: ClusterType.USER_COMMUNITY,
        },

        // 描述信息
        name: String,
        description: String,
        tags: [String],

        // 成员
        topProducers: {
            type: [ClusterMemberSchema],
            default: [],
        },
        representativePostIds: [String],

        // 向量
        centroidEmbedding: [Number],
        relatedClusters: [{
            clusterId: { type: Number },
            similarity: { type: Number },
            _id: false,
        }],

        // 统计
        stats: {
            type: ClusterStatsSchema,
            default: () => ({ ...DEFAULT_STATS }),
        },

        // 层级
        parentClusterId: Number,
        childClusterIds: [Number],
        level: {
            type: Number,
            default: 0,
        },

        // 元数据
        version: {
            type: Number,
            required: true,
            default: 1,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        lastRecomputedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        collection: 'cluster_definitions',
        timestamps: true,
    }
);

// ========== 索引 ==========

// 标签搜索
ClusterDefinitionSchema.index({ tags: 1 });

// 层级查询
ClusterDefinitionSchema.index({ parentClusterId: 1, level: 1 });

// 活跃社区按成员数排序
ClusterDefinitionSchema.index({ isActive: 1, 'stats.totalMembers': -1 });

// Top Producers 中的用户查询
ClusterDefinitionSchema.index({ 'topProducers.userId': 1 });

// ========== 静态方法 ==========

interface ClusterDefinitionStatics {
    /**
     * 获取聚类定义
     */
    getCluster(clusterId: number): Promise<IClusterDefinition | null>;

    /**
     * 批量获取聚类
     */
    getClustersBatch(clusterIds: number[]): Promise<Map<number, IClusterDefinition>>;

    /**
     * 获取用户所属的聚类 (基于 topProducers)
     */
    getClustersForUser(userId: string): Promise<IClusterDefinition[]>;

    /**
     * 查找与目标聚类最相似的 N 个聚类
     */
    findSimilarClusters(clusterId: number, limit: number): Promise<IClusterDefinition[]>;

    /**
     * 搜索聚类 (按名称或标签)
     */
    searchClusters(query: string, limit: number): Promise<IClusterDefinition[]>;

    /**
     * 更新聚类统计信息
     */
    updateStats(clusterId: number, stats: Partial<ClusterStats>): Promise<void>;

    /**
     * 添加成员到聚类
     */
    addMember(clusterId: number, member: ClusterMember): Promise<void>;

    /**
     * 获取顶级聚类 (按成员数)
     */
    getTopClusters(limit: number): Promise<IClusterDefinition[]>;
}

// 获取聚类
ClusterDefinitionSchema.statics.getCluster = async function (
    clusterId: number
): Promise<IClusterDefinition | null> {
    return this.findOne({ clusterId, isActive: true });
};

// 批量获取
ClusterDefinitionSchema.statics.getClustersBatch = async function (
    clusterIds: number[]
): Promise<Map<number, IClusterDefinition>> {
    const clusters = await this.find({
        clusterId: { $in: clusterIds },
        isActive: true,
    });

    const result = new Map<number, IClusterDefinition>();
    for (const cluster of clusters) {
        result.set(cluster.clusterId, cluster);
    }
    return result;
};

// 获取用户所属聚类
ClusterDefinitionSchema.statics.getClustersForUser = async function (
    userId: string
): Promise<IClusterDefinition[]> {
    return this.find({
        'topProducers.userId': userId,
        isActive: true,
    }).sort({ 'topProducers.score': -1 });
};

// 查找相似聚类
ClusterDefinitionSchema.statics.findSimilarClusters = async function (
    clusterId: number,
    limit: number = 10
): Promise<IClusterDefinition[]> {
    const cluster = await this.findOne({ clusterId, isActive: true });
    if (!cluster || !cluster.relatedClusters?.length) {
        return [];
    }

    // 按相似度排序
    const relatedIds = cluster.relatedClusters
        .sort((a: { clusterId: number; similarity: number }, b: { clusterId: number; similarity: number }) => b.similarity - a.similarity)
        .slice(0, limit)
        .map((r: { clusterId: number }) => r.clusterId);

    return this.find({
        clusterId: { $in: relatedIds },
        isActive: true,
    });
};

// 搜索聚类
ClusterDefinitionSchema.statics.searchClusters = async function (
    query: string,
    limit: number = 20
): Promise<IClusterDefinition[]> {
    const regex = new RegExp(query, 'i');

    return this.find({
        isActive: true,
        $or: [
            { name: regex },
            { description: regex },
            { tags: regex },
        ],
    })
        .sort({ 'stats.totalMembers': -1 })
        .limit(limit);
};

// 更新统计
ClusterDefinitionSchema.statics.updateStats = async function (
    clusterId: number,
    stats: Partial<ClusterStats>
): Promise<void> {
    const updateObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stats)) {
        updateObj[`stats.${key}`] = value;
    }

    await this.updateOne(
        { clusterId },
        { $set: updateObj }
    );
};

// 添加成员
ClusterDefinitionSchema.statics.addMember = async function (
    clusterId: number,
    member: ClusterMember
): Promise<void> {
    await this.updateOne(
        { clusterId },
        {
            $push: { topProducers: member },
            $inc: { 'stats.totalMembers': 1 },
        }
    );
};

// 获取顶级聚类
ClusterDefinitionSchema.statics.getTopClusters = async function (
    limit: number = 100
): Promise<IClusterDefinition[]> {
    return this.find({ isActive: true })
        .sort({ 'stats.totalMembers': -1 })
        .limit(limit);
};

// ========== 模型导出 ==========
interface ClusterDefinitionModel extends Model<IClusterDefinition>, ClusterDefinitionStatics { }

const ClusterDefinition = mongoose.model<IClusterDefinition, ClusterDefinitionModel>(
    'ClusterDefinition',
    ClusterDefinitionSchema
);

export default ClusterDefinition;
