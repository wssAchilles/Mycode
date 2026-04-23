import type { FeedQuery, UserStateKind } from '../types/FeedQuery';
import { getEmbeddingRetrievalHealth } from './embeddingRetrieval';

type RetrievalLane =
    | 'in_network'
    | 'social_expansion'
    | 'interest'
    | 'fallback';

function sourceLane(sourceName: string): RetrievalLane {
    switch (sourceName) {
        case 'FollowingSource':
            return 'in_network';
        case 'GraphSource':
            return 'social_expansion';
        case 'TwoTowerSource':
        case 'EmbeddingAuthorSource':
        case 'NewsAnnSource':
            return 'interest';
        default:
            return 'fallback';
    }
}

function userState(query: FeedQuery): UserStateKind | undefined {
    return query.userStateContext?.state;
}

function laneMultiplier(query: FeedQuery, lane: RetrievalLane): number {
    const state = userState(query);
    const embeddingHealth = getEmbeddingRetrievalHealth(query);

    switch (state) {
        case 'cold_start':
            return lane === 'fallback' ? 1.01 : 0;
        case 'sparse':
            if (lane === 'in_network') return 1.01;
            if (lane === 'social_expansion') return 0;
            if (lane === 'interest') return embeddingHealth === 'strong' ? 1.04 : 0.97;
            return embeddingHealth === 'strong' ? 0.99 : 1.02;
        case 'warm':
            if (lane === 'in_network') return 1.03;
            if (lane === 'social_expansion') return 1.02;
            if (lane === 'interest') return embeddingHealth === 'strong' ? 1.01 : 0.96;
            return embeddingHealth === 'strong' ? 0.97 : 1.01;
        case 'heavy':
            if (lane === 'in_network') return 1.04;
            if (lane === 'social_expansion') return 1.03;
            if (lane === 'interest') return embeddingHealth === 'strong' ? 1.02 : 0.95;
            return embeddingHealth === 'strong' ? 0.95 : 1.02;
        default:
            return lane === 'fallback' ? 1 : 1;
    }
}

function sourceAdjustment(sourceName: string): number {
    switch (sourceName) {
        case 'TwoTowerSource':
            return 1.03;
        case 'EmbeddingAuthorSource':
            return 1.01;
        case 'NewsAnnSource':
            return 0.97;
        case 'ColdStartSource':
            return 1.02;
        default:
            return 1;
    }
}

export function isSourceEnabledForQuery(query: FeedQuery, sourceName: string): boolean {
    if (query.inNetworkOnly) {
        return sourceName === 'FollowingSource';
    }

    const state = userState(query);
    const embeddingHealth = getEmbeddingRetrievalHealth(query);

    switch (state) {
        case 'cold_start':
            return sourceName === 'ColdStartSource';
        case 'sparse':
            if (sourceName === 'GraphSource' || sourceName === 'ColdStartSource') return false;
            if (sourceName === 'EmbeddingAuthorSource') return embeddingHealth === 'strong';
            return true;
        case 'warm':
        case 'heavy':
            if (sourceName === 'ColdStartSource') return false;
            if (sourceName === 'EmbeddingAuthorSource') return embeddingHealth === 'strong';
            return true;
        default:
            return true;
    }
}

export function getSourceMixingMultiplier(query: FeedQuery, sourceName: string): number {
    if (!isSourceEnabledForQuery(query, sourceName)) {
        return 0;
    }

    return laneMultiplier(query, sourceLane(sourceName)) * sourceAdjustment(sourceName);
}
