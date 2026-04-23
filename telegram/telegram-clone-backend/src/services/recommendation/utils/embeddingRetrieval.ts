import { FeatureStore } from '../featureStore';
import {
    buildDensePostEmbedding,
    buildDenseUserEmbedding,
    cosineDenseEmbedding,
} from '../contentFeatures';
import type { FeedCandidate } from '../types/FeedCandidate';
import type { FeedQuery, SparseEmbeddingEntry } from '../types/FeedQuery';

const CONFIG = {
    topUserClusters: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_TOP_CLUSTERS || '8'), 10) || 8,
    ),
    maxAuthorClusters: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_MAX_AUTHOR_CLUSTERS || '8'), 10) || 8,
    ),
};

export interface PreparedEmbeddingRetrievalContext {
    qualityScore: number;
    userClusters: SparseEmbeddingEntry[];
    userClusterMap: Map<number, number>;
    keywordWeights: Map<string, number>;
    denseUserEmbedding: number[];
}

export interface AuthorEmbeddingSnapshot {
    interestedInClusters: SparseEmbeddingEntry[];
    producerEmbedding: SparseEmbeddingEntry[];
    knownForCluster?: number;
}

export type EmbeddingRetrievalHealth = 'strong' | 'weak' | 'missing';

export interface EmbeddingRecallSignals {
    authorScore: number;
    clusterScore: number;
    keywordScore: number;
    denseVectorScore: number;
}

export interface CandidateEmbeddingFeatureSnapshot {
    dominantClusterIds?: number[];
    clusterScores?: Array<{ clusterId: number; score: number }>;
    keywordScores?: Array<{ keyword: string; weight: number }>;
    authorProducerClusters?: Array<{ clusterId: number; score: number }>;
    authorKnownForCluster?: number;
    denseEmbedding?: number[];
}

export interface EmbeddingHealthInput {
    usable?: boolean;
    qualityScore?: number;
    stale?: boolean;
    interestedInClusters?: Array<{ clusterId: number; score: number }>;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export function normalizeSparseEntries(
    entries: Array<{ clusterId: number; score: number }> | undefined,
    limit: number,
): SparseEmbeddingEntry[] {
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
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => ({
            clusterId: entry.clusterId,
            score: entry.score,
        }));
}

function sparseDotProduct(
    left: Map<number, number>,
    right: SparseEmbeddingEntry[],
): number {
    let dot = 0;
    for (const entry of right) {
        dot += (left.get(entry.clusterId) || 0) * entry.score;
    }
    return clamp01(dot);
}

function tokenize(value?: string | null): string[] {
    if (!value) return [];
    return String(value)
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter(Boolean);
}

function normalizeKeywordWeight(score: number | undefined): number {
    if (!Number.isFinite(score) || (score || 0) <= 0) return 0;
    return Math.min(1, Math.max(0, Number(score)));
}

function buildCandidateClusterIds(
    candidate: FeedCandidate,
    authorEmbedding?: AuthorEmbeddingSnapshot,
): number[] {
    const ids = new Set<number>();
    if (typeof candidate.newsMetadata?.clusterId === 'number') {
        ids.add(candidate.newsMetadata.clusterId);
    }
    if (typeof authorEmbedding?.knownForCluster === 'number') {
        ids.add(authorEmbedding.knownForCluster);
    }
    for (const entry of authorEmbedding?.producerEmbedding || []) {
        ids.add(entry.clusterId);
    }
    for (const entry of authorEmbedding?.interestedInClusters || []) {
        ids.add(entry.clusterId);
    }
    return Array.from(ids);
}

export function hasUsableEmbeddingContext(query: FeedQuery): boolean {
    return Boolean(
        query.embeddingContext?.usable &&
        Array.isArray(query.embeddingContext.interestedInClusters) &&
        query.embeddingContext.interestedInClusters.length > 0,
    );
}

export function getEmbeddingRetrievalHealthFromInput(
    input: EmbeddingHealthInput | undefined,
): EmbeddingRetrievalHealth {
    if (!input?.usable || !Array.isArray(input.interestedInClusters) || input.interestedInClusters.length === 0) {
        return 'missing';
    }

    const qualityScore = Number(input.qualityScore || 0);
    if (input.stale === true || qualityScore < 0.45) {
        return 'weak';
    }

    return 'strong';
}

export function getEmbeddingRetrievalHealth(query: FeedQuery): EmbeddingRetrievalHealth {
    if (query.userStateContext?.usableEmbedding === false) {
        return 'missing';
    }
    return getEmbeddingRetrievalHealthFromInput(query.embeddingContext);
}

export function shouldUseEmbeddingAuthorRecall(query: FeedQuery): boolean {
    return getEmbeddingRetrievalHealth(query) === 'strong';
}

export async function prepareEmbeddingRetrievalContextFromInput(
    input: EmbeddingHealthInput | undefined,
): Promise<PreparedEmbeddingRetrievalContext | null> {
    if (!input?.usable) {
        return null;
    }

    const userClusters = normalizeSparseEntries(input.interestedInClusters, CONFIG.topUserClusters);
    if (userClusters.length === 0) {
        return null;
    }

    const userClusterMap = new Map<number, number>();
    for (const entry of userClusters) {
        userClusterMap.set(entry.clusterId, entry.score);
    }

    const clusterDefs = await FeatureStore.getClustersBatch(userClusters.map((entry) => entry.clusterId));
    const keywordWeights = new Map<string, number>();
    for (const entry of userClusters) {
        const cluster = clusterDefs.get(entry.clusterId);
        if (!cluster) continue;
        const tokens = [
            ...tokenize(cluster.name),
            ...tokenize(cluster.description),
            ...(cluster.tags || []).flatMap((tag) => tokenize(tag)),
        ];
        for (const token of tokens) {
            const current = keywordWeights.get(token) || 0;
            keywordWeights.set(token, current + entry.score);
        }
    }

    return {
        qualityScore: Number(input.qualityScore || 0),
        userClusters,
        userClusterMap,
        keywordWeights,
        denseUserEmbedding: buildDenseUserEmbedding({
            clusters: userClusters,
            keywordWeights,
            qualityScore: Number(input.qualityScore || 0),
        }),
    };
}

export async function prepareEmbeddingRetrievalContext(
    query: FeedQuery,
): Promise<PreparedEmbeddingRetrievalContext | null> {
    if (!hasUsableEmbeddingContext(query) || !query.embeddingContext) {
        return null;
    }
    return prepareEmbeddingRetrievalContextFromInput(query.embeddingContext);
}

export async function loadAuthorEmbeddingSnapshots(
    authorIds: string[],
): Promise<Map<string, AuthorEmbeddingSnapshot>> {
    if (authorIds.length === 0) return new Map();
    const embeddings = await FeatureStore.getUserEmbeddingsBatch(Array.from(new Set(authorIds)));
    const snapshots = new Map<string, AuthorEmbeddingSnapshot>();

    for (const [authorId, embedding] of embeddings.entries()) {
        snapshots.set(authorId, {
            interestedInClusters: normalizeSparseEntries(
                embedding.interestedInClusters,
                CONFIG.maxAuthorClusters,
            ),
            producerEmbedding: normalizeSparseEntries(
                embedding.producerEmbedding,
                CONFIG.maxAuthorClusters,
            ),
            knownForCluster: embedding.knownForCluster,
        });
    }

    return snapshots;
}

export function computeEmbeddingRecallSignals(
    candidate: FeedCandidate,
    candidateKeywords: string[] | undefined,
    context: PreparedEmbeddingRetrievalContext,
    authorEmbedding?: AuthorEmbeddingSnapshot,
): EmbeddingRecallSignals {
    const authorVector =
        authorEmbedding?.producerEmbedding.length
            ? authorEmbedding.producerEmbedding
            : (authorEmbedding?.interestedInClusters || []);

    const authorScore = sparseDotProduct(context.userClusterMap, authorVector);
    const candidateClusterIds = buildCandidateClusterIds(candidate, authorEmbedding);
    const clusterScore = clamp01(
        candidateClusterIds.reduce(
            (sum, clusterId) => sum + (context.userClusterMap.get(clusterId) || 0),
            0,
        ),
    );

    const normalizedKeywords = Array.from(
        new Set((candidateKeywords || []).flatMap((keyword) => tokenize(keyword))),
    );
    const matchedKeywordWeight = normalizedKeywords.reduce(
        (sum, keyword) => sum + (context.keywordWeights.get(keyword) || 0),
        0,
    );
    const keywordScore = normalizedKeywords.length
        ? clamp01(matchedKeywordWeight / normalizedKeywords.length)
        : 0;
    const candidateDenseEmbedding = buildDensePostEmbedding({
        keywordScores: normalizedKeywords.map((keyword) => ({
            keyword,
            weight: 1 / Math.max(normalizedKeywords.length, 1),
        })),
        clusterScores: candidateClusterIds.map((clusterId) => ({
            clusterId,
            score: context.userClusterMap.get(clusterId) || 1,
        })),
        authorProducerClusters: authorVector,
        authorKnownForCluster: authorEmbedding?.knownForCluster,
        engagementBucket: inferEngagementBucket(candidate),
        freshnessBucket: inferFreshnessBucket(candidate.createdAt),
        hasMedia: candidate.hasImage || candidate.hasVideo,
        mediaTypes: candidate.media?.map((item) => item.type) || [],
    });
    const denseVectorScore = cosineDenseEmbedding(
        context.denseUserEmbedding,
        candidateDenseEmbedding,
    );

    return {
        authorScore,
        clusterScore,
        keywordScore,
        denseVectorScore,
    };
}

export function computeAuthorEmbeddingOverlap(
    context: PreparedEmbeddingRetrievalContext,
    authorEmbedding?: AuthorEmbeddingSnapshot,
): number {
    if (!authorEmbedding) {
        return 0;
    }

    const producerOverlap = sparseDotProduct(
        context.userClusterMap,
        authorEmbedding.producerEmbedding || [],
    );
    const interestOverlap = sparseDotProduct(
        context.userClusterMap,
        authorEmbedding.interestedInClusters || [],
    );
    const knownForOverlap = typeof authorEmbedding.knownForCluster === 'number'
        ? (context.userClusterMap.get(authorEmbedding.knownForCluster) || 0) * 0.35
        : 0;

    return clamp01(
        producerOverlap * 0.68 +
        interestOverlap * 0.32 +
        knownForOverlap,
    );
}

export function computeEmbeddingRecallSignalsFromSnapshot(
    snapshot: CandidateEmbeddingFeatureSnapshot | undefined,
    context: PreparedEmbeddingRetrievalContext,
    authorEmbedding?: AuthorEmbeddingSnapshot,
): EmbeddingRecallSignals {
    const candidateClusterEntries = snapshot?.clusterScores?.length
        ? snapshot.clusterScores
        : (snapshot?.dominantClusterIds || []).map((clusterId) => ({ clusterId, score: 1 }));
    const clusterScore = clamp01(
        candidateClusterEntries.reduce(
            (sum, entry) => sum + (context.userClusterMap.get(entry.clusterId) || 0) * entry.score,
            0,
        ),
    );

    const authorVector = snapshot?.authorProducerClusters?.length
        ? snapshot.authorProducerClusters
        : authorEmbedding?.producerEmbedding?.length
            ? authorEmbedding.producerEmbedding
            : (authorEmbedding?.interestedInClusters || []);
    const authorScore = clamp01(
        sparseDotProduct(context.userClusterMap, authorVector) +
        (typeof snapshot?.authorKnownForCluster === 'number'
            ? (context.userClusterMap.get(snapshot.authorKnownForCluster) || 0) * 0.35
            : 0),
    );

    const keywordEntries = snapshot?.keywordScores || [];
    const weightedKeywordTotal = keywordEntries.reduce(
        (sum, entry) => sum + normalizeKeywordWeight(entry.weight),
        0,
    ) || 1;
    const matchedKeywordWeight = keywordEntries.reduce(
        (sum, entry) =>
            sum +
            (context.keywordWeights.get(String(entry.keyword || '').toLowerCase()) || 0) *
                normalizeKeywordWeight(entry.weight),
        0,
    );
    const keywordScore = keywordEntries.length
        ? clamp01(matchedKeywordWeight / weightedKeywordTotal)
        : 0;
    const denseVectorScore = cosineDenseEmbedding(
        context.denseUserEmbedding,
        snapshot?.denseEmbedding,
    );

    return {
        authorScore,
        clusterScore,
        keywordScore,
        denseVectorScore,
    };
}

function inferEngagementBucket(candidate: FeedCandidate): 'low' | 'medium' | 'high' | 'viral' {
    const engagements =
        (candidate.likeCount || 0) +
        (candidate.commentCount || 0) * 2 +
        (candidate.repostCount || 0) * 3;
    if (engagements >= 60) return 'viral';
    if (engagements >= 20) return 'high';
    if (engagements >= 5) return 'medium';
    return 'low';
}

function inferFreshnessBucket(createdAt: Date): 'hours_24' | 'days_7' | 'days_30' | 'days_90' | 'stale' {
    const ageHours = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
    if (ageHours <= 24) return 'hours_24';
    if (ageHours <= 24 * 7) return 'days_7';
    if (ageHours <= 24 * 30) return 'days_30';
    if (ageHours <= 24 * 90) return 'days_90';
    return 'stale';
}
