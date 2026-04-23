import { describe, expect, it } from 'vitest';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import {
    getSourceMixingMultiplier,
    isSourceEnabledForQuery,
} from '../../src/services/recommendation/utils/sourceMixing';

describe('source mixing policy', () => {
    it('restricts cold start traffic to the dedicated cold-start lane', () => {
        const query = createFeedQuery('viewer-cold', 20);
        query.userStateContext = {
            state: 'cold_start',
            reason: 'bootstrap',
            followedCount: 0,
            recentActionCount: 0,
            recentPositiveActionCount: 0,
            usableEmbedding: false,
        };

        expect(isSourceEnabledForQuery(query, 'ColdStartSource')).toBe(true);
        expect(isSourceEnabledForQuery(query, 'PopularSource')).toBe(false);
        expect(isSourceEnabledForQuery(query, 'TwoTowerSource')).toBe(false);
        expect(isSourceEnabledForQuery(query, 'GraphSource')).toBe(false);
    });

    it('biases heavy users toward graph and embedding-first sources', () => {
        const query = createFeedQuery('viewer-heavy', 20);
        query.userStateContext = {
            state: 'heavy',
            reason: 'dense_recent_activity',
            followedCount: 16,
            recentActionCount: 42,
            recentPositiveActionCount: 28,
            usableEmbedding: true,
        };

        expect(isSourceEnabledForQuery(query, 'GraphSource')).toBe(true);
        expect(isSourceEnabledForQuery(query, 'EmbeddingAuthorSource')).toBe(true);
        expect(getSourceMixingMultiplier(query, 'GraphSource')).toBeGreaterThan(
            getSourceMixingMultiplier(query, 'PopularSource'),
        );
        expect(getSourceMixingMultiplier(query, 'EmbeddingAuthorSource')).toBeGreaterThan(1);
    });
});
