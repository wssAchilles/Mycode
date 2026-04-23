import mongoose, { Document, Model, Schema } from 'mongoose';

export interface PostFeatureClusterScore {
    clusterId: number;
    score: number;
}

export interface PostFeatureKeywordScore {
    keyword: string;
    weight: number;
}

export type PostEngagementBucket =
    | 'low'
    | 'medium'
    | 'high'
    | 'viral';

export type PostFreshnessBucket =
    | 'hours_24'
    | 'days_7'
    | 'days_30'
    | 'days_90'
    | 'stale';

export interface IPostFeatureSnapshot extends Document {
    postId: mongoose.Types.ObjectId;
    authorId: string;
    createdAt: Date;
    postCreatedAt: Date;
    isNews: boolean;
    language?: string;
    keywords: string[];
    keywordScores: PostFeatureKeywordScore[];
    dominantClusterIds: number[];
    clusterScores: PostFeatureClusterScore[];
    authorKnownForCluster?: number;
    authorProducerClusters: PostFeatureClusterScore[];
    denseEmbedding: number[];
    engagementBucket: PostEngagementBucket;
    freshnessBucket: PostFreshnessBucket;
    hasMedia: boolean;
    mediaTypes: string[];
    qualityScore: number;
    snapshotVersion: number;
    computedAt: Date;
}

const ClusterScoreSchema = new Schema<PostFeatureClusterScore>(
    {
        clusterId: { type: Number, required: true },
        score: { type: Number, required: true },
    },
    { _id: false },
);

const KeywordScoreSchema = new Schema<PostFeatureKeywordScore>(
    {
        keyword: { type: String, required: true },
        weight: { type: Number, required: true },
    },
    { _id: false },
);

const PostFeatureSnapshotSchema = new Schema<IPostFeatureSnapshot>(
    {
        postId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            required: true,
            unique: true,
            index: true,
        },
        authorId: {
            type: String,
            required: true,
            index: true,
        },
        postCreatedAt: {
            type: Date,
            required: true,
            index: true,
        },
        isNews: {
            type: Boolean,
            default: false,
            index: true,
        },
        language: String,
        keywords: {
            type: [String],
            default: [],
        },
        keywordScores: {
            type: [KeywordScoreSchema],
            default: [],
        },
        dominantClusterIds: {
            type: [Number],
            default: [],
            index: true,
        },
        clusterScores: {
            type: [ClusterScoreSchema],
            default: [],
        },
        authorKnownForCluster: Number,
        authorProducerClusters: {
            type: [ClusterScoreSchema],
            default: [],
        },
        denseEmbedding: {
            type: [Number],
            default: [],
        },
        engagementBucket: {
            type: String,
            enum: ['low', 'medium', 'high', 'viral'],
            required: true,
            index: true,
        },
        freshnessBucket: {
            type: String,
            enum: ['hours_24', 'days_7', 'days_30', 'days_90', 'stale'],
            required: true,
            index: true,
        },
        hasMedia: {
            type: Boolean,
            default: false,
        },
        mediaTypes: {
            type: [String],
            default: [],
        },
        qualityScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        snapshotVersion: {
            type: Number,
            default: 1,
            index: true,
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        collection: 'post_feature_snapshots',
        timestamps: true,
    },
);

PostFeatureSnapshotSchema.index({
    isNews: 1,
    dominantClusterIds: 1,
    postCreatedAt: -1,
    qualityScore: -1,
});
PostFeatureSnapshotSchema.index({
    authorId: 1,
    postCreatedAt: -1,
});

interface PostFeatureSnapshotModel extends Model<IPostFeatureSnapshot> {
    getByPostIds(postIds: mongoose.Types.ObjectId[]): Promise<Map<string, IPostFeatureSnapshot>>;
    getByDominantClusters(
        clusterIds: number[],
        options?: {
            limit?: number;
            createdAfter?: Date;
            excludePostIds?: mongoose.Types.ObjectId[];
            excludeAuthorIds?: string[];
            newsOnly?: boolean;
        },
    ): Promise<IPostFeatureSnapshot[]>;
    getRecentDenseCandidates(options?: {
        limit?: number;
        createdAfter?: Date;
        excludePostIds?: mongoose.Types.ObjectId[];
        excludeAuthorIds?: string[];
        newsOnly?: boolean;
    }): Promise<IPostFeatureSnapshot[]>;
}

PostFeatureSnapshotSchema.statics.getByPostIds = async function (
    postIds: mongoose.Types.ObjectId[],
): Promise<Map<string, IPostFeatureSnapshot>> {
    if (postIds.length === 0) return new Map();
    const docs = await this.find({ postId: { $in: postIds } });
    return new Map(docs.map((doc: IPostFeatureSnapshot) => [doc.postId.toString(), doc]));
};

PostFeatureSnapshotSchema.statics.getByDominantClusters = async function (
    clusterIds: number[],
    options?: {
        limit?: number;
        createdAfter?: Date;
        excludePostIds?: mongoose.Types.ObjectId[];
        excludeAuthorIds?: string[];
        newsOnly?: boolean;
    },
): Promise<IPostFeatureSnapshot[]> {
    if (clusterIds.length === 0) return [];

    const query: Record<string, unknown> = {
        dominantClusterIds: { $in: clusterIds },
    };

    if (options?.createdAfter) {
        query.postCreatedAt = { $gte: options.createdAfter };
    }
    if (options?.excludePostIds?.length) {
        query.postId = { $nin: options.excludePostIds };
    }
    if (options?.excludeAuthorIds?.length) {
        query.authorId = { $nin: options.excludeAuthorIds };
    }
    if (typeof options?.newsOnly === 'boolean') {
        query.isNews = options.newsOnly;
    }

    return this.find(query)
        .sort({ qualityScore: -1, postCreatedAt: -1, computedAt: -1 })
        .limit(Math.max(1, Math.min(options?.limit ?? 100, 500)))
        .lean();
};

PostFeatureSnapshotSchema.statics.getRecentDenseCandidates = async function (
    options?: {
        limit?: number;
        createdAfter?: Date;
        excludePostIds?: mongoose.Types.ObjectId[];
        excludeAuthorIds?: string[];
        newsOnly?: boolean;
    },
): Promise<IPostFeatureSnapshot[]> {
    const query: Record<string, unknown> = {
        denseEmbedding: { $exists: true, $ne: [] },
    };

    if (options?.createdAfter) {
        query.postCreatedAt = { $gte: options.createdAfter };
    }
    if (options?.excludePostIds?.length) {
        query.postId = { $nin: options.excludePostIds };
    }
    if (options?.excludeAuthorIds?.length) {
        query.authorId = { $nin: options.excludeAuthorIds };
    }
    if (typeof options?.newsOnly === 'boolean') {
        query.isNews = options.newsOnly;
    }

    return this.find(query)
        .sort({ qualityScore: -1, postCreatedAt: -1, computedAt: -1 })
        .limit(Math.max(1, Math.min(options?.limit ?? 100, 500)))
        .lean();
};

const PostFeatureSnapshot = mongoose.model<IPostFeatureSnapshot, PostFeatureSnapshotModel>(
    'PostFeatureSnapshot',
    PostFeatureSnapshotSchema,
);

export default PostFeatureSnapshot;
