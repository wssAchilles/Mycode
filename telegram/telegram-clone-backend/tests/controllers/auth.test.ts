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
      avatarUrl: null,
      birthDate: null,
      region: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
}));

vi.mock('../../src/utils/jwt', () => ({
  generateTokenPair: vi.fn().mockReturnValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    refreshJti: 'jti123',
  }),
  verifyRefreshToken: vi.fn().mockResolvedValue({
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
    it('should proceed when username is missing (Zod validates at route level)', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { password: 'password123' } });
      const res = createMockResponse();

      await register(req, res);

      // Controller no longer validates input format — Zod middleware handles this
      expect([200, 201]).toContain(res._statusCode);
    });

    it('should proceed when password is missing (Zod validates at route level)', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'testuser' } });
      const res = createMockResponse();

      await register(req, res);

      expect([200, 201]).toContain(res._statusCode);
    });

    it('should proceed when username is too short (Zod validates at route level)', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'ab', password: 'password123' } });
      const res = createMockResponse();

      await register(req, res);

      expect([200, 201]).toContain(res._statusCode);
    });

    it('should proceed when username is too long (Zod validates at route level)', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'a'.repeat(51), password: 'password123' } });
      const res = createMockResponse();

      await register(req, res);

      expect([200, 201]).toContain(res._statusCode);
    });

    it('should proceed when password is too short (Zod validates at route level)', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'testuser', password: '12345' } });
      const res = createMockResponse();

      await register(req, res);

      expect([200, 201]).toContain(res._statusCode);
    });

    it('should proceed when username has invalid characters (Zod validates at route level)', async () => {
      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'test user!', password: 'password123' } });
      const res = createMockResponse();

      await register(req, res);

      expect([200, 201]).toContain(res._statusCode);
    });

    it('should return 409 if username already exists', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'existing',
        username: 'testuser',
        email: 'other@example.com',
      });

      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'testuser', password: 'password123' } });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(409);
    });

    it('should return 409 if email already exists', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'existing',
        username: 'other',
        email: 'test@example.com',
      });

      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'newuser', password: 'password123', email: 'test@example.com' } });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(409);
    });

    it('should return 201 with tokens on successful registration', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { register } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { username: 'newuser', password: 'password123' } });
      const res = createMockResponse();

      await register(req, res);

      expect(res._statusCode).toBe(201);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          message: '注册成功',
          user: expect.objectContaining({ id: 'user123', username: 'testuser' }),
          tokens: expect.objectContaining({ accessToken: 'access-token' }),
        }),
      }));
    });
  });

  describe('login', () => {
    it('should return 401 if usernameOrEmail is missing (Zod validates at route level)', async () => {
      const { login } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { password: 'password123' } });
      const res = createMockResponse();

      await login(req, res);

      // Without Zod, controller proceeds to DB lookup which returns null → 401
      expect(res._statusCode).toBe(401);
    });

    it('should return 401 if password is missing (Zod validates at route level)', async () => {
      const { login } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { usernameOrEmail: 'testuser' } });
      const res = createMockResponse();

      await login(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 401 if user not found', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { login } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { usernameOrEmail: 'nobody', password: 'password123' } });
      const res = createMockResponse();

      await login(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 401 if password is wrong', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'user123',
        username: 'testuser',
        validatePassword: vi.fn().mockResolvedValue(false),
      });

      const { login } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { usernameOrEmail: 'testuser', password: 'wrong' } });
      const res = createMockResponse();

      await login(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 200 with tokens on successful login', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        avatarUrl: null,
        birthDate: null,
        region: null,
        language: null,
        createdAt: new Date(),
        validatePassword: vi.fn().mockResolvedValue(true),
      });

      const { login } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { usernameOrEmail: 'testuser', password: 'password123' } });
      const res = createMockResponse();

      await login(req, res);

      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          message: '登录成功',
          tokens: expect.objectContaining({ accessToken: 'access-token' }),
        }),
      }));
    });
  });

  describe('refreshToken', () => {
    it('should return 401 if refreshToken is missing (Zod validates at route level)', async () => {
      const { refreshToken } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: {} });
      const res = createMockResponse();

      await refreshToken(req, res);

      // Without Zod, controller proceeds to verify → validate → findByPk returns null → 401
      expect(res._statusCode).toBe(401);
    });

    it('should return 401 if refresh token jti is invalid', async () => {
      const { validateRefreshToken } = await import('../../src/utils/refreshTokenStore');
      (validateRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const { refreshToken } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { refreshToken: 'expired-token' } });
      const res = createMockResponse();

      await refreshToken(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 401 if user no longer exists', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { refreshToken } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { refreshToken: 'valid-token' } });
      const res = createMockResponse();

      await refreshToken(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 200 with new tokens on success', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'user123',
        username: 'testuser',
      });

      const { refreshToken } = await import('../../src/controllers/authController');
      const req = createMockRequest({ body: { refreshToken: 'valid-token' } });
      const res = createMockResponse();

      await refreshToken(req, res);

      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          message: '令牌刷新成功',
          tokens: expect.objectContaining({ accessToken: 'access-token' }),
        }),
      }));
    });
  });

  describe('getCurrentUser', () => {
    it('should return 401 if userId is not set', async () => {
      const { getCurrentUser } = await import('../../src/controllers/authController');
      const req = createMockRequest({ userId: undefined });
      const res = createMockResponse();

      await getCurrentUser(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 404 if user not found', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { getCurrentUser } = await import('../../src/controllers/authController');
      const req = createMockRequest({ userId: 'user123' });
      const res = createMockResponse();

      await getCurrentUser(req, res);

      expect(res._statusCode).toBe(404);
    });

    it('should return 200 with user data', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        avatarUrl: null,
        birthDate: null,
        region: null,
        language: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { getCurrentUser } = await import('../../src/controllers/authController');
      const req = createMockRequest({ userId: 'user123' });
      const res = createMockResponse();

      await getCurrentUser(req, res);

      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          user: expect.objectContaining({ id: 'user123', username: 'testuser' }),
        }),
      }));
    });
  });

  describe('logout', () => {
    it('should return 200 even without userId', async () => {
      const { logout } = await import('../../src/controllers/authController');
      const req = createMockRequest({ userId: undefined });
      const res = createMockResponse();

      await logout(req, res);

      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ message: '已登出' }),
      }));
    });

    it('should revoke refresh token when userId present', async () => {
      const { revokeRefreshToken } = await import('../../src/utils/refreshTokenStore');

      const { logout } = await import('../../src/controllers/authController');
      const req = createMockRequest({ userId: 'user123' });
      const res = createMockResponse();

      await logout(req, res);

      expect(revokeRefreshToken).toHaveBeenCalledWith('user123');
      expect(res._statusCode).toBe(200);
    });
  });
});
