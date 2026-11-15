import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    userCount: vi.fn(),
    userVectorCountDocuments: vi.fn(),
    userVectorFind: vi.fn(),
    userActionCountDocuments: vi.fn(),
    userSignalCountDocuments: vi.fn(),
    realGraphCountDocuments: vi.fn(),
    postSnapshotCountDocuments: vi.fn(),
    postSnapshotFind: vi.fn(),
    jobRunFindOne: vi.fn(),
    jobRunFind: vi.fn(),
}));

vi.mock('../../src/models/User', () => ({
    default: { count: mocks.userCount },
}));

vi.mock('../../src/models/UserFeatureVector', () => ({
    default: {
        countDocuments: mocks.userVectorCountDocuments,
        find: mocks.userVectorFind,
    },
}));

vi.mock('../../src/models/UserAction', () => ({
    default: { countDocuments: mocks.userActionCountDocuments },
}));

vi.mock('../../src/models/UserSignal', () => ({
    default: { countDocuments: mocks.userSignalCountDocuments },
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    default: { countDocuments: mocks.realGraphCountDocuments },
}));

vi.mock('../../src/models/PostFeatureSnapshot', () => ({
    default: {
        countDocuments: mocks.postSnapshotCountDocuments,
        find: mocks.postSnapshotFind,
    },
}));

vi.mock('../../src/models/RecommendationJobRun', () => ({
    default: {
        findOne: mocks.jobRunFindOne,
        find: mocks.jobRunFind,
    },
}));

import {
    buildDailyRecommendationRefreshAudit,
    buildDailyRecommendationRefreshOps,
} from '../../src/services/ops/recommendation/dailyRefreshOps';
import { quarantineDigestFromChecksums } from '../../src/services/recommendation/contracts/embeddingContractEvidence';

describe('daily recommendation refresh ops', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('uses only the user cohort for compatibility even when post evidence is invalid', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-11T08:00:00.000Z'));
        mockCoverageCounts();
        mocks.jobRunFindOne.mockReturnValue(findOneResult(latestRun({ embeddingEvidence })));
        mocks.jobRunFind.mockReturnValue(findManyResult([latestRun({ embeddingEvidence })]));

        const result = await buildDailyRecommendationRefreshOps();

        expect(result.embeddingEvidence).toEqual({
            status: 'available',
            ...embeddingEvidence,
        });
        expect(result.users.compatibleDenseVectorRatio).toBe(1);
        expect(result.users).toMatchObject({
            registered: 642,
            vectors: 642,
            refreshed: 642,
        });
        expect(result.realGraph).toEqual({ edges: 954, predicted: 954 });
        expect(result.posts).toEqual({ snapshots: 1161, refreshed: 1161 });
        expect(mocks.userVectorCountDocuments).toHaveBeenCalledTimes(2);
        expect(mocks.userVectorCountDocuments).not.toHaveBeenCalledWith(expect.objectContaining({
            embeddingContract: expect.anything(),
        }));
    });

    it('fails closed when the latest persisted summary has no embedding evidence', async () => {
        mockCoverageCounts();
        mocks.jobRunFindOne.mockReturnValue(findOneResult(latestRun({})));
        mocks.jobRunFind.mockReturnValue(findManyResult([]));

        const result = await buildDailyRecommendationRefreshOps();

        expect(result.embeddingEvidence).toEqual({ status: 'unavailable' });
        expect(result.users.compatibleDenseVectorRatio).toBe(0);
        mockCoverageCounts();
        const audit = await buildDailyRecommendationRefreshAudit();
        expect(audit.embeddingEvidence).toBeNull();
    });

    it('never opens a cursor or full-scans embeddings on the HTTP/ops read path', async () => {
        mockCoverageCounts();
        mocks.jobRunFindOne.mockReturnValue(findOneResult(latestRun({ embeddingEvidence })));
        mocks.jobRunFind.mockReturnValue(findManyResult([]));

        await buildDailyRecommendationRefreshOps();

        expect(mocks.userVectorFind).not.toHaveBeenCalled();
        expect(mocks.postSnapshotFind).not.toHaveBeenCalled();
    });

    it('accepts consistent semantic-ready persisted evidence and still rejects mismatched semantic counts', async () => {
        mockCoverageCounts();
        const validSemanticEvidence = {
            ...embeddingEvidence,
            verified_local_fallback: 2,
            semantic_ready: 1,
            cohorts: {
                ...embeddingEvidence.cohorts,
                userVectors: {
                    ...embeddingEvidence.cohorts.userVectors,
                    verified_local_fallback: 1,
                    semantic_ready: 1,
                },
            },
        };
        mocks.jobRunFindOne.mockReturnValue(findOneResult(latestRun({
            embeddingEvidence: validSemanticEvidence,
        })));
        mocks.jobRunFind.mockReturnValue(findManyResult([]));

        const validResult = await buildDailyRecommendationRefreshOps();

        expect(validResult.embeddingEvidence).toMatchObject({
            status: 'available',
            semantic_ready: 1,
        });
        expect(validResult.users.compatibleDenseVectorRatio).toBe(1);

        // 聚合字段与队列分桶不一致的伪造 semantic_ready 必须依然拒绝
        mocks.jobRunFindOne.mockReturnValue(findOneResult(latestRun({
            embeddingEvidence: {
                ...validSemanticEvidence,
                semantic_ready: 2,
            },
        })));
        const fabricatedResult = await buildDailyRecommendationRefreshOps();

        expect(fabricatedResult.embeddingEvidence).toEqual({ status: 'unavailable' });
        expect(fabricatedResult.users.compatibleDenseVectorRatio).toBe(0);
    });

    it('fails closed when cohort counts do not add up to the aggregate', async () => {
        mockCoverageCounts();
        mocks.jobRunFindOne.mockReturnValue(findOneResult(latestRun({
            embeddingEvidence: {
                ...embeddingEvidence,
                cohorts: {
                    ...embeddingEvidence.cohorts,
                    postFeatureSnapshots: {
                        ...embeddingEvidence.cohorts.postFeatureSnapshots,
                        verified_local_fallback: 2,
                        invalid: 0,
                    },
                },
            },
        })));
        mocks.jobRunFind.mockReturnValue(findManyResult([]));

        const result = await buildDailyRecommendationRefreshOps();

        expect(result.embeddingEvidence).toEqual({ status: 'unavailable' });
        expect(result.users.compatibleDenseVectorRatio).toBe(0);
    });
});

const embeddingEvidence = {
    total: 4,
    verified_local_fallback: 3,
    semantic_ready: 0,
    quarantined: 0,
    invalid: 1,
    unclassified: 0,
    cohorts: {
        userVectors: {
            total: 2,
            verified_local_fallback: 2,
            semantic_ready: 0,
            quarantined: 0,
            invalid: 0,
            unclassified: 0,
        },
        postFeatureSnapshots: {
            total: 2,
            verified_local_fallback: 1,
            semantic_ready: 0,
            quarantined: 0,
            invalid: 1,
            unclassified: 0,
        },
    },
    quarantineDigest: quarantineDigestFromChecksums([]),
    scan: {
        userDocuments: 1,
        postFeatureSnapshots: 2,
        mode: 'full' as const,
        limit: null,
        diagnosticOnly: false,
        ordering: '_id_ascending' as const,
    },
};

function latestRun(summary: Record<string, unknown>) {
    return {
        status: 'success',
        startedAt: new Date('2026-06-11T06:47:45.406Z'),
        finishedAt: new Date('2026-06-11T07:04:46.553Z'),
        durationMs: 1021147,
        trigger: 'manual',
        summary: {
            users: { embeddingsUpdated: 642 },
            realGraph: { predictionMatched: 954, predictionUpdated: 954 },
            posts: { refreshed: 1161 },
            ...summary,
        },
        error: null,
    };
}

function mockCoverageCounts() {
    mocks.userCount.mockResolvedValue(642);
    mocks.userVectorCountDocuments
        .mockResolvedValueOnce(642)
        .mockResolvedValueOnce(642);
    mocks.userActionCountDocuments
        .mockResolvedValueOnce(2000)
        .mockResolvedValueOnce(40);
    mocks.userSignalCountDocuments
        .mockResolvedValueOnce(1200)
        .mockResolvedValueOnce(38);
    mocks.realGraphCountDocuments
        .mockResolvedValueOnce(954)
        .mockResolvedValueOnce(954)
        .mockResolvedValueOnce(954)
        .mockResolvedValueOnce(954);
    mocks.postSnapshotCountDocuments
        .mockResolvedValueOnce(1161)
        .mockResolvedValueOnce(1161);
}

function findOneResult(doc: unknown) {
    return {
        sort: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(doc),
    };
}

function findManyResult(docs: unknown[]) {
    return {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(docs),
    };
}
