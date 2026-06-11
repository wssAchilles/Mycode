import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    userCount: vi.fn(),
    userVectorCountDocuments: vi.fn(),
    userActionCountDocuments: vi.fn(),
    userSignalCountDocuments: vi.fn(),
    realGraphCountDocuments: vi.fn(),
    postSnapshotCountDocuments: vi.fn(),
    jobRunFindOne: vi.fn(),
    jobRunFind: vi.fn(),
}));

vi.mock('../../src/models/User', () => ({
    default: {
        count: mocks.userCount,
    },
}));

vi.mock('../../src/models/UserFeatureVector', () => ({
    default: {
        countDocuments: mocks.userVectorCountDocuments,
    },
}));

vi.mock('../../src/models/UserAction', () => ({
    default: {
        countDocuments: mocks.userActionCountDocuments,
    },
}));

vi.mock('../../src/models/UserSignal', () => ({
    default: {
        countDocuments: mocks.userSignalCountDocuments,
    },
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    default: {
        countDocuments: mocks.realGraphCountDocuments,
    },
}));

vi.mock('../../src/models/PostFeatureSnapshot', () => ({
    default: {
        countDocuments: mocks.postSnapshotCountDocuments,
    },
}));

vi.mock('../../src/models/RecommendationJobRun', () => ({
    default: {
        findOne: mocks.jobRunFindOne,
        find: mocks.jobRunFind,
    },
}));

vi.mock('../../src/services/recommendation/contracts/embeddingContract', () => ({
    DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT: {
        embeddingSpace: 'telegram_recommendation_v1',
        retrievalEmbeddingDim: 256,
        rankingEmbeddingDim: 48,
        modelVersion: 'heuristic_two_tower_v1',
        artifactVersion: 'heuristic_artifact_v1',
        producer: 'node_daily_refresh',
    },
}));

import { buildDailyRecommendationRefreshAudit, buildDailyRecommendationRefreshOps } from '../../src/services/ops/recommendation/dailyRefreshOps';

describe('daily recommendation refresh ops', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('maps the latest persistent refresh evidence into the ops card contract', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-11T08:00:00.000Z'));
        mockCoverageCounts();
        mocks.jobRunFindOne.mockReturnValue(findOneResult({
            status: 'success',
            startedAt: new Date('2026-06-11T06:47:45.406Z'),
            finishedAt: new Date('2026-06-11T07:04:46.553Z'),
            durationMs: 1021147,
            trigger: 'manual',
            summary: {
                users: {
                    registered: 642,
                    embeddingsUpdated: 642,
                    embeddingFailures: 0,
                    denseVectorsRepaired: 642,
                },
                realGraph: {
                    predictionMatched: 954,
                    predictionUpdated: 954,
                },
                posts: {
                    scanned: 1161,
                    refreshed: 1161,
                },
                featureExport: {
                    usersExported: 642,
                    postsExported: 1338,
                    clustersExported: 0,
                    durationMs: 34,
                },
            },
            error: null,
        }));
        mocks.jobRunFind.mockReturnValue(findManyResult([
            {
                status: 'success',
                startedAt: new Date('2026-06-11T06:47:45.406Z'),
                finishedAt: new Date('2026-06-11T07:04:46.553Z'),
                trigger: 'manual',
            },
        ]));

        const result = await buildDailyRecommendationRefreshOps();

        expect(result).toEqual({
            status: 'success',
            lastRefreshAt: '2026-06-11T07:04:46.553Z',
            latestRun: {
                startedAt: '2026-06-11T06:47:45.406Z',
                finishedAt: '2026-06-11T07:04:46.553Z',
                durationMs: 1021147,
                trigger: 'manual',
                error: null,
            },
            users: {
                registered: 642,
                vectors: 642,
                refreshed: 642,
                compatibleDenseVectorRatio: 1,
            },
            realGraph: {
                edges: 954,
                predicted: 954,
            },
            posts: {
                snapshots: 1161,
                refreshed: 1161,
            },
            artifacts: {
                usersExported: 642,
                postsExported: 1338,
                clustersExported: 0,
            },
            schedule: {
                label: '每天 02:00',
                cron: '0 2 * * *',
            },
            freshnessWindow: {
                hours: 24,
                since: '2026-06-10T08:00:00.000Z',
            },
        });
        expect(mocks.userVectorCountDocuments).toHaveBeenCalledWith(expect.objectContaining({
            'embeddingContract.retrievalEmbeddingDim': 256,
            twoTowerEmbedding: { $size: 256 },
        }));
    });

    it('keeps current coverage evidence when no job run exists yet', async () => {
        mockCoverageCounts();
        mocks.jobRunFindOne.mockReturnValue(findOneResult(null));
        mocks.jobRunFind.mockReturnValue(findManyResult([]));

        const result = await buildDailyRecommendationRefreshOps({
            hours: 12,
            since: new Date('2026-06-11T00:00:00.000Z'),
        });

        expect(result.status).toBe('unknown');
        expect(result.lastRefreshAt).toBeNull();
        expect(result.users).toEqual({
            registered: 642,
            vectors: 642,
            refreshed: 642,
            compatibleDenseVectorRatio: 1,
        });
        expect(result.realGraph).toEqual({
            edges: 954,
            predicted: 954,
        });
        expect(result.posts.refreshed).toBe(1161);
        expect(result.artifacts).toEqual({
            usersExported: 0,
            postsExported: 0,
            clustersExported: 0,
        });
    });

    it('preserves the CLI audit fields while sharing the same read model', async () => {
        mockCoverageCounts();
        mocks.jobRunFindOne.mockReturnValue(findOneResult(null));
        mocks.jobRunFind.mockReturnValue(findManyResult([]));

        const audit = await buildDailyRecommendationRefreshAudit({
            hours: 24,
            since: new Date('2026-06-11T00:00:00.000Z'),
        });

        expect(audit.registeredUserFeatureCoverage).toMatchObject({
            registeredUsers: 642,
            userFeatureVectors: 642,
            refreshedInWindow: 642,
            compatibleDenseVectorRatio: 1,
        });
        expect(audit.realGraphRefreshCoverage).toMatchObject({
            edges: 954,
            predictedInWindow: 954,
        });
        expect(audit.dailyJobEvidence.latest).toBeNull();
    });
});

function mockCoverageCounts() {
    mocks.userCount.mockResolvedValue(642);
    mocks.userVectorCountDocuments
        .mockResolvedValueOnce(642)
        .mockResolvedValueOnce(642)
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
