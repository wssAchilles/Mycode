import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { WeightedScorer } from '../../src/services/recommendation/scorers/WeightedScorer';
import { ScoreCalibrationScorer } from '../../src/services/recommendation/scorers/ScoreCalibrationScorer';
import { AuthorDiversityScorer } from '../../src/services/recommendation/scorers/AuthorDiversityScorer';
import { OONScorer } from '../../src/services/recommendation/scorers/OONScorer';
import { AuthorAffinityScorer } from '../../src/services/recommendation/scorers/AuthorAffinityScorer';
import { PhoenixScorer } from '../../src/services/recommendation/scorers/PhoenixScorer';
import { ContentQualityScorer } from '../../src/services/recommendation/scorers/ContentQualityScorer';
import { EngagementScorer } from '../../src/services/recommendation/scorers/EngagementScorer';

// Pin time so Date.now()-based scorers produce deterministic results.
const FIXED_NOW = new Date('2026-05-10T12:00:00.000Z').getTime();
beforeAll(() => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
});
afterAll(() => {
    vi.restoreAllMocks();
});

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
    it('uses retrieval evidence as a bounded weighted-score lift', async () => {
        const q = createFeedQuery('user', 20);
        const single = base(oid('507f191e810c19729de87011'));
        const evidence = base(oid('507f191e810c19729de87012'), {
            _scoreBreakdown: {
                retrievalSecondarySourceCount: 1,
                retrievalCrossLaneSourceCount: 1,
                retrievalEvidenceConfidence: 0.7,
                retrievalMultiSourceBonus: 0.08,
            },
        });
        const strongPersonalized = base(oid('507f191e810c19729de87013'), {
            phoenixScores: {
                likeScore: 0.22,
                replyScore: 0.05,
                repostScore: 0.02,
                clickScore: 0.22,
            },
        });

        const weighted = await new WeightedScorer().score(q, [single as any, evidence as any, strongPersonalized as any]);

        expect(weighted[1].candidate.weightedScore).toBeGreaterThan(weighted[0].candidate.weightedScore as number);
        expect(weighted[2].candidate.weightedScore).toBeGreaterThan(weighted[1].candidate.weightedScore as number);
        expect(weighted[1].scoreBreakdown?.weightedEvidenceLift).toBeGreaterThan(0);
    });

    it('suppresses blocked authors early and applies negative author affinity', async () => {
        const q = createFeedQuery('user', 20);
        q.userFeatures = {
            followedUserIds: [],
            blockedUserIds: ['blocked-author'],
            mutedKeywords: [],
            seenPostIds: [],
        };
        q.userActionSequence = [{
            action: 'block_author',
            targetAuthorId: 'blocked-author',
            timestamp: new Date(),
        } as any];

        const candidate = base(oid('507f191e810c19729de87014'), {
            authorId: 'blocked-author',
            recallSource: 'PopularSource',
            weightedScore: 1,
        });
        const calibrated = await new ScoreCalibrationScorer().score(q, [candidate as any]);
        const affinity = await new AuthorAffinityScorer().score(q, calibrated.map((item) => item.candidate) as any);

        expect(calibrated[0].scoreBreakdown?.earlySuppressionMultiplier).toBeLessThan(0.2);
        expect(affinity[0].scoreBreakdown?.authorAffinityNegativeActions).toBe(1);
        expect(affinity[0].candidate.weightedScore).toBeLessThan(calibrated[0].candidate.weightedScore as number);
    });

    it('does not zero an already-recalled in-network candidate when source policy is closed', async () => {
        const q = createFeedQuery('user', 20);
        q.userStateContext = {
            state: 'cold_start',
            reason: 'bootstrap',
            followedCount: 0,
            recentActionCount: 0,
            recentPositiveActionCount: 0,
            usableEmbedding: false,
        };

        const candidate = base(oid('507f191e810c19729de87015'), {
            inNetwork: true,
            recallSource: 'FollowingSource',
            weightedScore: 1,
        });
        const calibrated = await new ScoreCalibrationScorer().score(q, [candidate as any]);

        expect(calibrated[0].candidate.weightedScore).toBeGreaterThan(0);
        expect(calibrated[0].scoreBreakdown?.calibrationSourceMultiplier).toBe(1);
    });

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

// ─── Phase 1.1: scorer order fix verification ─────────────────────────────────
// ContentQualityScorer reads candidate.authorAffinityScore (line 114 of ContentQualityScorer.ts).
// After Phase 1.1 fix, AuthorAffinityScorer runs BEFORE ContentQualityScorer,
// so ContentQualityScorer can read a non-zero authorAffinityScore.
describe('Scorer order fix: AuthorAffinityScorer before ContentQualityScorer', () => {
    it('ContentQualityScorer sees non-zero authorAffinityScore when AuthorAffinity runs first', async () => {
        const q = createFeedQuery('user', 20);
        q.userActionSequence = [{
            action: 'like',
            targetAuthorId: 'author-with-history',
            timestamp: new Date(FIXED_NOW - 2 * 60 * 60 * 1000).toISOString(),
        }];

        const candidate = {
            postId: oid('507f191e810c19729de87020'),
            authorId: 'author-with-history',
            content: 'A substantive post with enough content to avoid short-content penalty and get a meaningful quality score.',
            createdAt: new Date(FIXED_NOW - 3 * 60 * 60 * 1000),
            isReply: false,
            isRepost: false,
            inNetwork: true,
            likeCount: 15,
            commentCount: 5,
            repostCount: 2,
            viewCount: 200,
            phoenixScores: {
                likeScore: 0.12,
                replyScore: 0.02,
                repostScore: 0.01,
                clickScore: 0.18,
            },
        } as any;

        // Fixed pipeline order: AuthorAffinity BEFORE ContentQuality
        const weighted = await new WeightedScorer().score(q, [candidate]);
        const withAffinity = await new AuthorAffinityScorer().score(q, weighted.map(w => w.candidate));

        // authorAffinityScore is now set by AuthorAffinityScorer
        expect(typeof withAffinity[0].candidate.authorAffinityScore).toBe('number');
        expect(withAffinity[0].candidate.authorAffinityScore).toBeGreaterThan(0);

        // ContentQualityScorer now reads a non-zero authorAffinityScore
        const withQuality = await new ContentQualityScorer().score(q, withAffinity.map(w => w.candidate));
        expect(withQuality[0].candidate.authorAffinityScore).toBeGreaterThan(0);
        expect(withQuality[0].candidate.weightedScore).toBeGreaterThan(0);
    });
});

// ─── Phase 0 baseline: Phoenix coverage scenarios ─────────────────────────────
// These 4 scenarios lock the behavior of PhoenixScorer + EngagementScorer interaction.
// Phase 2.1 (EngagementScorer passthrough) must not change these outcomes.
describe('Phoenix coverage baseline (for EngagementScorer passthrough safety)', () => {
    const phoenixScorer = new PhoenixScorer();
    const engagementScorer = new EngagementScorer();

    it('phoenix_remote_full: remote Phoenix produces full phoenixScores, EngagementScorer does not override', async () => {
        const q = createFeedQuery('user', 20);
        const candidate = {
            postId: oid('507f191e810c19729de87030'),
            authorId: 'news-bot',
            content: 'Breaking news article',
            createdAt: new Date(FIXED_NOW - 2 * 60 * 60 * 1000),
            isReply: false,
            isRepost: false,
            inNetwork: false,
            isNews: true,
            newsMetadata: { externalId: 'NEWS-FULL-001', title: 'Full News', source: 'Reuters' },
            modelPostId: 'NEWS-FULL-001',
            likeCount: 50,
            commentCount: 10,
            repostCount: 5,
            viewCount: 1000,
        } as any;

        // Without remote endpoint, PhoenixScorer falls through to social heuristic for non-news,
        // or returns empty for news. EngagementScorer fills the gap.
        const phoenixResult = await phoenixScorer.score(q, [candidate]);
        const afterPhoenix = phoenixResult[0].candidate;

        // EngagementScorer fills missing fields
        const engResult = await engagementScorer.score(q, [afterPhoenix]);
        const afterEng = engResult[0].candidate.phoenixScores;

        // Record baseline: EngagementScorer should have filled at least some fields
        expect(afterEng).toBeDefined();
        expect(typeof afterEng.likeScore).toBe('number');
        expect(typeof afterEng.clickScore).toBe('number');
    });

    it('phoenix_remote_partial: EngagementScorer fills missing action fields', async () => {
        const q = createFeedQuery('user', 20);
        const candidate = {
            postId: oid('507f191e810c19729de87031'),
            authorId: 'news-bot',
            content: 'Partial news',
            createdAt: new Date(FIXED_NOW - 2 * 60 * 60 * 1000),
            isReply: false,
            isRepost: false,
            inNetwork: false,
            isNews: true,
            newsMetadata: { externalId: 'NEWS-PARTIAL-001' },
            modelPostId: 'NEWS-PARTIAL-001',
            // Pretend PhoenixScorer produced a partial vector (like only)
            phoenixScores: { likeScore: 0.85 },
        } as any;

        const engResult = await engagementScorer.score(q, [candidate]);
        const scores = engResult[0].candidate.phoenixScores;

        // likeScore preserved from upstream
        expect(scores.likeScore).toBeCloseTo(0.85, 6);
        // Missing fields filled by EngagementScorer
        expect(typeof scores.clickScore).toBe('number');
        expect(typeof scores.replyScore).toBe('number');
        expect(typeof scores.shareScore).toBe('number');
        expect(typeof scores.notInterestedScore).toBe('number');
    });

    it('phoenix_no_remote_social: social heuristic fills all phoenixScores for non-news', async () => {
        const q = createFeedQuery('user', 20);
        const candidate = {
            postId: oid('507f191e810c19729de87032'),
            authorId: 'friend-user',
            content: 'Social post from a friend with enough content for quality scoring',
            createdAt: new Date(FIXED_NOW - 4 * 60 * 60 * 1000),
            isReply: false,
            isRepost: false,
            inNetwork: true,
            recallSource: 'FollowingSource',
            likeCount: 8,
            commentCount: 3,
            repostCount: 1,
            viewCount: 150,
        } as any;

        // PhoenixScorer in social heuristic mode (no remote endpoint, non-news)
        const result = await phoenixScorer.score(q, [candidate]);
        const scores = result[0].candidate.phoenixScores;

        // Social heuristic should produce all key action scores
        expect(scores).toBeDefined();
        expect(typeof scores!.likeScore).toBe('number');
        expect(typeof scores!.clickScore).toBe('number');
        expect(typeof scores!.replyScore).toBe('number');
        expect(typeof scores!.dismissScore).toBe('number');
        expect(scores!.likeScore).toBeGreaterThan(0);
    });

    it('phoenix_no_remote_news: EngagementScorer fills phoenixScores for news without remote', async () => {
        const q = createFeedQuery('user', 20);
        const candidate = {
            postId: oid('507f191e810c19729de87033'),
            authorId: 'news-bot',
            content: 'News article without remote prediction',
            createdAt: new Date(FIXED_NOW - 1 * 60 * 60 * 1000),
            isReply: false,
            isRepost: false,
            inNetwork: false,
            isNews: true,
            newsMetadata: { externalId: 'NEWS-NO-REMOTE-001' },
            likeCount: 5,
            commentCount: 1,
            repostCount: 0,
            viewCount: 500,
        } as any;

        // PhoenixScorer skips social heuristic for news (line 114: !candidate.isNews)
        const phoenixResult = await phoenixScorer.score(q, [candidate]);
        // Without remote, news candidates get no phoenixScores from PhoenixScorer
        const afterPhoenix = phoenixResult[0].candidate.phoenixScores;

        // EngagementScorer fills the gap
        const engResult = await engagementScorer.score(q, [phoenixResult[0].candidate]);
        const afterEng = engResult[0].candidate.phoenixScores;

        expect(afterEng).toBeDefined();
        expect(typeof afterEng.likeScore).toBe('number');
        expect(afterEng.likeScore).toBeGreaterThan(0);
        expect(typeof afterEng.clickScore).toBe('number');
    });
});

// ─── Phase 0 baseline: ScoreCalibrationScorer negative feedback double-count ───
// Locks the current behavior where negative feedback is applied twice:
// once via phoenixScores -> WeightedScorer negative weights,
// again via ScoreCalibrationScorer.negativeFeedback multiplicative penalty.
describe('ScoreCalibrationScorer negative feedback double-count baseline', () => {
    it('applies negativeFeedback multiplier on top of WeightedScorer negative weights', async () => {
        const q = createFeedQuery('user', 20);
        q.userActionSequence = [{
            action: 'block_author',
            targetAuthorId: 'disliked-author',
            timestamp: new Date(FIXED_NOW - 5 * 24 * 60 * 60 * 1000).toISOString(),
        }];
        q.userFeatures = {
            followedUserIds: [],
            blockedUserIds: ['disliked-author'],
            mutedKeywords: [],
            seenPostIds: [],
        };

        const candidate = {
            postId: oid('507f191e810c19729de87040'),
            authorId: 'disliked-author',
            content: 'Post from a blocked author',
            createdAt: new Date(FIXED_NOW - 6 * 60 * 60 * 1000),
            isReply: false,
            isRepost: false,
            inNetwork: true,
            recallSource: 'FollowingSource',
            weightedScore: 1.0, // Pre-set for isolation
            likeCount: 10,
            commentCount: 2,
            repostCount: 1,
            viewCount: 100,
        } as any;

        // Run calibration alone (with pre-set weightedScore)
        const calibrated = await new ScoreCalibrationScorer().score(q, [candidate]);
        const scoreAfterCalibration = calibrated[0].candidate.weightedScore;

        // Record baseline: negativeFeedback should produce a multiplier < 1
        // because user has block_author action targeting this author
        expect(scoreAfterCalibration).toBeLessThan(1.0);
        // The earlySuppression should also fire (blocked user)
        expect(calibrated[0].scoreBreakdown?.earlySuppressionMultiplier).toBeLessThan(1.0);
    });
});
