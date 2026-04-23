import { describe, expect, it } from 'vitest';

import {
    buildExcludedAuthorIds,
    deriveViewerSuggestionProfile,
    upsertAuthorSuggestionCandidate,
} from '../../src/services/recommendation/authorSuggestions/candidatePools';
import { rankAuthorSuggestionCandidates } from '../../src/services/recommendation/authorSuggestions/scoring';
import type { AuthorSuggestionCandidate } from '../../src/services/recommendation/authorSuggestions/types';

function candidate(overrides: Partial<AuthorSuggestionCandidate>): AuthorSuggestionCandidate {
    return {
        userId: 'author-1',
        sources: ['active'],
        sourceScores: { active: 0.6 },
        recentPosts: 3,
        engagementScore: 24,
        graphProximity: 0,
        embeddingAffinity: 0,
        clusterProducerPrior: 0,
        qualityScore: 0.7,
        recentActivityPrior: 0,
        engagementPrior: 0,
        noveltyBonus: 0,
        lowQualityDamping: 1,
        score: 0,
        ...overrides,
    };
}

describe('author suggestion candidate pools', () => {
    it('builds exclusion sets across self, followed, blocked, and muted users', () => {
        const excluded = buildExcludedAuthorIds(
            'viewer-1',
            ['followed-1'],
            ['blocked-1'],
            ['muted-1'],
        );

        expect(excluded.has('viewer-1')).toBe(true);
        expect(excluded.has('followed-1')).toBe(true);
        expect(excluded.has('blocked-1')).toBe(true);
        expect(excluded.has('muted-1')).toBe(true);
    });

    it('merges multi-source author candidates without losing the strongest signal', () => {
        const candidates = new Map<string, AuthorSuggestionCandidate>();

        upsertAuthorSuggestionCandidate(candidates, 'author-bridge', 'active', {
            sourceScore: 0.52,
            recentPosts: 2,
            engagementScore: 16,
        });
        upsertAuthorSuggestionCandidate(candidates, 'author-bridge', 'graph', {
            sourceScore: 0.74,
            graphProximity: 0.74,
        });
        upsertAuthorSuggestionCandidate(candidates, 'author-bridge', 'embedding', {
            sourceScore: 0.61,
            embeddingAffinity: 0.61,
        });

        const merged = candidates.get('author-bridge');
        expect(merged?.sources).toEqual(['active', 'graph', 'embedding']);
        expect(merged?.sourceScores.graph).toBeCloseTo(0.74);
        expect(merged?.recentPosts).toBe(2);
        expect(merged?.engagementScore).toBe(16);
        expect(merged?.graphProximity).toBeCloseTo(0.74);
        expect(merged?.embeddingAffinity).toBeCloseTo(0.61);
    });
});

describe('author suggestion scoring', () => {
    it('derives cold-start, sparse, and engaged viewer profiles', () => {
        expect(deriveViewerSuggestionProfile(0, 1, false).state).toBe('cold_start');
        expect(deriveViewerSuggestionProfile(2, 8, false).state).toBe('sparse');
        expect(deriveViewerSuggestionProfile(10, 18, true).state).toBe('engaged');
    });

    it('prioritizes cross-signal authors ahead of pure active and fallback candidates', () => {
        const profile = deriveViewerSuggestionProfile(3, 5, true);
        const ranked = rankAuthorSuggestionCandidates(
            [
                candidate({
                    userId: 'author-hybrid',
                    sources: ['graph', 'embedding'],
                    sourceScores: { graph: 0.72, embedding: 0.68 },
                    recentPosts: 1,
                    engagementScore: 6,
                    graphProximity: 0.72,
                    embeddingAffinity: 0.68,
                    clusterProducerPrior: 0.22,
                    qualityScore: 0.82,
                }),
                candidate({
                    userId: 'author-active',
                    sources: ['active'],
                    sourceScores: { active: 0.78 },
                    recentPosts: 5,
                    engagementScore: 52,
                    qualityScore: 0.58,
                }),
                candidate({
                    userId: 'author-fallback',
                    sources: ['fallback'],
                    sourceScores: { fallback: 0.95 },
                    recentPosts: 0,
                    engagementScore: 0,
                    qualityScore: 0.1,
                }),
            ],
            profile,
            3,
        );

        expect(ranked.map((entry) => entry.userId)).toEqual([
            'author-hybrid',
            'author-active',
            'author-fallback',
        ]);
        expect(ranked[0].reason).toBe('兴趣相近 · 社交桥接');
        expect(ranked[1].reason).toBe('近期活跃作者');
        expect(ranked[2].reason).toBe('新加入作者');
    });
});
