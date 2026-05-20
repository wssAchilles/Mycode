import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

// Mock dependencies
vi.mock('../../src/models/User', () => ({
  default: {
    findOne: vi.fn().mockResolvedValue(null),
    findByPk: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: 'user123',
      username: 'testuser',
      email: 'test@example.com',
    }),
  },
}));

vi.mock('../../src/utils/jwt', () => ({
  generateTokenPair: vi.fn().mockReturnValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    refreshJti: 'jti123',
  }),
  verifyRefreshToken: vi.fn().mockReturnValue({
    userId: 'user123',
    jti: 'jti123',
  }),
  getRefreshTtlSeconds: vi.fn().mockReturnValue(604800),
}));

vi.mock('../../src/utils/refreshTokenStore', () => ({
  storeRefreshToken: vi.fn().mockResolvedValue(undefined),
  validateRefreshToken: vi.fn().mockResolvedValue(true),
  revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/middleware/errorHandler', () => ({
  catchAsync: vi.fn((fn) => fn),
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('AuthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should return 400 if username is missing', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: { password: 'password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 400 if password is missing', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: { username: 'testuser' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 400 if username is too short', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: { username: 'ab', password: 'password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 400 if password is too short', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: { username: 'testuser', password: '12345' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 400 if username has invalid characters', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: { username: 'test user!', password: 'password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('login', () => {
    it('should return 400 if username is missing', async () => {
      const { login } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: { password: 'password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 400 if password is missing', async () => {
      const { login } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: { username: 'testuser' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('refreshToken', () => {
    it('should return 400 if refreshToken is missing', async () => {
      const { refreshToken } = await import('../../src/controllers/authController');
      const req = createMockRequest({
        body: {},
      });
      const res = createMockResponse();

      await refreshToken(req, res);

      expect(res._statusCode).toBe(400);
    });
  });
});
