import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

// Mock dependencies
vi.mock('../../src/models/Contact', () => ({
  default: {
    findOne: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 'contact123',
      userId: 'user1',
      contactId: 'user2',
      status: 'pending',
    }),
    findByPk: vi.fn().mockResolvedValue({
      id: 'contact123',
      userId: 'user1',
      contactId: 'user2',
      status: 'pending',
      toJSON: () => ({ id: 'contact123', userId: 'user1', contactId: 'user2', status: 'pending' }),
    }),
    destroy: vi.fn().mockResolvedValue(1),
    findOrCreate: vi.fn().mockResolvedValue([{
      id: 'contact123',
      userId: 'user1',
      contactId: 'user2',
      status: 'blocked',
      save: vi.fn().mockResolvedValue(undefined),
    }, true]),
  },
  ContactStatus: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    BLOCKED: 'blocked',
  },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findByPk: vi.fn().mockResolvedValue({
      id: 'user2',
      username: 'testuser2',
      email: 'test2@example.com',
    }),
    findAll: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/models/ChatCounter', () => ({
  default: {
    find: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: {
    find: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/models/Message', () => ({
  default: {
    aggregate: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/config/db', () => ({
  waitForMongoReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/chat', () => ({
  buildPrivateChatId: vi.fn((a: string, b: string) => `p:${a}:${b}`),
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('ContactController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addContact', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await addContact(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if contactId is missing', async () => {
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: {},
      });
      const res = createMockResponse();

      await addContact(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 400 if trying to add self', async () => {
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: { contactId: 'user1' },
      });
      const res = createMockResponse();

      await addContact(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('getContacts', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { getContacts } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();

      await getContacts(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return contacts for authenticated user', async () => {
      const { getContacts } = await import('../../src/controllers/contactController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        query: {},
      });
      const res = createMockResponse();

      await getContacts(req, res);

      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            contacts: expect.any(Array),
            total: expect.any(Number),
          }),
        })
      );
    });
  });

  describe('getPendingRequests', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { getPendingRequests } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();

      await getPendingRequests(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return pending requests for authenticated user', async () => {
      const { getPendingRequests } = await import('../../src/controllers/contactController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
      });
      const res = createMockResponse();

      await getPendingRequests(req, res);

      expect(res._statusCode).toBe(200);
    });
  });

  describe('handleContactRequest', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { handleContactRequest } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await handleContactRequest(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if action is invalid', async () => {
      const { handleContactRequest } = await import('../../src/controllers/contactController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { requestId: 'req123' },
        body: { action: 'invalid' },
      });
      const res = createMockResponse();

      await handleContactRequest(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('removeContact', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { removeContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: undefined, params: {} });
      const res = createMockResponse();

      await removeContact(req, res);

      expect(res._statusCode).toBe(401);
    });
  });

  describe('searchUsers', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { searchUsers } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await searchUsers(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if query is too short', async () => {
      const { searchUsers } = await import('../../src/controllers/contactController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        query: { query: 'a' },
      });
      const res = createMockResponse();

      await searchUsers(req, res);

      expect(res._statusCode).toBe(400);
    });
  });
});
