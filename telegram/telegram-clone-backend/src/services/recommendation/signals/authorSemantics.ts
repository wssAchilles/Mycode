import ClusterDefinition from '../../../models/ClusterDefinition';
import { ActionType } from '../../../models/UserAction';
import type { SparseEmbeddingEntry } from '../types/FeedQuery';

export interface AuthorSignalAction {
    action?: ActionType | string;
    targetAuthorId?: string;
    dwellTimeMs?: number;
    timestamp?: Date | string;
}

export interface AuthorRecommendationReasonInput {
    inNetwork?: boolean;
    graphProximity?: number;
    embeddingAffinity?: number;
    clusterProducerPrior?: number;
    authorAffinity?: number;
    recentPosts?: number;
    engagementScore?: number;
}

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export function authorInteractionWeight(
    action: ActionType | string,
    dwellTimeMs?: number,
): number {
    switch (action) {
        case ActionType.REPLY:
            return 3.2;
        case ActionType.REPOST:
        case ActionType.QUOTE:
            return 2.8;
        case ActionType.LIKE:
            return 2.4;
        case ActionType.PROFILE_CLICK:
            return 1.9;
        case ActionType.CLICK:
            return 1.25;
        case ActionType.DWELL:
            return 1 + Math.min((dwellTimeMs || 0) / 10_000, 1);
        default:
            return 0;
    }
}

export function buildNormalizedAuthorSignalMap(
    actions: AuthorSignalAction[],
    options?: { applyRecency?: boolean; now?: number },
): Map<string, number> {
    const scores = new Map<string, number>();
    const now = options?.now ?? Date.now();
    let maxScore = 0;

    for (const action of actions) {
        const authorId = String(action.targetAuthorId || '').trim();
        if (!authorId) continue;

        let weight = authorInteractionWeight(String(action.action || ''), action.dwellTimeMs);
        if (weight <= 0) continue;

        if (options?.applyRecency !== false && action.timestamp) {
            const ageDays = Math.max(
                0,
                (now - new Date(action.timestamp).getTime()) / (24 * 60 * 60 * 1000),
            );
            const recencyMultiplier = ageDays <= 7 ? 1 : ageDays <= 14 ? 0.82 : 0.65;
            weight *= recencyMultiplier;
        }

        const nextScore = (scores.get(authorId) || 0) + weight;
        scores.set(authorId, nextScore);
        maxScore = Math.max(maxScore, nextScore);
    }

    if (maxScore <= 0) {
        return new Map();
    }

    for (const [authorId, score] of scores.entries()) {
        scores.set(authorId, clamp01(score / maxScore));
    }

    return scores;
}

export async function buildClusterProducerPriorMap(
    userClusters: SparseEmbeddingEntry[],
    options?: {
        excludedAuthorIds?: Iterable<string>;
        candidateIds?: Iterable<string>;
        maxProducersPerCluster?: number;
    },
): Promise<Map<string, number>> {
    const normalizedClusters = (userClusters || [])
        .filter((entry) => Number.isFinite(entry.clusterId) && Number.isFinite(entry.score))
        .sort((left, right) => right.score - left.score);
    if (normalizedClusters.length === 0) {
        return new Map();
    }

    const excludedAuthorIds = new Set(options?.excludedAuthorIds || []);
    const candidateIds = options?.candidateIds ? new Set(options.candidateIds) : null;
    const maxProducersPerCluster = Math.max(1, options?.maxProducersPerCluster || 12);
    const clusterIds = normalizedClusters.map((cluster) => cluster.clusterId);
    const clusterDefs = await ClusterDefinition.getClustersBatch(clusterIds);
    const priorMap = new Map<string, number>();

    for (const clusterEntry of normalizedClusters) {
        const cluster = clusterDefs.get(clusterEntry.clusterId);
        if (!cluster) continue;

        for (const producer of (cluster.topProducers || []).slice(0, maxProducersPerCluster)) {
            if (!producer?.userId || excludedAuthorIds.has(producer.userId)) {
                continue;
            }
            if (candidateIds && !candidateIds.has(producer.userId)) {
                continue;
            }
            const rankDecay = Math.max(0.2, 1 - producer.rank * 0.06);
            const score = clamp01(clusterEntry.score * producer.score * rankDecay);
            priorMap.set(producer.userId, Math.max(priorMap.get(producer.userId) || 0, score));
        }
    }

    return priorMap;
}

export function buildAuthorRecommendationReason(
    input: AuthorRecommendationReasonInput,
): string {
    if ((input.inNetwork ?? false) || (input.authorAffinity || 0) >= 0.24) {
        return '熟悉作者';
    }
    if ((input.embeddingAffinity || 0) >= 0.24 && (input.graphProximity || 0) >= 0.2) {
        return '兴趣相近 · 社交桥接';
    }
    if ((input.embeddingAffinity || 0) >= 0.22 || (input.clusterProducerPrior || 0) >= 0.18) {
        return '兴趣相近作者';
    }
    if ((input.graphProximity || 0) >= 0.2) {
        return '社交桥接作者';
    }
    if ((input.recentPosts || 0) >= 2 || (input.engagementScore || 0) >= 12) {
        return '近期活跃作者';
    }
    return '新加入作者';
}
