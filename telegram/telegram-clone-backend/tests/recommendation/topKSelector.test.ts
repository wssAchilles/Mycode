import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { TopKSelector } from '../../src/services/recommendation/selectors/TopKSelector';
import { createFeedQuery, type UserStateKind } from '../../src/services/recommendation/types/FeedQuery';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

function query(state: UserStateKind, limit: number) {
    const feedQuery = createFeedQuery(`viewer-${state}`, limit);
    feedQuery.userStateContext = {
        state,
        reason: 'test',
        followedCount: 10,
        recentActionCount: 20,
        recentPositiveActionCount: 8,
        usableEmbedding: true,
        accountAgeDays: 30,
    };
    return feedQuery;
}

function candidate(
    postId: string,
    authorId: string,
    retrievalLane: FeedCandidate['retrievalLane'],
    inNetwork: boolean,
    score: number,
    clusterId?: number,
): FeedCandidate {
    return {
        postId: new mongoose.Types.ObjectId(),
        modelPostId: postId,
        authorId,
        content: 'candidate',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
        inNetwork,
        retrievalLane,
        recallSource:
            retrievalLane === 'in_network'
                ? 'FollowingSource'
                : retrievalLane === 'social_expansion'
                    ? 'GraphSource'
                    : retrievalLane === 'interest'
                        ? 'TwoTowerSource'
                        : 'PopularSource',
        weightedScore: score,
        score,
        newsMetadata: typeof clusterId === 'number' ? { clusterId } : undefined,
    };
}

function scored(candidate: FeedCandidate) {
    return { candidate, score: candidate.score ?? 0 };
}

describe('TopKSelector', () => {
    it('enforces author soft cap while preserving warm lane mix', () => {
        const selector = new TopKSelector(6, { oversampleFactor: 1, maxSize: 20, authorSoftCap: 2 });
        const selected = selector.select(
            query('warm', 6),
            [
                candidate('f1', 'author-a', 'in_network', true, 10),
                candidate('f2', 'author-a', 'in_network', true, 9.8),
                candidate('f3', 'author-a', 'in_network', true, 9.6),
                candidate('f4', 'author-f', 'in_network', true, 9.5),
                candidate('g1', 'author-b', 'social_expansion', false, 9.4),
                candidate('i1', 'author-c', 'interest', false, 9.2),
                candidate('i2', 'author-d', 'interest', false, 9.0),
                candidate('p1', 'author-e', 'fallback', false, 8.8),
            ].map(scored),
        );

        expect(selected.filter((entry) => entry.authorId === 'author-a')).toHaveLength(2);
        expect(
            selected.filter((entry) => entry.retrievalLane === 'social_expansion').length,
        ).toBeGreaterThanOrEqual(1);
    });

    it('prevents sparse fallback takeover and keeps graph expansion represented', () => {
        const selector = new TopKSelector(6, { oversampleFactor: 1, maxSize: 20, authorSoftCap: 2 });
        const selected = selector.select(
            query('sparse', 6),
            [
                candidate('p1', 'author-p1', 'fallback', false, 9.9),
                candidate('p2', 'author-p2', 'fallback', false, 9.8),
                candidate('p3', 'author-p3', 'fallback', false, 9.7),
                candidate('i1', 'author-i1', 'interest', false, 9.6),
                candidate('i2', 'author-i2', 'interest', false, 9.5),
                candidate('i3', 'author-i3', 'interest', false, 9.4),
                candidate('g1', 'author-g1', 'social_expansion', false, 9.3),
                candidate('f1', 'author-f1', 'in_network', true, 9.2),
            ].map(scored),
        );

        expect(
            selected.filter((entry) => entry.retrievalLane === 'fallback').length,
        ).toBeLessThanOrEqual(2);
        expect(
            selected.filter((entry) => entry.retrievalLane === 'social_expansion').length,
        ).toBeGreaterThanOrEqual(1);
    });

    it('keeps warm output interleaved instead of restoring pure score order', () => {
        const selector = new TopKSelector(6, { oversampleFactor: 1, maxSize: 20, authorSoftCap: 2 });
        const selected = selector.select(
            query('warm', 6),
            [
                candidate('f1', 'author-f1', 'in_network', true, 10),
                candidate('f2', 'author-f2', 'in_network', true, 9.9),
                candidate('f3', 'author-f3', 'in_network', true, 9.8),
                candidate('g1', 'author-g1', 'social_expansion', false, 9.7),
                candidate('g2', 'author-g2', 'social_expansion', false, 9.6),
                candidate('i1', 'author-i1', 'interest', false, 9.5),
                candidate('i2', 'author-i2', 'interest', false, 9.4),
                candidate('p1', 'author-p1', 'fallback', false, 9.3),
            ].map(scored),
        );

        expect(selected.slice(0, 3).map((entry) => entry.retrievalLane)).toEqual([
            'in_network',
            'social_expansion',
            'interest',
        ]);
    });

    it('applies topic soft cap before relaxed underfill', () => {
        const selector = new TopKSelector(6, { oversampleFactor: 1, maxSize: 20, authorSoftCap: 3 });
        const selected = selector.select(
            query('warm', 6),
            [
                candidate('c1', 'author-c1', 'interest', false, 10, 7),
                candidate('c2', 'author-c2', 'interest', false, 9.9, 7),
                candidate('c3', 'author-c3', 'interest', false, 9.8, 7),
                candidate('c4', 'author-c4', 'interest', false, 9.7, 7),
                candidate('c5', 'author-c5', 'interest', false, 9.6, 7),
                candidate('g1', 'author-g1', 'social_expansion', false, 9.5, 9),
                candidate('f1', 'author-f1', 'in_network', true, 9.4, 10),
                candidate('i1', 'author-i1', 'interest', false, 9.3, 11),
            ].map(scored),
        );

        expect(selected.filter((entry) => entry.newsMetadata?.clusterId === 7).length).toBeLessThanOrEqual(4);
        expect(selected.some((entry) => entry.newsMetadata?.clusterId === 9)).toBe(true);
    });

    it('marks selection pools and honors policy source caps', () => {
        const selector = new TopKSelector(6, { oversampleFactor: 1, maxSize: 20, authorSoftCap: 3 });
        const feedQuery = query('warm', 6);
        feedQuery.rankingPolicy = {
            sourceSoftCapRatio: 0.34,
            explorationFloorRatio: 0.17,
        };
        const exploration = candidate('p1', 'author-p1', 'fallback', false, 9.9);
        exploration._scoreBreakdown = { explorationEligible: 1, fatigueStrength: 0.1 };
        const selected = selector.select(
            feedQuery,
            [
                exploration,
                candidate('i1', 'author-i1', 'interest', false, 9.8),
                candidate('i2', 'author-i2', 'interest', false, 9.7),
                candidate('i3', 'author-i3', 'interest', false, 9.6),
                candidate('g1', 'author-g1', 'social_expansion', false, 9.5),
                candidate('f1', 'author-f1', 'in_network', true, 9.4),
                candidate('p2', 'author-p2', 'fallback', false, 9.3),
            ].map(scored),
        );

        expect(selected.some((entry) => entry.selectionPool === 'exploration')).toBe(true);
        expect(selected.every((entry) => entry.scoreContractVersion === 'recommendation_score_contract_v2')).toBe(true);
        expect(selected.filter((entry) => entry.recallSource === 'TwoTowerSource').length).toBeLessThanOrEqual(3);
    });
});
