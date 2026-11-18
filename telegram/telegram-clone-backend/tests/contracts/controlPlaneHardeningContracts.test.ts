import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import {
  clampSafeI64Number,
  clampSafeU64Number,
  deserializeRecommendationCandidate,
  recommendationQueryPatchPayloadSchema,
  serializeRecommendationQuery,
  serializeRecommendationQueryPatch,
} from '../../src/services/recommendation/rust/contracts';
import {
  RustRecommendationClient,
  normalizeRustRecommendationPayload,
} from '../../src/services/recommendation/clients/RustRecommendationClient';
import { recommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
import { V3_SEMANTIC_USER_TWO_TOWER_EMBEDDING_CONTRACT } from '../../src/services/recommendation/contracts/semanticEmbeddingContracts';
import { TwoTowerSource } from '../../src/services/recommendation/sources/TwoTowerSource';
import { followingTimelineCache } from '../../src/services/recommendation/sources/FollowingTimelineCache';
import { sendMessageSchema } from '../../src/schemas/messageSchemas';
import { isOriginAllowed } from '../../src/config/allowedOrigins';
import { routeKeyOf } from '../../src/middleware/requestTrace';
import { verifyOpsToken } from '../../src/routes/ops/auth';
import mlProxyRoutes from '../../src/routes/mlProxy';
import { updateService } from '../../src/services/updateService';
import { buildMessageFanoutCommand } from '../../src/services/chatDelivery/fanoutPlanner';
import { ChatFanoutCommandBus } from '../../src/services/chatDelivery/fanoutCommandBus';
import { redis } from '../../src/config/redis';
import { buildRealtimeBootstrapPayload } from '../../src/services/realtimeProtocol/bootstrapService';

async function startTestServer(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = addr && typeof addr !== 'string' ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function closeTestServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('跨语言控制面契约与安全边界加固回归测试', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('补齐 UserFeatures 默认偏好字段、QueryPatch.demographics 并安全处理非标准 postId 与 64-bit 数值', async () => {
    const query = createFeedQuery('user-recsys-1', 10);
    expect(query.userFeatures?.videoPreference).toBe('standard');
    expect(query.userFeatures?.isSubscriber).toBe(false);

    query.bloomFilterEntries = [Number.MAX_SAFE_INTEGER + 4096, -5, 42];
    query.columnarRetrievalSequence = [
      {
        postIdHash: Number.MAX_SAFE_INTEGER + 99999,
        authorHash: -Number.MAX_SAFE_INTEGER - 99999,
        actionType: 1,
        timeDeltaSec: 12,
      },
    ];

    const serialized = serializeRecommendationQuery(query);
    expect(serialized.userFeatures?.videoPreference).toBe('standard');
    expect(serialized.userFeatures?.isSubscriber).toBe(false);
    expect(serialized.bloomFilterEntries).toEqual([Number.MAX_SAFE_INTEGER, 0, 42]);
    expect(clampSafeU64Number('18446744073709551615')).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(clampSafeI64Number('-9223372036854775807')).toBeGreaterThanOrEqual(-Number.MAX_SAFE_INTEGER);

    // 验证 serializeRecommendationQueryPatch 完整保留 demographics
    const patch = serializeRecommendationQueryPatch({
      demographics: { country: 'CN', language: 'zh', ageRange: [20, 30] },
      subscribedUserIds: ['creator-1'],
    });
    const parsedPatch = recommendationQueryPatchPayloadSchema.parse(patch);
    expect(parsedPatch.demographics).toEqual({
      country: 'CN',
      language: 'zh',
      ageRange: [20, 30],
    });

    // 验证非 24 位 hex 语料 ID 安全派生 ObjectId 而不抛 BSONError
    const hydratedCandidate = deserializeRecommendationCandidate({
      postId: 'N_EXTERNAL_NEWS_1001',
      authorId: 'news_bot',
      content: 'breaking news',
      createdAt: new Date().toISOString(),
      isReply: false,
      isRepost: false,
    });
    expect(hydratedCandidate.postId.toHexString()).toMatch(/^[0-9a-f]{24}$/);
    expect(hydratedCandidate.modelPostId).toBe('N_EXTERNAL_NEWS_1001');

    // 验证 Rust 本地水合器名称在 Node 侧平滑跳过不抛 500
    const hydrateOut = await recommendationAdapterService.hydrateCandidates(
      query,
      [],
      ['HasMediaCandidateHydrator', 'EngagementCountsCandidateHydrator'],
    );
    expect(hydrateOut.candidates).toEqual([]);

    // 验证 normalizeRustRecommendationPayload 过滤数组 null/NaN 并兜底必填数值字段
    const normalized = normalizeRustRecommendationPayload({
      averageScore: null,
      dwellProbs: [0.2, null, Number.NaN, 0.8],
      semanticIds: [1, null, 3, 4, 5, 6],
    }) as Record<string, unknown>;
    expect(normalized.averageScore).toBe(0);
    expect(normalized.dwellProbs).toEqual([0.2, 0.8]);
    expect(normalized.semanticIds).toEqual([1, -1, 3, 4, 5, 6]);
  });

  it('RustRecommendationClient 自动注入 x-recommendation-deadline-ms 并放行 V3 双塔语义契约', async () => {
    const postSpy = vi.fn().mockRejectedValue(new Error('network_short_circuit'));
    vi.spyOn(axios, 'create').mockReturnValue({ post: postSpy } as any);

    const controller = new AbortController();
    const client = new RustRecommendationClient('http://127.0.0.1:4200', 4500);
    const query = serializeRecommendationQuery(createFeedQuery('user-deadline', 10));

    await expect(
      client.getCandidates(query, { signal: controller.signal, timeoutMs: 3200 }),
    ).rejects.toThrow('network_short_circuit');

    expect(postSpy).toHaveBeenCalledWith(
      '/recommendation/candidates',
      query,
      expect.objectContaining({
        timeout: 3200,
        signal: controller.signal,
        headers: expect.objectContaining({
          'x-recommendation-deadline-ms': expect.stringMatching(/^\d+$/),
        }),
      }),
    );

    // 验证 TwoTowerSource 放行 V3 语义契约不再卡在 request_contract_mismatch
    const annRetrieve = vi.fn().mockResolvedValue({
      candidates: [],
      responseEvidence: {
        embeddingSpace: V3_SEMANTIC_USER_TWO_TOWER_EMBEDDING_CONTRACT.embeddingSpace,
        retrievalEmbeddingDim: V3_SEMANTIC_USER_TWO_TOWER_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
        modelVersion: V3_SEMANTIC_USER_TWO_TOWER_EMBEDDING_CONTRACT.modelVersion,
        artifactVersion: V3_SEMANTIC_USER_TWO_TOWER_EMBEDDING_CONTRACT.artifactVersion,
        idNamespace: 'mongo_object_id',
        indexVersion: 'v3',
      },
    });
    const source = new TwoTowerSource({ retrieve: annRetrieve } as any);
    vi.spyOn(source as any, 'loadCandidatePools').mockResolvedValue([]);
    const v3Query = createFeedQuery('user-v3', 10);
    v3Query.embeddingContext = {
      interestedInClusters: [{ clusterId: 1, score: 0.9 }],
      producerEmbedding: [],
      embeddingContract: V3_SEMANTIC_USER_TWO_TOWER_EMBEDDING_CONTRACT,
      usable: true,
    };
    const candidates = await source.getCandidates(v3Query);
    const detail = source.stageDetail(v3Query, candidates);
    expect((detail?.annObservation as any)?.reason).not.toBe('request_contract_mismatch');
    expect(annRetrieve).toHaveBeenCalledTimes(1);

    // 验证 FollowingTimelineCache 主动删帖失效
    (followingTimelineCache as any).cache.set('author-del', {
      posts: [{ _id: 'post-keep' }, { _id: 'post-deleted' }],
      refreshedAt: Date.now(),
    });
    followingTimelineCache.invalidatePost('author-del', 'post-deleted');
    expect((followingTimelineCache as any).cache.get('author-del').posts).toEqual([{ _id: 'post-keep' }]);
  });

  it('收紧 /api/ml 为 verifyOpsToken 且 VF 故障严格 Fail-Closed 返回 503 safe:false', async () => {
    process.env.OPS_METRICS_TOKEN = 'strict-ops-secret-2026';
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('upstream_ml_down'));

    const app = express();
    app.use(express.json());
    app.use('/api/ml', verifyOpsToken, mlProxyRoutes);

    const { server, baseUrl } = await startTestServer(app);
    try {
      // 普通用户仅带个人 JWT 访问 /api/ml/vf/check/v2 被 403 拦截
      const userRes = await fetch(`${baseUrl}/api/ml/vf/check/v2`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ordinary-user-jwt-token',
        },
        body: JSON.stringify({ items: [{ postId: 'p1', content: 'test' }] }),
      });
      expect(userRes.status).toBe(403);

      // 携带合法 Ops Token 但下游故障时返回 503 且 safe: false（绝不 Fail-Open）
      const opsRes = await fetch(`${baseUrl}/api/ml/vf/check/v2`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ops-token': 'strict-ops-secret-2026',
        },
        body: JSON.stringify({ items: [{ postId: 'p1', content: 'test' }] }),
      });
      expect(opsRes.status).toBe(503);
      const body = await opsRes.json();
      expect(body.safe).toBe(false);
      expect(body.results[0].safe).toBe(false);
    } finally {
      await closeTestServer(server);
    }
  });

  it('实时会话从共享 Redis 消除脑裂、校验上传相对路径、拦截非法群 UUID 并降级 go_primary 推流异常', async () => {
    // 1. 验证 bootstrapService 在 socketTerminator=rust 时读取共享 Redis 会话
    process.env.GATEWAY_REALTIME_ROLLOUT_STAGE = 'rust_edge_primary';
    process.env.GATEWAY_REALTIME_SOCKET_TERMINATOR = 'rust';
    vi.spyOn(updateService, 'getUpdateId').mockResolvedValue(88);
    vi.spyOn(updateService, 'getAckPts').mockResolvedValue(85);
    vi.spyOn(redis, 'smembers').mockImplementation(async (key: any) =>
      String(key).startsWith('rt:user_sessions:') ? ['sid-rust-1'] : [],
    );
    vi.spyOn(redis, 'mget').mockResolvedValue([
      JSON.stringify({
        session_id: 'sid-rust-1',
        user_id: 'demo-user-1',
        authenticated: true,
        rooms: ['user:demo-user-1', '15776659-176c-4a97-8146-c6a24d85fb96'],
      }),
    ]);

    const bootstrap = await buildRealtimeBootstrapPayload('demo-user-1');
    expect(bootstrap.runtime.socketTerminator).toBe('rust');
    expect(bootstrap.session.online).toBe(true);
    expect(bootstrap.session.connectedSockets).toBe(1);
    expect(bootstrap.session.authenticatedSockets).toBe(1);
    expect(bootstrap.session.roomSubscriptions).toBe(2);

    // 2. 验证 sendMessageSchema 支持 /api/uploads/ 安全路径并拒绝路径穿越
    expect(
      sendMessageSchema.safeParse({
        chatType: 'private',
        receiverId: 'u2',
        type: 'image',
        fileUrl: '/api/uploads/images/photo-1.png',
        thumbnailUrl: '/api/uploads/thumbnails/thumb-1.jpg',
        attachments: [{ fileUrl: '/api/uploads/images/photo-1.png', mimeType: 'image/png' }],
      }).success,
    ).toBe(true);

    expect(
      sendMessageSchema.safeParse({
        chatType: 'private',
        receiverId: 'u2',
        type: 'file',
        fileUrl: '/api/uploads/../secrets/env',
      }).success,
    ).toBe(false);

    // 3. 验证 CORS 与未匹配路由指标保护
    expect(isOriginAllowed('https://telegram-preview-123.vercel.app')).toBe(true);
    expect(isOriginAllowed('https://evil-phishing.vercel.app')).toBe(false);
    expect(isOriginAllowed('http://telegram-preview-123.vercel.app')).toBe(false);
    expect(routeKeyOf({ method: 'get', path: '/api/random/scan/999999' } as any)).toBe(
      'GET UNMATCHED_ROUTE',
    );

    // 4. 验证 updateService 兼容 Go batch 唤醒格式
    expect(
      updateService.parseWakePayloads(
        JSON.stringify({
          updates: [
            { userId: 'u1', updateId: 10 },
            { userId: 'u1', updateId: 14 },
            { userId: 'u2', updateId: 7 },
          ],
        }),
      ),
    ).toEqual([
      { userId: 'u1', updateId: 14 },
      { userId: 'u2', updateId: 7 },
    ]);

    // 5. 验证 go_primary 推入 Redis Stream 失败时立即降级执行 sync_fallback 投影
    process.env.DELIVERY_EXECUTION_MODE = 'go_primary';
    process.env.DELIVERY_GO_PRIMARY_READY = 'true';
    process.env.DELIVERY_GO_PRIMARY_PRIVATE_ENABLED = 'true';

    const markSyncFallbackCompleted = vi.fn().mockResolvedValue(undefined);
    const projector = vi.fn().mockResolvedValue({ recipientCount: 2, chunkCount: 1 });
    const bus = new ChatFanoutCommandBus({
      projector,
      mirror: vi.fn().mockResolvedValue(undefined),
      eventPublisher: {
        publish: vi.fn().mockRejectedValue(new Error('redis_xadd_failed')),
      } as any,
      outboxService: {
        beginDispatch: vi.fn(async (_cmd: any, chunks: any[]) => ({
          outboxId: 'outbox-go-fail-1',
          chunkCommands: chunks,
        })),
        markGoPrimaryQueued: vi.fn().mockResolvedValue(undefined),
        markSyncFallbackCompleted,
      } as any,
    });

    const dispatch = await bus.dispatch(
      buildMessageFanoutCommand({
        messageId: 'msg-go-fallback',
        chatId: 'p:u1:u2',
        chatType: 'private',
        seq: 3,
        senderId: 'u1',
        recipientIds: ['u1', 'u2'],
      }),
    );
    expect(dispatch.mode).toBe('sync_fallback');
    expect(projector).toHaveBeenCalledTimes(1);
    expect(markSyncFallbackCompleted).toHaveBeenCalledWith(
      'outbox-go-fail-1',
      { recipientCount: 2, chunkCount: 1 },
      'redis_xadd_failed',
    );
  });

  it('群组路由拦截 g:invalid-probe-id 返回 400、状态卡片缓存脱敏且同步路由孤儿空洞安全对齐游标', async () => {
    process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-contract-suite';
    const { generateAccessToken } = await import('../../src/utils/jwt');
    const token = generateAccessToken({
      userId: '00000000-0000-4000-8000-000000000001',
      username: 'tester',
    });

    const { cacheService } = await import('../../src/services/cacheService');
    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(true as any);

    const User = (await import('../../src/models/User')).default;
    vi.spyOn(User, 'findByPk').mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      username: 'tester',
      toJSON: () => ({
        id: '00000000-0000-4000-8000-000000000001',
        username: 'tester',
      }),
    } as any);

    const dailyRefreshModule = await import('../../src/services/ops/recommendation/dailyRefreshOps');
    const dailyRefreshSpy = vi
      .spyOn(dailyRefreshModule, 'buildDailyRecommendationRefreshOps')
      .mockResolvedValue({
        status: 'failed',
        lastRefreshAt: '2026-11-18T00:00:00.000Z',
        latestRun: {
          startedAt: '2026-11-18T00:00:00.000Z',
          finishedAt: '2026-11-18T00:01:00.000Z',
          durationMs: 60000,
          trigger: 'cron',
          error: 'MongoNetworkError: sensitive internal connection stack trace',
        },
        users: { registered: 10, vectors: 10, refreshed: 10, compatibleDenseVectorRatio: 1 },
        realGraph: { edges: 20, predicted: 20 },
        posts: { snapshots: 30, refreshed: 30 },
        artifacts: { usersExported: 0, postsExported: 0, clustersExported: 0 },
        embeddingEvidence: { status: 'unavailable' },
        schedule: { label: 'daily', cron: '0 2 * * *' },
        freshnessWindow: { hours: 24, since: '2026-11-17T00:00:00.000Z' },
      });

    const groupRoutes = (await import('../../src/routes/groupRoutes')).default;
    const recommendationStatusModule = await import('../../src/routes/space/recommendationStatus');
    recommendationStatusModule.clearSpaceRecommendationStatusCache();

    const app = express();
    app.use(express.json());
    app.use('/api/groups', groupRoutes);
    app.use('/api/space', recommendationStatusModule.default);

    const syncRouter = (await import('../../src/routes/sync')).default;
    app.use(
      '/api/sync-test',
      (req: any, _res, next) => {
        req.user = { id: 'sync-hole-user' };
        next();
      },
      syncRouter,
    );

    const { server, baseUrl } = await startTestServer(app);
    try {
      const invalidGroupRes = await fetch(`${baseUrl}/api/groups/g:invalid-probe-id`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(invalidGroupRes.status).toBe(400);
      const invalidGroupBody = await invalidGroupRes.json();
      expect(invalidGroupBody.error.code).toBe('BAD_REQUEST');

      // 连续两次请求 /api/space/recommendation/daily-refresh：仅查库 1 次且脱敏敏感堆栈
      const statusRes1 = await fetch(`${baseUrl}/api/space/recommendation/daily-refresh`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const statusRes2 = await fetch(`${baseUrl}/api/space/recommendation/daily-refresh`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(statusRes1.status).toBe(200);
      expect(statusRes2.status).toBe(200);
      expect(dailyRefreshSpy).toHaveBeenCalledTimes(1);
      const statusBody = await statusRes1.json();
      expect(statusBody.data.latestRun.error).toBe('refresh_job_degraded');

      // 模拟 serverPts=50 > clientPts=49 但日志表永久为空洞：不应 0ms 返回 isLatest:false，而应经 waitForUpdate 后对齐 pts=50
      vi.spyOn(updateService, 'getUpdateId').mockResolvedValue(50);
      vi.spyOn(updateService, 'getUpdates').mockResolvedValue({ updates: [], lastUpdateId: 49 });
      const waitSpy = vi
        .spyOn(updateService, 'waitForUpdate')
        .mockResolvedValue({ updateId: null, wakeSource: 'timeout' });

      const syncRes = await fetch(`${baseUrl}/api/sync-test/updates?pts=49&timeout=200`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(syncRes.status).toBe(200);
      const syncBody = await syncRes.json();
      expect(waitSpy).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000001',
        50,
        200,
      );
      expect(syncBody.data.state.pts).toBe(50);
      expect(syncBody.data.isLatest).toBe(true);
    } finally {
      await closeTestServer(server);
    }
  });
});
