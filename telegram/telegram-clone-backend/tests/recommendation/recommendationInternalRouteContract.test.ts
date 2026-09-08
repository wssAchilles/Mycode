import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import recommendationInternalRouter from '../../src/routes/recommendationInternal';
import { recommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';

const query = {
  requestId: 'request-route-contract',
  decisionId: '0563d721-b38c-44a2-afc6-f0a52ebde0fa',
  userId: 'viewer-route-contract',
  limit: 1,
  inNetworkOnly: false,
  seenIds: [],
  servedIds: [],
  isBottomRequest: false,
};

describe('recommendation internal route contract', () => {
  let server: Server;
  let baseUrl = '';
  const originalToken = process.env.RECOMMENDATION_INTERNAL_TOKEN;

  beforeAll(async () => {
    process.env.RECOMMENDATION_INTERNAL_TOKEN = 'route-contract-token';
    const app = express();
    app.use(express.json());
    app.use('/internal/recommendation', recommendationInternalRouter);
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
    vi.restoreAllMocks();
  });

  const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer route-contract-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    )));
    if (originalToken === undefined) delete process.env.RECOMMENDATION_INTERNAL_TOKEN;
    else process.env.RECOMMENDATION_INTERNAL_TOKEN = originalToken;
  });

  it('forwards unexpected adapter rejections to the structured error middleware', async () => {
    vi.spyOn(recommendationAdapterService, 'retrieveCandidates')
      .mockRejectedValueOnce(new Error('retrieval_storage_failed'));

    const response = await post('/internal/recommendation/retrieval', query);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: { message: 'retrieval_storage_failed' },
    });
  });

  it.each(['not-a-date', '0'] as const)('rejects an invalid cursor before retrieval: %s', async (cursor) => {
    const retrieve = vi.spyOn(recommendationAdapterService, 'retrieveCandidates');
    const response = await post('/internal/recommendation/retrieval', { ...query, cursor });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('keeps unknown query hydrator requests as structured 404 responses', async () => {
    const response = await post('/internal/recommendation/query-hydrators/batch', {
      hydratorNames: ['MissingQueryHydrator'],
      query,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: 'UNKNOWN_QUERY_HYDRATOR',
        message: 'unknown_query_hydrator:MissingQueryHydrator',
      },
    });
  });

  it('forwards unexpected query hydrator failures to the global error middleware', async () => {
    vi.spyOn(recommendationAdapterService, 'hydrateQueryPatches')
      .mockRejectedValueOnce(new Error('query_hydrator_storage_failed'));

    const response = await post('/internal/recommendation/query-hydrators/batch', {
      hydratorNames: ['UserFeaturesQueryHydrator'],
      query,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: { message: 'query_hydrator_storage_failed' },
    });
  });

  it('keeps unknown source requests as structured 404 responses', async () => {
    const response = await post('/internal/recommendation/sources/UnknownSource', query);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: 'UNKNOWN_SOURCE',
        message: 'unknown_source:UnknownSource',
      },
    });
  });

  it('forwards unexpected source batch failures to the global error middleware', async () => {
    vi.spyOn(recommendationAdapterService, 'getSourceCandidatesBatch')
      .mockRejectedValueOnce(new Error('source_storage_failed'));

    const response = await post('/internal/recommendation/sources/batch', {
      sourceNames: ['PopularSource'],
      query,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: { message: 'source_storage_failed' },
    });
  });
});
