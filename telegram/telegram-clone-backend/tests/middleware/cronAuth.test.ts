import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

const ORIGINAL_SECRET = process.env.CRON_SECRET;

async function loadMiddleware() {
  vi.resetModules();
  return import('../../src/middleware/cronAuth');
}

function createPair(overrides: Record<string, unknown> = {}) {
  const req = createMockRequest(overrides) as Request;
  const res = createMockResponse() as Response & {
    _statusCode: number;
    _jsonBody: unknown;
  };
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('requireCronSecret', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
  });

  it('returns 401 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const { requireCronSecret } = await loadMiddleware();
    const { req, res, next } = createPair({
      headers: { 'x-cron-secret': 'whatever' },
    });

    requireCronSecret(req, res, next);

    expect(res._statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when x-cron-secret header is missing', async () => {
    process.env.CRON_SECRET = 'super-secret';
    const { requireCronSecret } = await loadMiddleware();
    const { req, res, next } = createPair({ headers: {} });

    requireCronSecret(req, res, next);

    expect(res._statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when secret mismatches', async () => {
    process.env.CRON_SECRET = 'super-secret';
    const { requireCronSecret } = await loadMiddleware();
    const { req, res, next } = createPair({
      headers: { 'x-cron-secret': 'wrong-secret' },
    });

    requireCronSecret(req, res, next);

    expect(res._statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores query-string secret and only accepts the header', async () => {
    process.env.CRON_SECRET = 'super-secret';
    const { requireCronSecret } = await loadMiddleware();
    const { req, res, next } = createPair({
      headers: {},
      query: { 'x-cron-secret': 'super-secret', cronSecret: 'super-secret' },
    });

    requireCronSecret(req, res, next);

    expect(res._statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a matching x-cron-secret and sets system-crawler identity', async () => {
    process.env.CRON_SECRET = 'super-secret';
    const { requireCronSecret } = await loadMiddleware();
    const { req, res, next } = createPair({
      headers: { 'x-cron-secret': 'super-secret' },
    });

    requireCronSecret(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe('system-crawler');
    expect(req.user).toMatchObject({
      id: 'system-crawler',
      username: 'SystemCrawler',
    });
  });

  it('uses a length-safe compare (still matches equal secrets of any length)', async () => {
    process.env.CRON_SECRET = 'a-very-long-cron-secret-value-0123456789';
    const { requireCronSecret } = await loadMiddleware();
    const { req, res, next } = createPair({
      headers: { 'x-cron-secret': 'a-very-long-cron-secret-value-0123456789' },
    });

    requireCronSecret(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe('system-crawler');
  });
});
