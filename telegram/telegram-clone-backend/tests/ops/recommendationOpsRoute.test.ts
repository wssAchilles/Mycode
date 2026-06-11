import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    rustRecommendationMode: vi.fn(),
    rustRecommendationTimeoutMs: vi.fn(),
    recommendationRuntimeSnapshot: vi.fn(),
    rustRecommendationSummary: vi.fn(),
    graphKernelSummary: vi.fn(),
    traceSummary: vi.fn(),
    dailyRefreshOps: vi.fn(),
}));

vi.mock('../../src/services/chatRuntimeMetrics', () => ({
    chatRuntimeMetrics: {
        snapshot: vi.fn().mockReturnValue({}),
        reset: vi.fn(),
    },
}));

vi.mock('../../src/services/controlPlane/runtimeControlPlane', () => ({
    runtimeControlPlane: {
        snapshot: vi.fn().mockReturnValue({}),
        summary: vi.fn().mockReturnValue('ok'),
    },
}));

vi.mock('../../src/services/controlPlane/taskPacket', () => ({
    validateTaskPacket: vi.fn().mockReturnValue({ ok: true, packet: {} }),
}));

vi.mock('../../src/services/chatDelivery/fanoutCommandBus', () => ({
    chatFanoutCommandBus: {
        buildOpsSnapshot: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../src/services/chatDelivery/eventPublisher', () => ({
    chatDeliveryEventPublisher: {
        buildSummary: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../src/services/chatDelivery/replayService', () => ({
    createChatDeliveryReplayService: vi.fn().mockResolvedValue({
        replayFailedDeliveries: vi.fn().mockResolvedValue({}),
    }),
}));

vi.mock('../../src/services/chatDelivery/primaryFallbackService', () => ({
    createChatDeliveryPrimaryFallbackService: vi.fn().mockResolvedValue({
        buildSummary: vi.fn().mockResolvedValue({}),
        replayPrimaryFallbacks: vi.fn().mockResolvedValue({}),
    }),
}));

vi.mock('../../src/services/chatDelivery/executionPolicy', () => ({
    getChatDeliveryExecutionPolicySummary: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/services/chatDelivery/deliveryConsumerOps', () => ({
    readDeliveryConsumerOpsSummary: vi.fn().mockResolvedValue({ available: false }),
}));

vi.mock('../../src/services/chatDelivery/deliveryCanaryOps', () => ({
    readDeliveryCanaryStreamSummary: vi.fn().mockResolvedValue({ available: false }),
}));

vi.mock('../../src/services/chatDelivery/ops/deliveryConsumerReplaySummary', () => ({
    readDeliveryConsumerReplaySummary: vi.fn().mockResolvedValue({ available: false }),
}));

vi.mock('../../src/services/chatDelivery/chatDeliveryConsistencyService', () => ({
    chatDeliveryConsistencyService: {
        buildSummary: vi.fn().mockResolvedValue({}),
        repair: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../src/services/chatDelivery/rolloutAssessment', () => ({
    assessChatDeliveryRollout: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/services/realtimeProtocol/contracts', () => ({
    REALTIME_PROTOCOL_VERSION: 1,
    buildRealtimeRuntimeSemantics: vi.fn().mockReturnValue({ fanoutOwner: 'node', socketTerminator: 'node' }),
    buildRealtimeTransportCatalog: vi.fn().mockReturnValue([]),
    readRealtimeRolloutStage: vi.fn().mockReturnValue('shadow'),
}));

vi.mock('../../src/services/realtimeProtocol/delivery/realtimeDeliveryPublisher', () => ({
    realtimeDeliveryPublisher: {
        buildSummary: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../src/services/realtimeProtocol/realtimeOps', () => ({
    realtimeOps: {
        snapshot: vi.fn().mockReturnValue({}),
    },
}));

vi.mock('../../src/services/realtimeProtocol/realtimeSessionRegistry', () => ({
    realtimeSessionRegistry: {
        snapshot: vi.fn().mockReturnValue({}),
    },
}));

vi.mock('../../src/services/realtimeProtocol/realtimeEventPublisher', () => ({
    realtimeEventPublisher: {
        buildSummary: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../src/services/platformBus/eventPublisher', () => ({
    platformEventPublisher: {
        buildSummary: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../src/services/recommendation/clients/RustRecommendationClient', () => ({
    getRustRecommendationMode: mocks.rustRecommendationMode,
    getRustRecommendationTimeoutMs: mocks.rustRecommendationTimeoutMs,
}));

vi.mock('../../src/services/recommendation/rust/runtimeMetrics', () => ({
    recommendationRuntimeMetrics: {
        snapshot: mocks.recommendationRuntimeSnapshot,
    },
}));

vi.mock('../../src/services/recommendation/rust/ops', () => ({
    readRustRecommendationOpsSummary: mocks.rustRecommendationSummary,
}));

vi.mock('../../src/services/graphKernel/ops', () => ({
    readGraphKernelOpsSummary: mocks.graphKernelSummary,
}));

vi.mock('../../src/services/recommendation/ops', () => ({
    buildRecommendationTraceSummary: mocks.traceSummary,
}));

vi.mock('../../src/services/ops/recommendation/dailyRefreshOps', () => ({
    buildDailyRecommendationRefreshOps: mocks.dailyRefreshOps,
}));

describe('recommendation ops route', () => {
    const originalOpsToken = process.env.OPS_METRICS_TOKEN;
    let server: Server;
    let baseUrl = '';

    beforeAll(async () => {
        process.env.OPS_METRICS_TOKEN = 'phase5-test-token';
        mocks.rustRecommendationMode.mockReturnValue('primary');
        mocks.rustRecommendationTimeoutMs.mockReturnValue(1600);
        mocks.recommendationRuntimeSnapshot.mockReturnValue({
            mode: 'primary',
            lastPrimaryAt: '2026-04-23T00:00:00.000Z',
        });
        mocks.rustRecommendationSummary.mockResolvedValue({
            available: true,
            url: 'http://recommendation:4200/ops/recommendation/summary',
            summary: { requests: 12 },
            runtime: { stage: 'primary' },
        });
        mocks.graphKernelSummary.mockResolvedValue({
            available: true,
            url: 'http://graph-kernel:4300/ops/summary',
            summary: { requests: 5 },
        });
        mocks.traceSummary.mockResolvedValue({
            windowHours: 12,
            limit: 50,
            surface: 'space_feed',
            requests: 2,
            replayPoolCoverage: 1,
            candidateSet: {
                averageObservedCandidates: 40,
                averageTotalCandidates: 90,
                replayPoolCoverage: 1,
                truncationRate: 0.5,
            },
            shadow: {
                comparedRequests: 1,
                averageOverlapRatio: 0.42,
                lowOverlapRate: 1,
                lowOverlapThreshold: 0.5,
                averageSelectedCount: 20,
                averageBaselineCount: 20,
            },
            byPipelineVersion: {},
            byStrategyVersion: {},
            byTraceVersion: {},
            byExperimentKey: {},
            byCandidateSetKind: {},
            owners: [],
            fallbackModes: [],
            userStates: [],
            degradedReasons: [],
            updatedAt: '2026-04-23T00:30:00.000Z',
        });
        mocks.dailyRefreshOps.mockResolvedValue({
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

        const { default: opsRoutes } = await import('../../src/routes/ops');
        const app = express();
        app.use('/api/ops', opsRoutes);

        server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('failed to bind test server');
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        process.env.OPS_METRICS_TOKEN = originalOpsToken;
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    });

    it('returns recommendation trace summary together with runtime and rust ops snapshots', async () => {
        const response = await fetch(
            `${baseUrl}/api/ops/recommendation?windowHours=12&limit=50&surface=space_feed&shadowLowOverlapThreshold=0.5`,
            {
                headers: {
                    'x-ops-token': 'phase5-test-token',
                },
            },
        );

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.success).toBe(true);
        expect(payload.data.runtime.mode).toBe('primary');
        expect(payload.data.rustRecommendation.available).toBe(true);
        expect(payload.data.traceSummary.requests).toBe(2);
        expect(payload.data.traceSummary.shadow.averageOverlapRatio).toBe(0.42);
        expect(payload.data.traceSummary.candidateSet.averageTotalCandidates).toBe(90);
        expect(mocks.traceSummary).toHaveBeenCalledWith({
            windowHours: 12,
            limit: 50,
            surface: 'space_feed',
            shadowLowOverlapThreshold: 0.5,
        });
    });

    it('returns the daily recommendation refresh card evidence behind the ops token', async () => {
        const response = await fetch(
            `${baseUrl}/api/ops/recommendation/daily-refresh?hours=24`,
            {
                headers: {
                    'x-ops-token': 'phase5-test-token',
                },
            },
        );

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.success).toBe(true);
        expect(payload.data.status).toBe('success');
        expect(payload.data.users).toMatchObject({
            registered: 642,
            refreshed: 642,
            compatibleDenseVectorRatio: 1,
        });
        expect(payload.data.realGraph).toEqual({
            edges: 954,
            predicted: 954,
        });
        expect(payload.data.artifacts.postsExported).toBe(1338);
        expect(mocks.dailyRefreshOps).toHaveBeenCalledWith({ hours: 24 });
    });
});
