/**
 * UserFeatureVector - 用户特征向量模型
 * 
 * 复刻 X Algorithm 的 SimClusters 嵌入存储
 * 参考: https://github.com/twitter/the-algorithm/blob/main/src/scala/com/twitter/simclusters_v2/README.md
 * 
 * 核心概念:
 * - InterestedIn: 用户对各社区的兴趣分布 (矩阵 U = A × V)
 * - KnownFor: 用户作为生产者的主聚类 (最大稀疏)
 * - ProducerEmbedding: 用户作为生产者的多社区表示
 * 
 * 存储设计:
 * - SimClusters 使用稀疏向量 (最多 ~50 个非零值)
 * - Two-Tower/Phoenix 使用稠密向量 (64/256 维)
 */

import mongoose, { Document, Schema, Model } from 'mongoose';

// ========== 稀疏向量元素类型 ==========
export interface SparseVectorElement {
    clusterId: number;
    score: number;
}

// ========== 嵌入类型枚举 ==========
export enum EmbeddingType {
    // SimClusters 系列
    INTERESTED_IN = 'interested_in',           // 消费者兴趣
    KNOWN_FOR = 'known_for',                   // 生产者主聚类
    PRODUCER_EMBEDDING = 'producer_embedding', // 生产者多社区

    // 稠密嵌入系列
    TWO_TOWER = 'two_tower',                   // Two-Tower 用户嵌入
    PHOENIX = 'phoenix',                       // Phoenix 用户嵌入
    TWHIN = 'twhin',                           // TwHIN 图嵌入
}

// ========== 主接口定义 ==========
export interface IUserFeatureVector extends Document {
    userId: string;

    // ========== SimClusters 稀疏嵌入 ==========
    // InterestedIn: 用户对各社区的兴趣分布
    // 来源: 用户关注列表 × KnownFor 矩阵
    // 典型大小: 20-50 个非零元素
    interestedInClusters: SparseVectorElement[];

    // KnownFor: 用户作为生产者的主聚类 (最大稀疏, 只有 1 个)
    // 来源: MH 采样社区检测
    knownForCluster?: number;
    knownForScore?: number;

    // ProducerEmbedding: 用户作为内容生产者的多社区表示
    // 来源: 用户粉丝的 InterestedIn 余弦相似度
    producerEmbedding?: SparseVectorElement[];

    // ========== 稠密嵌入 ==========
    // Two-Tower 用户嵌入 (64 维)
    // 来源: Two-Tower 模型用户塔输出
    twoTowerEmbedding?: number[];

    // Phoenix 用户嵌入 (256 维)
    // 来源: Phoenix 模型用户表示层
    phoenixEmbedding?: number[];

    // TwHIN 嵌入 (可选, 图神经网络输出)
    twhinEmbedding?: number[];

    // ========== 元数据 ==========
    // 嵌入版本 (用于模型更新追踪)
    version: number;

    // 模型版本 ID (哪个模型生成的)
    modelVersion?: string;

    // 计算时间戳
    computedAt: Date;

    // 过期时间 (用于 TTL 索引)
    expiresAt: Date;

    // 质量分数 (嵌入是否可靠, 基于用户活跃度)
    qualityScore?: number;
}

// ========== Schema 定义 ==========
const SparseVectorElementSchema = new Schema<SparseVectorElement>(
    {
        clusterId: { type: Number, required: true },
        score: { type: Number, required: true },
    },
    { _id: false }
);

const UserFeatureVectorSchema = new Schema<IUserFeatureVector>(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },

        // SimClusters 稀疏嵌入
        interestedInClusters: {
            type: [SparseVectorElementSchema],
            default: [],
        },
        knownForCluster: Number,
        knownForScore: Number,
        producerEmbedding: {
            type: [SparseVectorElementSchema],
            default: undefined,
        },

        // 稠密嵌入 (使用 Mixed 类型存储数组以提高性能)
        twoTowerEmbedding: {
            type: [Number],
            default: undefined,
        },
        phoenixEmbedding: {
            type: [Number],
            default: undefined,
        },
        twhinEmbedding: {
            type: [Number],
            default: undefined,
        },

        // 元数据
        version: {
            type: Number,
            required: true,
            default: 1,
        },
        modelVersion: String,
        computedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        expiresAt: {
            type: Date,
            required: true,
            default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 天后
        },
        qualityScore: {
            type: Number,
            min: 0,
            max: 1,
        },
    },
    {
        collection: 'user_feature_vectors',
        timestamps: true
    }
);

// ========== 索引 ==========

// TTL 索引: 自动清理过期嵌入
UserFeatureVectorSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

// 版本索引: 用于批量更新
UserFeatureVectorSchema.index({ version: 1, computedAt: 1 });

// 质量分数索引: 用于筛选可靠嵌入
UserFeatureVectorSchema.index({ qualityScore: -1 });

// ========== 静态方法 ==========

interface UserFeatureVectorStatics {
    /**
     * 获取用户嵌入 (带过期检查)
     * 复刻 SimClusters 的 InterestedInStore.get()
     */
    getUserEmbedding(userId: string): Promise<IUserFeatureVector | null>;

    /**
     * 批量获取用户嵌入
     * 复刻 SimClusters 的 InterestedInStore.multiGet()
     */
    getUserEmbeddingsBatch(userIds: string[]): Promise<Map<string, IUserFeatureVector>>;

    /**
     * 更新或创建用户嵌入
     * 复刻 SimClusters 的 InterestedInStore.put()
     */
    upsertEmbedding(
        userId: string,
        embeddings: Partial<IUserFeatureVector>,
        version: number
    ): Promise<IUserFeatureVector>;

    /**
     * 计算两个用户的相似度 (基于 InterestedIn)
     * 复刻 SimClusters 的余弦相似度计算
     */
    computeSimilarity(userId1: string, userId2: string): Promise<number>;

    /**
     * 获取与目标用户最相似的 N 个用户
     */
    findSimilarUsers(userId: string, limit: number): Promise<Array<{ userId: string; similarity: number }>>;
}

// 获取用户嵌入
UserFeatureVectorSchema.statics.getUserEmbedding = async function (
    userId: string
): Promise<IUserFeatureVector | null> {
    const doc = await this.findOne({
        userId,
        expiresAt: { $gt: new Date() } // 只返回未过期的
    });
    return doc;
};

// 批量获取
UserFeatureVectorSchema.statics.getUserEmbeddingsBatch = async function (
    userIds: string[]
): Promise<Map<string, IUserFeatureVector>> {
    const docs = await this.find({
        userId: { $in: userIds },
        expiresAt: { $gt: new Date() }
    });

    const result = new Map<string, IUserFeatureVector>();
    for (const doc of docs) {
        result.set(doc.userId, doc);
    }
    return result;
};

// 更新或创建
UserFeatureVectorSchema.statics.upsertEmbedding = async function (
    userId: string,
    embeddings: Partial<IUserFeatureVector>,
    version: number
): Promise<IUserFeatureVector> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const doc = await this.findOneAndUpdate(
        { userId },
        {
            $set: {
                ...embeddings,
                version,
                computedAt: now,
                expiresAt,
            }
        },
        { upsert: true, new: true }
    );

    return doc;
};

// 计算相似度 (稀疏向量余弦相似度)
UserFeatureVectorSchema.statics.computeSimilarity = async function (
    userId1: string,
    userId2: string
): Promise<number> {
    const model = this as UserFeatureVectorModel;
    const [user1, user2] = await Promise.all([
        model.findOne({ userId: userId1, expiresAt: { $gt: new Date() } }),
        model.findOne({ userId: userId2, expiresAt: { $gt: new Date() } })
    ]);

    if (!user1 || !user2) return 0;

    const vec1 = user1.interestedInClusters;
    const vec2 = user2.interestedInClusters;

    if (!vec1.length || !vec2.length) return 0;

    // 构建 clusterId -> score 映射
    const map1 = new Map<number, number>(vec1.map((e: SparseVectorElement) => [e.clusterId, e.score]));
    const map2 = new Map<number, number>(vec2.map((e: SparseVectorElement) => [e.clusterId, e.score]));

    // 计算点积
    let dotProduct = 0;
    for (const [clusterId, score1] of map1) {
        const score2 = map2.get(clusterId);
        if (score2 !== undefined) {
            dotProduct += score1 * score2;
        }
    }

    // 计算模长
    const norm1 = Math.sqrt(vec1.reduce((sum: number, e: SparseVectorElement) => sum + e.score * e.score, 0));
    const norm2 = Math.sqrt(vec2.reduce((sum: number, e: SparseVectorElement) => sum + e.score * e.score, 0));

    if (norm1 === 0 || norm2 === 0) return 0;

    return dotProduct / (norm1 * norm2);
};

// 查找相似用户
UserFeatureVectorSchema.statics.findSimilarUsers = async function (
    userId: string,
    limit: number = 10
): Promise<Array<{ userId: string; similarity: number }>> {
    const model = this as UserFeatureVectorModel;
    const targetUser = await model.findOne({ userId, expiresAt: { $gt: new Date() } });
    if (!targetUser || !targetUser.interestedInClusters.length) {
        return [];
    }

    // 获取目标用户的聚类 IDs
    const targetClusterIds = targetUser.interestedInClusters.map((e: SparseVectorElement) => e.clusterId);

    // 查找有相同聚类的用户 (粗筛)
    const candidates = await model.find({
        userId: { $ne: userId },
        'interestedInClusters.clusterId': { $in: targetClusterIds },
        expiresAt: { $gt: new Date() }
    }).limit(limit * 10);

    // 计算相似度并排序
    const similarities: Array<{ userId: string; similarity: number }> = [];

    for (const candidate of candidates) {
        const similarity = await model.computeSimilarity(userId, candidate.userId);
        if (similarity > 0) {
            similarities.push({ userId: candidate.userId, similarity });
        }
    }

    // 按相似度降序排序
    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, limit);
};

// ========== 模型导出 ==========
interface UserFeatureVectorModel extends Model<IUserFeatureVector>, UserFeatureVectorStatics { }

const UserFeatureVector = mongoose.model<IUserFeatureVector, UserFeatureVectorModel>(
    'UserFeatureVector',
    UserFeatureVectorSchema
);

export default UserFeatureVector;
