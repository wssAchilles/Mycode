import mongoose from 'mongoose';

import ClusterDefinition from '../../../models/ClusterDefinition';
import Post from '../../../models/Post';
import PostFeatureSnapshot, {
    IPostFeatureSnapshot,
    PostFeatureClusterScore,
} from '../../../models/PostFeatureSnapshot';
import UserFeatureVector, { IUserFeatureVector } from '../../../models/UserFeatureVector';
import type { SparseEmbeddingEntry } from '../types/FeedQuery';
import {
    buildKeywordScores,
    computeEngagementScore,
    mergeClusterScores,
    toEngagementBucket,
    toFreshnessBucket,
} from './featureExtraction';
import { buildDensePostEmbedding } from './denseEmbedding';

type PostFeatureSourcePost = {
    _id: mongoose.Types.ObjectId;
    authorId: string;
    content: string;
    keywords?: string[];
    language?: string;
    createdAt: Date;
    updatedAt?: Date;
    media?: Array<{ type?: string }>;
    stats?: {
        likeCount?: number;
        repostCount?: number;
        quoteCount?: number;
        commentCount?: number;
        viewCount?: number;
    };
    engagementScore?: number;
    isNews?: boolean;
    newsMetadata?: {
        clusterId?: number;
    };
};

export interface PostFeaturePoolEntry {
    post: PostFeatureSourcePost;
    snapshot: IPostFeatureSnapshot;
}

export interface ClusterCandidatePoolOptions {
    clusterEntries: SparseEmbeddingEntry[];
    limit?: number;
    createdAfter?: Date;
    excludePostIds?: mongoose.Types.ObjectId[];
    excludeAuthorIds?: string[];
    newsOnly?: boolean;
    seedRecentLimit?: number;
}

export interface DenseCandidatePoolOptions {
    limit?: number;
    createdAfter?: Date;
    excludePostIds?: mongoose.Types.ObjectId[];
    excludeAuthorIds?: string[];
    newsOnly?: boolean;
    seedRecentLimit?: number;
}

const CONFIG = {
    maxKeywordClustersPerToken: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_CONTENT_FEATURE_MAX_KEYWORD_CLUSTERS || '4'), 10) || 4,
    ),
    maxDominantClusters: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_CONTENT_FEATURE_MAX_DOMINANT_CLUSTERS || '6'), 10) || 6,
    ),
    maxAuthorProducerClusters: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_CONTENT_FEATURE_MAX_AUTHOR_CLUSTERS || '8'), 10) || 8,
    ),
    clusterPoolOverscan: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_CONTENT_FEATURE_CLUSTER_POOL_OVERSCAN || '4'), 10) || 4,
    ),
    recentSeedLookbackDays: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_CONTENT_FEATURE_RECENT_SEED_LOOKBACK_DAYS || '30'), 10) || 30,
    ),
    keywordClusterCacheTtlMs: Math.max(
        60_000,
        parseInt(String(process.env.RECOMMENDATION_CONTENT_FEATURE_CLUSTER_CACHE_TTL_MS || '1800000'), 10) || 1_800_000,
    ),
};

type KeywordClusterCacheEntry = {
    expiresAt: number;
    clusters: PostFeatureClusterScore[];
};

class PostFeatureSnapshotService {
    private readonly keywordClusterCache = new Map<string, KeywordClusterCacheEntry>();

    async getSnapshotsByPostIds(
        postIds: mongoose.Types.ObjectId[],
    ): Promise<Map<string, IPostFeatureSnapshot>> {
        return PostFeatureSnapshot.getByPostIds(uniqueObjectIds(postIds));
    }

    async ensureSnapshotsByPostIds(
        postIds: mongoose.Types.ObjectId[],
    ): Promise<Map<string, IPostFeatureSnapshot>> {
        const uniquePostIds = uniqueObjectIds(postIds);
        if (uniquePostIds.length === 0) return new Map();

        const snapshots = await this.getSnapshotsByPostIds(uniquePostIds);
        const missingIds = uniquePostIds.filter((postId) => !snapshots.has(postId.toString()));
        if (missingIds.length === 0) {
            return snapshots;
        }

        const posts = await Post.find({
            _id: { $in: missingIds },
            deletedAt: null,
        })
            .select(
                '_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId',
            )
            .lean();

        if (posts.length > 0) {
            await this.ensureSnapshotsForPosts(posts as unknown as PostFeatureSourcePost[]);
        }

        return this.getSnapshotsByPostIds(uniquePostIds);
    }

    async ensureSnapshotsForPosts(posts: PostFeatureSourcePost[]): Promise<Map<string, IPostFeatureSnapshot>> {
        const dedupedPosts = dedupePosts(posts);
        if (dedupedPosts.length === 0) return new Map();

        const authorEmbeddings = await UserFeatureVector.getUserEmbeddingsBatch(
            Array.from(new Set(dedupedPosts.map((post) => post.authorId))),
        );

        const writes = [];
        for (const post of dedupedPosts) {
            const snapshot = await this.buildSnapshotDocument(post, authorEmbeddings.get(post.authorId));
            writes.push({
                updateOne: {
                    filter: { postId: post._id },
                    update: { $set: snapshot },
                    upsert: true,
                },
            });
        }

        if (writes.length > 0) {
            await PostFeatureSnapshot.bulkWrite(writes, { ordered: false });
        }

        return this.getSnapshotsByPostIds(dedupedPosts.map((post) => post._id));
    }

    async refreshSnapshotsByPostIds(
        postIds: mongoose.Types.ObjectId[],
    ): Promise<Map<string, IPostFeatureSnapshot>> {
        const uniquePostIds = uniqueObjectIds(postIds);
        if (uniquePostIds.length === 0) return new Map();

        const posts = await Post.find({
            _id: { $in: uniquePostIds },
            deletedAt: null,
        })
            .select(
                '_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId',
            )
            .lean();

        if (posts.length === 0) {
            return new Map();
        }

        return this.ensureSnapshotsForPosts(posts as unknown as PostFeatureSourcePost[]);
    }

    async getClusterCandidatePool(options: ClusterCandidatePoolOptions): Promise<PostFeaturePoolEntry[]> {
        const clusterEntries = normalizeSparseEntries(
            options.clusterEntries,
            CONFIG.maxDominantClusters,
        );
        if (clusterEntries.length === 0) return [];

        const clusterIds = clusterEntries.map((entry) => entry.clusterId);
        const limit = Math.max(1, Math.min(options.limit ?? 160, 500));
        let snapshots = await PostFeatureSnapshot.getByDominantClusters(clusterIds, {
            limit: limit * CONFIG.clusterPoolOverscan,
            createdAfter: options.createdAfter,
            excludePostIds: options.excludePostIds,
            excludeAuthorIds: options.excludeAuthorIds,
            newsOnly: options.newsOnly,
        });

        if (snapshots.length < limit && (options.seedRecentLimit ?? 0) > 0) {
            await this.seedRecentSnapshots({
                limit: options.seedRecentLimit ?? 0,
                createdAfter: options.createdAfter,
                excludeAuthorIds: options.excludeAuthorIds,
                newsOnly: options.newsOnly,
            });

            snapshots = await PostFeatureSnapshot.getByDominantClusters(clusterIds, {
                limit: limit * CONFIG.clusterPoolOverscan,
                createdAfter: options.createdAfter,
                excludePostIds: options.excludePostIds,
                excludeAuthorIds: options.excludeAuthorIds,
                newsOnly: options.newsOnly,
            });
        }

        if (snapshots.length === 0) {
            return [];
        }

        const posts = await Post.find({
            _id: { $in: snapshots.map((snapshot) => snapshot.postId) },
            deletedAt: null,
        })
            .select(
                '_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId',
            )
            .lean();
        const postMap = new Map(posts.map((post: any) => [String(post._id), post as PostFeatureSourcePost]));

        return snapshots
            .map((snapshot) => {
                const post = postMap.get(String(snapshot.postId));
                if (!post) return null;
                return { post, snapshot };
            })
            .filter((entry): entry is PostFeaturePoolEntry => Boolean(entry));
    }

    async getDenseVectorCandidatePool(options: DenseCandidatePoolOptions): Promise<PostFeaturePoolEntry[]> {
        const limit = Math.max(1, Math.min(options.limit ?? 160, 500));
        let snapshots = await PostFeatureSnapshot.getRecentDenseCandidates({
            limit: limit * CONFIG.clusterPoolOverscan,
            createdAfter: options.createdAfter,
            excludePostIds: options.excludePostIds,
            excludeAuthorIds: options.excludeAuthorIds,
            newsOnly: options.newsOnly,
        });

        if (snapshots.length < limit && (options.seedRecentLimit ?? 0) > 0) {
            await this.seedRecentSnapshots({
                limit: options.seedRecentLimit ?? 0,
                createdAfter: options.createdAfter,
                excludeAuthorIds: options.excludeAuthorIds,
                newsOnly: options.newsOnly,
            });

            snapshots = await PostFeatureSnapshot.getRecentDenseCandidates({
                limit: limit * CONFIG.clusterPoolOverscan,
                createdAfter: options.createdAfter,
                excludePostIds: options.excludePostIds,
                excludeAuthorIds: options.excludeAuthorIds,
                newsOnly: options.newsOnly,
            });
        }

        if (snapshots.length === 0) {
            return [];
        }

        const posts = await Post.find({
            _id: { $in: snapshots.map((snapshot) => snapshot.postId) },
            deletedAt: null,
        })
            .select(
                '_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId',
            )
            .lean();
        const postMap = new Map(posts.map((post: any) => [String(post._id), post as PostFeatureSourcePost]));

        return snapshots
            .map((snapshot) => {
                const post = postMap.get(String(snapshot.postId));
                if (!post) return null;
                return { post, snapshot };
            })
            .filter((entry): entry is PostFeaturePoolEntry => Boolean(entry));
    }

    private async seedRecentSnapshots(options: {
        limit: number;
        createdAfter?: Date;
        excludeAuthorIds?: string[];
        newsOnly?: boolean;
    }): Promise<void> {
        const createdAfter = options.createdAfter
            ?? new Date(Date.now() - CONFIG.recentSeedLookbackDays * 24 * 60 * 60 * 1000);
        const mongoQuery: Record<string, unknown> = {
            createdAt: { $gte: createdAfter },
            deletedAt: null,
        };

        if (options.excludeAuthorIds?.length) {
            mongoQuery.authorId = { $nin: options.excludeAuthorIds };
        }
        if (typeof options.newsOnly === 'boolean') {
            mongoQuery.isNews = options.newsOnly;
        }

        const posts = await Post.find(mongoQuery)
            .select(
                '_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId',
            )
            .sort({ engagementScore: -1, createdAt: -1 })
            .limit(Math.max(1, Math.min(options.limit, 500)))
            .lean();

        if (posts.length > 0) {
            await this.ensureSnapshotsForPosts(posts as unknown as PostFeatureSourcePost[]);
        }
    }

    private async buildSnapshotDocument(
        post: PostFeatureSourcePost,
        authorEmbedding: IUserFeatureVector | undefined,
    ): Promise<Record<string, unknown>> {
        const keywordScores = buildKeywordScores({
            content: post.content,
            keywords: post.keywords || [],
        });
        const keywordClusterScores = await this.buildKeywordClusterScores(keywordScores);
        const authorProducerClusters = normalizeSparseEntries(
            authorEmbedding?.producerEmbedding?.length
                ? authorEmbedding.producerEmbedding
                : authorEmbedding?.interestedInClusters,
            CONFIG.maxAuthorProducerClusters,
        );
        const explicitClusters = typeof post.newsMetadata?.clusterId === 'number'
            ? [{ clusterId: post.newsMetadata.clusterId, score: 1.1 }]
            : [];
        const authorPriorClusters = authorProducerClusters.map((entry) => ({
            clusterId: entry.clusterId,
            score: entry.score * 0.35,
        }));
        const clusterScores = mergeClusterScores(
            [explicitClusters, keywordClusterScores, authorPriorClusters],
            CONFIG.maxDominantClusters,
        );
        const dominantClusterIds = clusterScores
            .slice(0, Math.min(clusterScores.length, 4))
            .map((entry) => entry.clusterId);

        const engagementScore = computeEngagementScore(post.stats, post.engagementScore);
        const mediaTypes = Array.from(
            new Set(
                (post.media || [])
                    .map((media) => String(media?.type || '').trim().toLowerCase())
                    .filter(Boolean),
            ),
        );
        const qualityScore = clamp01(
            engagementScore * 0.35 +
            Math.min(keywordScores.length / 6, 1) * 0.2 +
            Math.min(clusterScores.length / 4, 1) * 0.2 +
            (authorProducerClusters.length > 0 ? 0.15 : 0) +
            (mediaTypes.length > 0 ? 0.1 : 0),
        );
        const engagementBucket = toEngagementBucket(engagementScore);
        const freshnessBucket = toFreshnessBucket(new Date(post.createdAt));
        const denseEmbedding = buildDensePostEmbedding({
            keywordScores,
            clusterScores,
            authorProducerClusters,
            authorKnownForCluster: authorEmbedding?.knownForCluster,
            engagementBucket,
            freshnessBucket,
            hasMedia: mediaTypes.length > 0,
            mediaTypes,
            language: post.language,
        });

        return {
            postId: post._id,
            authorId: post.authorId,
            postCreatedAt: post.createdAt,
            isNews: post.isNews === true,
            language: post.language,
            keywords: keywordScores.map((entry) => entry.keyword),
            keywordScores,
            dominantClusterIds,
            clusterScores,
            authorKnownForCluster: authorEmbedding?.knownForCluster,
            authorProducerClusters,
            denseEmbedding,
            engagementBucket,
            freshnessBucket,
            hasMedia: mediaTypes.length > 0,
            mediaTypes,
            qualityScore,
            snapshotVersion: 2,
            computedAt: new Date(),
        };
    }

    private async buildKeywordClusterScores(
        keywordScores: Array<{ keyword: string; weight: number }>,
    ): Promise<PostFeatureClusterScore[]> {
        const parts: PostFeatureClusterScore[][] = [];

        for (const keywordScore of keywordScores.slice(0, 6)) {
            const keyword = String(keywordScore.keyword || '').trim().toLowerCase();
            if (!keyword || keyword.length < 2) continue;
            const clusters = await this.searchClustersForKeyword(keyword);
            if (clusters.length === 0) continue;
            parts.push(
                clusters.map((cluster, index) => ({
                    clusterId: cluster.clusterId,
                    score: keywordScore.weight * Math.max(0.25, 1 - index * 0.18) * cluster.score,
                })),
            );
        }

        return mergeClusterScores(parts, CONFIG.maxDominantClusters);
    }

    private async searchClustersForKeyword(keyword: string): Promise<PostFeatureClusterScore[]> {
        const cached = this.keywordClusterCache.get(keyword);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.clusters;
        }

        const clusters = await ClusterDefinition.searchClusters(
            keyword,
            CONFIG.maxKeywordClustersPerToken,
        );
        const normalized = clusters.map((cluster: any, index: number) => ({
            clusterId: cluster.clusterId,
            score: Math.max(0.25, 1 - index * 0.18),
        }));

        this.keywordClusterCache.set(keyword, {
            expiresAt: Date.now() + CONFIG.keywordClusterCacheTtlMs,
            clusters: normalized,
        });

        return normalized;
    }
}

function uniqueObjectIds(ids: mongoose.Types.ObjectId[]): mongoose.Types.ObjectId[] {
    const seen = new Set<string>();
    const result: mongoose.Types.ObjectId[] = [];
    for (const id of ids) {
        const key = String(id);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(id);
    }
    return result;
}

function dedupePosts(posts: PostFeatureSourcePost[]): PostFeatureSourcePost[] {
    const seen = new Set<string>();
    const result: PostFeatureSourcePost[] = [];
    for (const post of posts) {
        const id = String(post?._id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(post);
    }
    return result;
}

function normalizeSparseEntries(
    entries: Array<{ clusterId: number; score: number }> | undefined,
    limit: number,
): PostFeatureClusterScore[] {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    return entries
        .filter(
            (entry) =>
                typeof entry?.clusterId === 'number' &&
                Number.isFinite(entry.clusterId) &&
                typeof entry?.score === 'number' &&
                Number.isFinite(entry.score) &&
                entry.score > 0,
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((entry) => ({
            clusterId: entry.clusterId,
            score: entry.score,
        }));
}

function clamp01(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export const postFeatureSnapshotService = new PostFeatureSnapshotService();
