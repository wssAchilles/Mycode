import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { WeightedScorer } from '../../src/services/recommendation/scorers/WeightedScorer';
import { ScoreCalibrationScorer } from '../../src/services/recommendation/scorers/ScoreCalibrationScorer';
import { AuthorDiversityScorer } from '../../src/services/recommendation/scorers/AuthorDiversityScorer';
import { OONScorer } from '../../src/services/recommendation/scorers/OONScorer';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

const base = (postId: mongoose.Types.ObjectId, extra?: Partial<any>) => ({
    postId,
    authorId: 'u1',
    content: 'x',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    isReply: false,
    isRepost: false,
    likeCount: 12,
    commentCount: 4,
    repostCount: 2,
    phoenixScores: {
        likeScore: 0.1,
        replyScore: 0.01,
        repostScore: 0.005,
        clickScore: 0.2,
        dismissScore: 0.0,
        blockScore: 0.0,
    },
    ...extra,
});

describe('Scoring semantics (Phoenix -> Weighted -> Calibration -> Diversity -> OON)', () => {
    it('Calibration adjusts weightedScore before Diversity, and OON adjusts only final score', async () => {
        const q = createFeedQuery('user', 20);
        q.embeddingContext = {
            interestedInClusters: [{ clusterId: 101, score: 0.8 }],
            producerEmbedding: [],
            qualityScore: 0.9,
            computedAt: new Date('2026-04-22T00:00:00.000Z'),
            version: 1,
            usable: true,
            stale: false,
        };
        q.userStateContext = {
            state: 'warm',
            reason: 'stable_but_not_dense',
            followedCount: 4,
            recentActionCount: 14,
            recentPositiveActionCount: 9,
            usableEmbedding: true,
            accountAgeDays: 10,
        };

        const inNet = base(oid('507f191e810c19729de87001'), {
            inNetwork: true,
            authorId: 'a',
            recallSource: 'FollowingSource',
        });
        const oon = base(oid('507f191e810c19729de87002'), {
            inNetwork: false,
            authorId: 'b',
            recallSource: 'PopularSource',
        });

        const weighted = new WeightedScorer();
        const w = await weighted.score(q, [inNet as any, oon as any]);

        // WeightedScorer must not write final score.
        expect(w[0].candidate.score).toBeUndefined();
        expect(w[1].candidate.score).toBeUndefined();
        expect(typeof w[0].candidate.weightedScore).toBe('number');
        expect(typeof w[1].candidate.weightedScore).toBe('number');
        // OON factor should NOT be applied in WeightedScorer.
        expect(w[0].candidate.weightedScore).toBeCloseTo(w[1].candidate.weightedScore as number, 10);

        const calibration = new ScoreCalibrationScorer();
        const c = await calibration.score(q, w.map((x) => x.candidate) as any);
        expect((c[0].candidate.weightedScore as number)).toBeGreaterThan(w[0].candidate.weightedScore as number);
        expect((c[1].candidate.weightedScore as number)).toBeGreaterThan(w[1].candidate.weightedScore as number);
        expect((c[0].candidate.weightedScore as number)).toBeGreaterThan(c[1].candidate.weightedScore as number);

        const diversity = new AuthorDiversityScorer();
        const d = await diversity.score(q, c.map((x) => x.candidate) as any);
        expect(typeof d[0].candidate.score).toBe('number');
        expect(typeof d[1].candidate.score).toBe('number');

        // With different authors, diversity multiplier for both is 1.0.
        expect(d[0].candidate.score).toBeCloseTo(d[0].candidate.weightedScore as number, 10);
        expect(d[1].candidate.score).toBeCloseTo(d[1].candidate.weightedScore as number, 10);

        const oonScorer = new OONScorer(0.7);
        const o = await oonScorer.score(q, d.map((x) => x.candidate) as any);

        const inNetFinal = o[0].candidate.inNetwork ? o[0] : o[1];
        const oonFinal = o[0].candidate.inNetwork === false ? o[0] : o[1];

        const dInNetScore = d.find((x) => x.candidate.inNetwork === true)!.candidate.score as number;
        const dOonScore = d.find((x) => x.candidate.inNetwork === false)!.candidate.score as number;

        expect(inNetFinal.candidate.score).toBeCloseTo(dInNetScore, 10);
        expect(oonFinal.candidate.score).toBeCloseTo(dOonScore * 0.7, 10);
    });
});
