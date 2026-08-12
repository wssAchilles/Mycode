import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RecommendationTrace from '../../src/models/RecommendationTrace';
import {
    candidatePoolSha256,
    decisionLogSha256,
    recommendationDecisionLogSchema,
} from '../../src/services/recommendation/decisionLog/contracts';
import {
    buildRecommendationDecisionLogV1,
    isRecommendationDecisionLogV1Enabled,
    persistRecommendationDecisionLogV1,
} from '../../src/services/recommendation/decisionLog/write';
import type { SpaceFeedDebugInfo } from '../../src/services/recommendation/feed/debugInfo';
import type {
    RecommendationTracePayload,
    RecommendationTraceReplayPoolPayload,
} from '../../src/services/recommendation/rust/contracts';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

const originalDecisionLogFlag = process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED;

function candidate(hex: string, overrides: Partial<FeedCandidate> = {}): FeedCandidate {
    return {
        postId: new mongoose.Types.ObjectId(hex),
        authorId: 'author-a',
        content: 'candidate',
        createdAt: new Date('2026-07-16T07:00:00.000Z'),
        isReply: false,
        isRepost: false,
        recallSource: 'FollowingSource',
        score: 1,
        ...overrides,
    };
}

function debugInfo(servingOwner: 'node' | 'rust'): SpaceFeedDebugInfo {
    return {
        requestId: 'ce65f95a-c904-4c31-a28b-02bb61b14d75',
        pipeline: servingOwner === 'rust' ? 'rust_primary' : 'node_baseline',
        runtimeMode: servingOwner === 'rust' ? 'primary' : 'off',
        configuredServingOwner: servingOwner,
        servingOwner,
        owner: servingOwner,
        selectedSourceCounts: {},
        inNetworkCount: 0,
        outOfNetworkCount: 0,
        degradedReasons: [],
    };
}

function rustTrace(
    requestId: string,
    replayPool: RecommendationTraceReplayPoolPayload,
): RecommendationTracePayload {
    return {
        traceVersion: 'rust_candidate_trace_v1',
        requestId,
        pipelineVersion: 'pipeline-v7',
        strategyVersion: 'weighted-v1',
        owner: 'rust',
        fallbackMode: 'none',
        selectedCount: 1,
        inNetworkCount: 0,
        outOfNetworkCount: 1,
        sourceCounts: [],
        authorDiversity: 1,
        replyRatio: 0,
        averageScore: 1,
        freshness: {},
        candidates: [],
        experimentKeys: [],
        replayPool,
        serveCacheHit: false,
    };
}

function replayCandidate(candidateValue: FeedCandidate, rank: number) {
    return {
        postId: candidateValue.postId.toString(),
        modelPostId: candidateValue.modelPostId,
        authorId: candidateValue.authorId,
        rank,
        recallSource: candidateValue.recallSource || 'unknown',
        inNetwork: candidateValue.inNetwork === true,
        isNews: candidateValue.isNews === true,
        score: candidateValue.score,
        createdAt: candidateValue.createdAt.toISOString(),
    };
}

function nodeDecision() {
    const query = createFeedQuery('viewer-1', 2, false, {
        requestId: 'ce65f95a-c904-4c31-a28b-02bb61b14d75',
        decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab',
        clientRequestId: 'client-phase7-1',
    });
    const selectedA = candidate('507f191e810c19729de8c001', { authorId: 'author-a', score: 0.72 });
    const selectedB = candidate('507f191e810c19729de8c002', { authorId: 'author-b', score: 0.51 });
    const self = candidate('507f191e810c19729de8c000', { authorId: query.userId, score: undefined });

    return buildRecommendationDecisionLogV1({
        query,
        policyCandidates: [selectedA, selectedB],
        finalServedCandidates: [self, selectedA],
        debugInfo: debugInfo('node'),
        decisionAt: new Date('2026-07-16T08:00:00.000Z'),
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    if (originalDecisionLogFlag === undefined) {
        delete process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED;
    } else {
        process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED = originalDecisionLogFlag;
    }
});

describe('recommendation decision log writer', () => {
    it('records policy selection separately from the post-self final page', () => {
        const decision = nodeDecision();
        const ids = decision.candidatePool.candidates.map((entry) => entry.candidateId);
        const [selectedA, selectedB] = decision.candidatePool.candidates;

        expect(ids).toEqual([
            '507f191e810c19729de8c001',
            '507f191e810c19729de8c002',
        ]);
        expect(selectedA).toMatchObject({
            selected: true,
            selectionRank: 1,
            served: true,
            servedPosition: 2,
            objectiveEvidence: [{
                status: 'unavailable',
                objective: 'engagement',
                reason: 'no_trusted_prediction_artifact',
            }],
        });
        expect(selectedB).toMatchObject({
            selected: true,
            selectionRank: 2,
            served: false,
            servedPosition: null,
        });
        expect(decision.actions).toEqual([{
            actionKey: {
                candidateNamespace: 'serving_post_id',
                candidateId: selectedA.candidateId,
                servedPosition: 2,
            },
            selectionRank: 1,
            behaviorPropensity: {
                status: 'not_evaluable_deterministic',
                reason: 'deterministic_top_k_no_logged_probability',
            },
        }]);
        expect(decision.behaviorPolicyKind).toBe('deterministic_top_k');
        expect(decision.candidatePool.supportEvidence.status).toBe('incomplete');
        expect(Object.values(decision.versions).every((evidence) => evidence.status === 'unavailable')).toBe(true);
        expect(recommendationDecisionLogSchema.parse(decision)).toEqual(decision);
        expect(decision.candidatePool.candidatePoolSha256).toBe(
            candidatePoolSha256(decision.candidatePool.candidates),
        );
        expect(decisionLogSha256(decision)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('fails closed when policy candidates contain a duplicate post id', () => {
        const query = createFeedQuery('viewer-1', 2, false, {
            requestId: 'ce65f95a-c904-4c31-a28b-02bb61b14d75',
            decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab',
        });
        const duplicate = candidate('507f191e810c19729de8c001');
        let thrown: unknown;

        try {
            buildRecommendationDecisionLogV1({
                query,
                policyCandidates: [duplicate, duplicate],
                finalServedCandidates: [duplicate],
                debugInfo: debugInfo('node'),
                decisionAt: new Date('2026-07-16T08:00:00.000Z'),
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({
            code: 'decision_log_duplicate_policy_candidate',
            message: 'decision_log_duplicate_policy_candidate',
        });
    });

    it('claims complete Rust support only for a full pool containing every selection', () => {
        const query = createFeedQuery('viewer-1', 1, false, {
            requestId: 'ce65f95a-c904-4c31-a28b-02bb61b14d75',
            decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab',
        });
        const selectedA = candidate('507f191e810c19729de8c001');
        const rejectedB = candidate('507f191e810c19729de8c002', { score: 0.2 });
        const missingC = candidate('507f191e810c19729de8c003', { score: 0.8 });
        const completePool: RecommendationTraceReplayPoolPayload = {
            poolKind: 'pre_selector_scored_topk_v1',
            totalCount: 2,
            truncated: false,
            candidates: [replayCandidate(selectedA, 1), replayCandidate(rejectedB, 2)],
        };
        const build = (policyCandidates: FeedCandidate[], replayPool: RecommendationTraceReplayPoolPayload) => (
            buildRecommendationDecisionLogV1({
                query,
                policyCandidates,
                finalServedCandidates: policyCandidates,
                debugInfo: debugInfo('rust'),
                rustTrace: rustTrace(query.requestId, replayPool),
                decisionAt: new Date('2026-07-16T08:00:00.000Z'),
            })
        );

        const complete = build([selectedA], completePool);
        expect(complete.candidatePool.supportEvidence).toEqual({ status: 'complete' });
        expect(complete.candidatePool.candidates.map((entry) => entry.poolRank)).toEqual([1, 2]);
        expect(complete.versions.pipeline).toEqual({ status: 'bound', version: 'pipeline-v7' });
        expect(complete.versions.strategy).toEqual({ status: 'bound', version: 'weighted-v1' });

        const truncated = build([selectedA], { ...completePool, totalCount: 3, truncated: true });
        expect(truncated.candidatePool.supportEvidence.status).toBe('incomplete');

        const selectedMissing = build([missingC], completePool);
        expect(selectedMissing.candidatePool.supportEvidence.status).toBe('incomplete');
        expect(selectedMissing.candidatePool.candidates).toContainEqual(expect.objectContaining({
            candidateId: missingC.postId.toString(),
            selected: true,
        }));
        expect(() => recommendationDecisionLogSchema.parse(selectedMissing)).not.toThrow();
    });

    it('uses one no-upsert CAS and accepts first-write plus same-digest retries', async () => {
        const decision = nodeDecision();
        let storedDigest: string | undefined;
        const updateOne = vi.spyOn(RecommendationTrace, 'updateOne').mockImplementation(
            async (_filter: any, update: any) => {
                const incomingDigest = update.$set.decisionLogV1Sha256 as string;
                const matched = storedDigest === undefined || storedDigest === incomingDigest;
                const modified = matched && storedDigest !== incomingDigest;
                if (matched) storedDigest = incomingDigest;
                return {
                    acknowledged: true,
                    matchedCount: matched ? 1 : 0,
                    modifiedCount: modified ? 1 : 0,
                } as any;
            },
        );
        const findOne = vi.spyOn(RecommendationTrace, 'findOne');
        const findById = vi.spyOn(RecommendationTrace, 'findById');

        await persistRecommendationDecisionLogV1(decision);
        await persistRecommendationDecisionLogV1(decision);

        const digest = decisionLogSha256(decision);
        expect(updateOne.mock.calls[0]).toEqual([
            {
                requestId: decision.requestId,
                decisionId: decision.decisionId,
                $or: [
                    { decisionLogV1Sha256: { $exists: false } },
                    { decisionLogV1Sha256: digest },
                ],
            },
            {
                $set: {
                    decisionLogV1: decision,
                    decisionLogV1Sha256: digest,
                },
            },
            { upsert: false, runValidators: true },
        ]);
        expect(updateOne).toHaveBeenCalledTimes(2);
        expect(findOne).not.toHaveBeenCalled();
        expect(findById).not.toHaveBeenCalled();

        const conflicting = { ...decision, decisionAt: '2026-07-16T08:00:01.000Z' };
        await expect(persistRecommendationDecisionLogV1(conflicting)).rejects.toMatchObject({
            code: 'decision_log_conflict',
        });
        expect(updateOne.mock.calls[2][0]).toEqual(expect.objectContaining({
            $or: [
                { decisionLogV1Sha256: { $exists: false } },
                { decisionLogV1Sha256: decisionLogSha256(conflicting) },
            ],
        }));
    });

    it('fails closed for unmatched or unacknowledged CAS results', async () => {
        const decision = nodeDecision();
        const updateOne = vi.spyOn(RecommendationTrace, 'updateOne');

        updateOne.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0, modifiedCount: 0 } as any);
        await expect(persistRecommendationDecisionLogV1(decision)).rejects.toMatchObject({
            code: 'decision_log_conflict',
        });

        updateOne.mockResolvedValueOnce({ acknowledged: false, matchedCount: 1, modifiedCount: 0 } as any);
        await expect(persistRecommendationDecisionLogV1(decision)).rejects.toMatchObject({
            code: 'decision_log_conflict',
        });
    });

    it('stores decision identities and the structured log on the existing trace schema', () => {
        const decision = nodeDecision();
        const trace = new RecommendationTrace({
            requestId: decision.requestId,
            decisionId: decision.decisionId,
            clientRequestId: decision.clientRequestId,
            decisionLogV1: decision,
            decisionLogV1Sha256: decisionLogSha256(decision),
            userId: 'viewer-1',
            productSurface: 'space_feed',
            degradedReasons: [],
            selectedCount: 0,
            inNetworkCount: 0,
            outOfNetworkCount: 0,
            sourceCounts: [],
            authorDiversity: 0,
            replyRatio: 0,
            averageScore: 0,
            freshness: {},
            candidates: [],
            experimentKeys: [],
        }).toObject();

        expect(RecommendationTrace.schema.path('decisionLogV1').instance).toBe('Mixed');
        expect(trace).toMatchObject({
            decisionId: decision.decisionId,
            clientRequestId: decision.clientRequestId,
            decisionLogV1: decision,
            decisionLogV1Sha256: decisionLogSha256(decision),
        });
    });

    it('is disabled unless the flag is exactly true', () => {
        delete process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED;
        expect(isRecommendationDecisionLogV1Enabled()).toBe(false);
        process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED = 'false';
        expect(isRecommendationDecisionLogV1Enabled()).toBe(false);
        process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED = 'TRUE';
        expect(isRecommendationDecisionLogV1Enabled()).toBe(false);
        process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED = 'true';
        expect(isRecommendationDecisionLogV1Enabled()).toBe(true);
    });
});
