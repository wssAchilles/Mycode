import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  findByPk: vi.fn(),
}));

vi.mock('../../src/utils/jwt', () => ({
  verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock('../../src/services/cacheService', () => ({
  cacheService: {
    get: mocks.cacheGet,
    set: mocks.cacheSet,
  },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findByPk: mocks.findByPk,
  },
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const ORIGINAL_SECRET = process.env.CRON_SECRET;

describe('authenticateToken no longer honors CRON_SECRET as Bearer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-bearer-secret';
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
  });

  it('rejects Authorization: Bearer $CRON_SECRET with 401', async () => {
    const { authenticateToken } = await import('../../src/middleware/authMiddleware');

    mocks.verifyAccessToken.mockRejectedValue(
      Object.assign(new Error('jwt malformed'), { name: 'JsonWebTokenError' })
    );

    const req = createMockRequest({
      headers: { authorization: 'Bearer cron-bearer-secret' },
    }) as Request;
    const res = createMockResponse() as Response & { _statusCode: number };
    const next = vi.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(res._statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
    // must not short-circuit into JWT-less system-crawler path
    expect(mocks.verifyAccessToken).toHaveBeenCalledWith('cron-bearer-secret');
  });

  it('rejects ?token=$CRON_SECRET query bypass with 401', async () => {
    const { authenticateToken } = await import('../../src/middleware/authMiddleware');

    mocks.verifyAccessToken.mockRejectedValue(
      Object.assign(new Error('jwt malformed'), { name: 'JsonWebTokenError' })
    );

    const req = createMockRequest({
      headers: {},
      query: { token: 'cron-bearer-secret' },
    }) as Request;
    const res = createMockResponse() as Response & { _statusCode: number };
    const next = vi.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(res._statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });
});
