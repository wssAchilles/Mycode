import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import RealGraphEdge from '../../src/models/RealGraphEdge';
import { MongoGenerationRepository } from '../../src/services/graphKernel/generation/repository';

const mocks = vi.hoisted(() => ({
  legacyPage: vi.fn(),
  generationPage: vi.fn(),
  releaseLease: vi.fn(),
}));

vi.mock('../../src/services/graphKernel/snapshotService', () => ({
  GraphKernelSnapshotVersionMismatchError: class extends Error {},
  graphKernelSnapshotService: { getSnapshotPage: mocks.legacyPage },
}));

vi.mock('../../src/services/graphKernel/generation/service', () => ({
  GenerationLeaseError: class GenerationLeaseError extends Error {},
  GenerationUnavailableError: class GenerationUnavailableError extends Error {},
  graphKernelGenerationService: {
    pageGeneration: mocks.generationPage,
    releaseGenerationLease: mocks.releaseLease,
  },
}));

import {
  GenerationLeaseError,
} from '../../src/services/graphKernel/generation/service';
import graphKernelInternalRouter from '../../src/routes/graphKernelInternal';

const pagePayload = {
  generationId: `graph_generation_v2:${'a'.repeat(64)}`,
  leaseId: 'lease-1',
  expiresAt: 10_000,
  manifest: {
    generationId: `graph_generation_v2:${'a'.repeat(64)}`,
    contentVersion: `sha256:${'a'.repeat(64)}`,
    status: 'ready',
    edgeCount: 1,
    canonicalSha256: 'a'.repeat(64),
    createdAt: 1_000,
  },
  edges: [{
    sourceUserId: 'source',
    targetUserId: 'target',
    edgeId: 'opaque-edge-id',
    decayedSum: 1,
    interactionProbability: 0.5,
    dailySignalCounts: {},
    rollupSignalCounts: {},
    edgeKinds: ['follow'],
    lastInteractionAtMs: null,
    updatedAtMs: 1,
  }],
  nextCursor: null,
  done: true,
};

describe('graph generation route contract', () => {
  let server: Server;
  let baseUrl = '';
  const originalEnv = {
    graphToken: process.env.GRAPH_KERNEL_INTERNAL_TOKEN,
    recommendationToken: process.env.RECOMMENDATION_INTERNAL_TOKEN,
    nodeEnv: process.env.NODE_ENV,
  };

  beforeAll(async () => {
    delete process.env.GRAPH_KERNEL_INTERNAL_TOKEN;
    delete process.env.RECOMMENDATION_INTERNAL_TOKEN;
    process.env.NODE_ENV = 'test';
    const app = express();
    app.use(express.json());
    app.use('/internal/graph-kernel', graphKernelInternalRouter);
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ success: false, error: { message: error.message } });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_bind_failed');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.legacyPage.mockResolvedValue({ edges: [], offset: 0, limit: 1, done: true });
    mocks.generationPage.mockResolvedValue(pagePayload);
    mocks.releaseLease.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    )));
    restoreEnv('GRAPH_KERNEL_INTERNAL_TOKEN', originalEnv.graphToken);
    restoreEnv('RECOMMENDATION_INTERNAL_TOKEN', originalEnv.recommendationToken);
    restoreEnv('NODE_ENV', originalEnv.nodeEnv);
  });

  it('keeps the legacy offset request unchanged', async () => {
    const response = await post('/snapshot', { offset: 17, limit: 2, minScore: 0.1 });

    expect(response.status).toBe(200);
    expect(mocks.legacyPage).toHaveBeenCalledWith(expect.objectContaining({
      offset: 17,
      limit: 2,
      minScore: 0.1,
    }));
  });

  it('strictly rejects offset and distinguishes first from continuation pages', async () => {
    const rejected = await post('/snapshot/generation/page', { limit: 1, offset: 0 });
    expect(rejected.status).toBe(422);
    expect(mocks.generationPage).not.toHaveBeenCalled();

    const first = await post('/snapshot/generation/page', { limit: 1 });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, data: pagePayload });
    expect(mocks.generationPage).toHaveBeenLastCalledWith({ limit: 1 });

    const cursor = {
      generationId: pagePayload.generationId,
      afterSourceUserId: 'source',
      afterTargetUserId: 'target',
      afterEdgeId: 'opaque-edge-id',
    };
    const continuation = await post('/snapshot/generation/page', {
      limit: 1,
      leaseId: 'lease-1',
      cursor,
    });
    expect(continuation.status).toBe(200);
    expect(mocks.generationPage).toHaveBeenLastCalledWith({
      limit: 1,
      leaseId: 'lease-1',
      cursor,
    });
  });

  it('fails closed for wrong-generation or expired leases', async () => {
    mocks.generationPage.mockRejectedValueOnce(
      new GenerationLeaseError('generation_lease_invalid_or_expired'),
    );

    const response = await post('/snapshot/generation/page', {
      limit: 1,
      leaseId: 'wrong-lease',
      cursor: {
        generationId: `graph_generation_v2:${'b'.repeat(64)}`,
        afterSourceUserId: 'source',
        afterTargetUserId: 'target',
        afterEdgeId: 'edge',
      },
    });

    expect(response.status).toBe(409);
    expect((await response.json()).success).toBe(false);
  });

  it('forwards unexpected generation failures to Express error handling', async () => {
    mocks.generationPage.mockRejectedValueOnce(new Error('generation_storage_failed'));

    const response = await post('/snapshot/generation/page', { limit: 1 });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: { message: 'generation_storage_failed' },
    });
  });

  it('strictly releases the named generation lease', async () => {
    const response = await post('/snapshot/generation/release', {
      generationId: pagePayload.generationId,
      leaseId: 'lease-1',
    });

    expect(response.status).toBe(200);
    expect(mocks.releaseLease).toHaveBeenCalledWith(pagePayload.generationId, 'lease-1');
    expect(await response.json()).toEqual({
      success: true,
      data: { generationId: pagePayload.generationId, leaseId: 'lease-1', released: true },
    });
  });

  it('reads the full source snapshot through the required session keyset query', async () => {
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => operation()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const query = {} as Record<string, ReturnType<typeof vi.fn>>;
    for (const method of ['select', 'sort', 'collation', 'session', 'limit', 'skip']) {
      query[method] = vi.fn(() => query);
    }
    query.lean = vi.fn().mockResolvedValue([]);
    const find = vi.spyOn(RealGraphEdge, 'find').mockReturnValue(query as never);

    await expect(new MongoGenerationRepository().readSourceSnapshotEdges()).resolves.toEqual([]);

    expect(find).toHaveBeenCalledWith({ decayedSum: { $gte: 0 } });
    expect(query.sort).toHaveBeenCalledWith({ sourceUserId: 1, targetUserId: 1, _id: 1 });
    expect(query.collation).toHaveBeenCalledWith({ locale: 'simple' });
    expect(query.session).toHaveBeenCalledWith(session);
    expect(query.skip).not.toHaveBeenCalled();
    expect(session.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { readConcern: { level: 'snapshot' } },
    );
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  async function post(route: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/internal/graph-kernel${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
