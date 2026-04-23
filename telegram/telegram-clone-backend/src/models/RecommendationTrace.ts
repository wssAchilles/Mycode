import mongoose, { Document, Model, Schema } from 'mongoose';

export interface RecommendationTraceSourceCount {
    source: string;
    count: number;
}

export interface RecommendationTraceCandidate {
    postId: mongoose.Types.ObjectId;
    modelPostId?: string;
    authorId: string;
    rank: number;
    recallSource: string;
    inNetwork: boolean;
    isNews: boolean;
    score?: number;
    weightedScore?: number;
    pipelineScore?: number;
    scoreBreakdown?: Record<string, number>;
    recommendationDetail?: string;
    sourceReason?: string;
    evidence?: string[];
    explainSignals?: Record<string, number>;
    createdAt?: Date;
}

export interface RecommendationTraceFreshnessStats {
    newestAgeSeconds?: number;
    oldestAgeSeconds?: number;
    timeRangeSeconds?: number;
}

export interface RecommendationTraceShadowComparison {
    overlapCount: number;
    overlapRatio: number;
    selectedCount: number;
    baselineCount: number;
}

export interface RecommendationTraceServingMetadata {
    servingVersion?: string;
    stableOrderKey?: string;
    cursor?: string;
    nextCursor?: string;
    servedStateVersion?: string;
    hasMore?: boolean;
}

export interface RecommendationTraceReplayPool {
    poolKind: string;
    totalCount: number;
    truncated: boolean;
    candidates: RecommendationTraceCandidate[];
}

export interface IRecommendationTrace extends Document {
    requestId: string;
    userId: string;
    productSurface: string;
    pipeline?: string;
    pipelineVersion?: string;
    traceVersion?: string;
    owner?: string;
    fallbackMode?: string;
    degradedReasons: string[];
    selectedCount: number;
    inNetworkCount: number;
    outOfNetworkCount: number;
    sourceCounts: RecommendationTraceSourceCount[];
    authorDiversity: number;
    replyRatio: number;
    averageScore: number;
    topScore?: number;
    bottomScore?: number;
    freshness: RecommendationTraceFreshnessStats;
    candidates: RecommendationTraceCandidate[];
    experimentKeys: string[];
    userState?: string;
    embeddingQualityScore?: number;
    replayPool?: RecommendationTraceReplayPool;
    shadowComparison?: RecommendationTraceShadowComparison;
    serving?: RecommendationTraceServingMetadata;
    createdAt: Date;
}

const SourceCountSchema = new Schema<RecommendationTraceSourceCount>(
    {
        source: { type: String, required: true },
        count: { type: Number, required: true },
    },
    { _id: false },
);

const TraceCandidateSchema = new Schema<RecommendationTraceCandidate>(
    {
        postId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            required: true,
            index: true,
        },
        modelPostId: {
            type: String,
            index: true,
        },
        authorId: {
            type: String,
            required: true,
            index: true,
        },
        rank: {
            type: Number,
            required: true,
        },
        recallSource: {
            type: String,
            required: true,
            index: true,
        },
        inNetwork: {
            type: Boolean,
            required: true,
        },
        isNews: {
            type: Boolean,
            required: true,
        },
        score: Number,
        weightedScore: Number,
        pipelineScore: Number,
        scoreBreakdown: {
            type: Map,
            of: Number,
            default: undefined,
        },
        recommendationDetail: String,
        sourceReason: String,
        evidence: {
            type: [String],
            default: undefined,
        },
        explainSignals: {
            type: Map,
            of: Number,
            default: undefined,
        },
        createdAt: Date,
    },
    { _id: false },
);

const FreshnessStatsSchema = new Schema<RecommendationTraceFreshnessStats>(
    {
        newestAgeSeconds: Number,
        oldestAgeSeconds: Number,
        timeRangeSeconds: Number,
    },
    { _id: false },
);

const ShadowComparisonSchema = new Schema<RecommendationTraceShadowComparison>(
    {
        overlapCount: { type: Number, required: true },
        overlapRatio: { type: Number, required: true },
        selectedCount: { type: Number, required: true },
        baselineCount: { type: Number, required: true },
    },
    { _id: false },
);

const ServingMetadataSchema = new Schema<RecommendationTraceServingMetadata>(
    {
        servingVersion: String,
        stableOrderKey: String,
        cursor: String,
        nextCursor: String,
        servedStateVersion: String,
        hasMore: Boolean,
    },
    { _id: false },
);

const ReplayPoolSchema = new Schema<RecommendationTraceReplayPool>(
    {
        poolKind: {
            type: String,
            required: true,
        },
        totalCount: {
            type: Number,
            required: true,
        },
        truncated: {
            type: Boolean,
            required: true,
        },
        candidates: {
            type: [TraceCandidateSchema],
            default: [],
        },
    },
    { _id: false },
);

const RecommendationTraceSchema = new Schema<IRecommendationTrace>(
    {
        requestId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        userId: {
            type: String,
            required: true,
            index: true,
        },
        productSurface: {
            type: String,
            required: true,
            index: true,
        },
        pipeline: {
            type: String,
            index: true,
        },
        pipelineVersion: {
            type: String,
            index: true,
        },
        traceVersion: String,
        owner: {
            type: String,
            index: true,
        },
        fallbackMode: String,
        degradedReasons: {
            type: [String],
            default: [],
        },
        selectedCount: {
            type: Number,
            required: true,
        },
        inNetworkCount: {
            type: Number,
            required: true,
        },
        outOfNetworkCount: {
            type: Number,
            required: true,
        },
        sourceCounts: {
            type: [SourceCountSchema],
            default: [],
        },
        authorDiversity: {
            type: Number,
            required: true,
        },
        replyRatio: {
            type: Number,
            required: true,
        },
        averageScore: {
            type: Number,
            required: true,
        },
        topScore: Number,
        bottomScore: Number,
        freshness: {
            type: FreshnessStatsSchema,
            default: () => ({}),
        },
        candidates: {
            type: [TraceCandidateSchema],
            default: [],
        },
        experimentKeys: {
            type: [String],
            default: [],
            index: true,
        },
        userState: String,
        embeddingQualityScore: Number,
        replayPool: {
            type: ReplayPoolSchema,
            default: undefined,
        },
        shadowComparison: {
            type: ShadowComparisonSchema,
            default: undefined,
        },
        serving: {
            type: ServingMetadataSchema,
            default: undefined,
        },
        createdAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        collection: 'recommendation_traces',
        timestamps: false,
    },
);

RecommendationTraceSchema.index({ userId: 1, createdAt: -1 });
RecommendationTraceSchema.index({ productSurface: 1, createdAt: -1 });
RecommendationTraceSchema.index({ pipeline: 1, createdAt: -1 });
RecommendationTraceSchema.index({ pipelineVersion: 1, createdAt: -1 });
RecommendationTraceSchema.index({ 'sourceCounts.source': 1, createdAt: -1 });

const RecommendationTrace = mongoose.model<IRecommendationTrace, Model<IRecommendationTrace>>(
    'RecommendationTrace',
    RecommendationTraceSchema,
);

export default RecommendationTrace;
