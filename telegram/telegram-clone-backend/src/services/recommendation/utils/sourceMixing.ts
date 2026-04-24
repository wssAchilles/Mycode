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
        case 'GraphKernelSource':
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

function sparseGraphExpansionEnabled(query: FeedQuery): boolean {
    const state = userState(query);
    if (state !== 'sparse') {
        return false;
    }
    const followedCount = query.userStateContext?.followedCount || 0;
    const recentPositiveActionCount = query.userStateContext?.recentPositiveActionCount || 0;
    return followedCount >= 3 || recentPositiveActionCount >= 4;
}

function socialMomentumBoost(query: FeedQuery): number {
    const recentPositiveActionCount = query.userStateContext?.recentPositiveActionCount || 0;
    if (recentPositiveActionCount >= 24) return 0.06;
    if (recentPositiveActionCount >= 12) return 0.03;
    if (recentPositiveActionCount >= 6) return 0.015;
    return 0;
}

function popularFallbackStillNeeded(query: FeedQuery): boolean {
    const state = userState(query);
    if (state !== 'heavy') {
        return true;
    }

    const followedCount = query.userStateContext?.followedCount || 0;
    const recentPositiveActionCount = query.userStateContext?.recentPositiveActionCount || 0;
    return followedCount < 12 || recentPositiveActionCount < 12;
}

function laneMultiplier(query: FeedQuery, lane: RetrievalLane): number {
    const state = userState(query);
    const embeddingHealth = getEmbeddingRetrievalHealth(query);
    const graphEnabledForSparse = sparseGraphExpansionEnabled(query);
    const socialMomentum = socialMomentumBoost(query);

    switch (state) {
        case 'cold_start':
            return lane === 'fallback' ? 1.02 : 0;
        case 'sparse':
            if (lane === 'in_network') return 1.015;
            if (lane === 'social_expansion') return graphEnabledForSparse ? 1.02 + socialMomentum : 0;
            if (lane === 'interest') {
                if (embeddingHealth === 'strong') return graphEnabledForSparse ? 1.045 : 1.055;
                if (embeddingHealth === 'weak') return 1.0;
                return 0.95;
            }
            if (embeddingHealth === 'strong') return graphEnabledForSparse ? 0.94 : 0.97;
            if (embeddingHealth === 'weak') return graphEnabledForSparse ? 0.99 : 1.0;
            return graphEnabledForSparse ? 1.02 : 1.04;
        case 'warm':
            if (lane === 'in_network') return 1.03;
            if (lane === 'social_expansion') return 1.02 + socialMomentum;
            if (lane === 'interest') return embeddingHealth === 'strong' ? 1.01 : 0.96;
            return embeddingHealth === 'strong' ? 0.97 : 1.01;
        case 'heavy':
            if (lane === 'in_network') return 1.06;
            if (lane === 'social_expansion') return 1.04 + socialMomentum;
            if (lane === 'interest') {
                if (embeddingHealth === 'strong') return 1.01;
                if (embeddingHealth === 'weak') return 0.94;
                return 0.9;
            }
            if (embeddingHealth === 'strong') return 0.92;
            if (embeddingHealth === 'weak') return 0.98;
            return 1.03;
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
            if (sourceName === 'ColdStartSource') return false;
            if (sourceName === 'GraphSource' || sourceName === 'GraphKernelSource') {
                return sparseGraphExpansionEnabled(query);
            }
            if (sourceName === 'EmbeddingAuthorSource') return embeddingHealth === 'strong';
            return true;
        case 'warm':
        case 'heavy':
            if (sourceName === 'ColdStartSource') return false;
            if (sourceName === 'PopularSource') return popularFallbackStillNeeded(query);
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
