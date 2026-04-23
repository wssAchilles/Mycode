import type { FeedQuery, UserStateKind } from '../types/FeedQuery';

type SourcePolicy = {
    enabledSources: Set<string>;
    multipliers: Record<string, number>;
};

const POLICIES: Record<UserStateKind, SourcePolicy> = {
    cold_start: {
        enabledSources: new Set([
            'ColdStartSource',
        ]),
        multipliers: {
            FollowingSource: 1.01,
            ColdStartSource: 1.05,
            PopularSource: 0.92,
            GraphSource: 0.88,
            TwoTowerSource: 0.9,
            EmbeddingAuthorSource: 0.88,
        },
    },
    sparse: {
        enabledSources: new Set([
            'FollowingSource',
            'PopularSource',
            'TwoTowerSource',
            'EmbeddingAuthorSource',
        ]),
        multipliers: {
            FollowingSource: 1.02,
            ColdStartSource: 0.96,
            PopularSource: 1.02,
            GraphSource: 0.95,
            TwoTowerSource: 1.04,
            EmbeddingAuthorSource: 0.99,
        },
    },
    warm: {
        enabledSources: new Set([
            'FollowingSource',
            'PopularSource',
            'GraphSource',
            'TwoTowerSource',
            'EmbeddingAuthorSource',
        ]),
        multipliers: {
            FollowingSource: 1.03,
            ColdStartSource: 0.95,
            PopularSource: 0.98,
            GraphSource: 1.02,
            TwoTowerSource: 1.01,
            EmbeddingAuthorSource: 1.02,
        },
    },
    heavy: {
        enabledSources: new Set([
            'FollowingSource',
            'PopularSource',
            'GraphSource',
            'TwoTowerSource',
            'EmbeddingAuthorSource',
        ]),
        multipliers: {
            FollowingSource: 1.03,
            ColdStartSource: 0.92,
            PopularSource: 0.96,
            GraphSource: 1.04,
            TwoTowerSource: 1.03,
            EmbeddingAuthorSource: 1.05,
        },
    },
};

function getPolicy(query: FeedQuery): SourcePolicy | null {
    const state = query.userStateContext?.state;
    if (!state) {
        return null;
    }
    return POLICIES[state];
}

export function isSourceEnabledForQuery(query: FeedQuery, sourceName: string): boolean {
    const policy = getPolicy(query);
    if (!policy) {
        return true;
    }
    return policy.enabledSources.has(sourceName);
}

export function getSourceMixingMultiplier(query: FeedQuery, sourceName: string): number {
    const policy = getPolicy(query);
    if (!policy) {
        return 1;
    }
    return policy.multipliers[sourceName] ?? 1;
}
