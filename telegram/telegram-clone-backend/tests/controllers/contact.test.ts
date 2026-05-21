import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

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
  default: { find: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: { find: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/models/Message', () => ({
  default: { aggregate: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/config/db', () => ({
  waitForMongoReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/chat', () => ({
  buildPrivateChatId: vi.fn((a: string, b: string) => `p:${a}:${b}`),
}));

vi.mock('../../src/middleware/errorHandler', () => ({
  catchAsync: vi.fn((fn) => fn),
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
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

    it('should proceed when contactId is missing (Zod validates at route level)', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: {} });
      const res = createMockResponse();
      await addContact(req, res);
      // Without Zod, controller proceeds → User.findByPk(undefined) returns null → 404
      expect(res._statusCode).toBe(404);
    });

    it('should return 400 if trying to add self', async () => {
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: { contactId: 'user1' } });
      const res = createMockResponse();
      await addContact(req, res);
      expect(res._statusCode).toBe(400);
    });

    it('should return 404 if contact user not found', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: { contactId: 'nonexistent' } });
      const res = createMockResponse();
      await addContact(req, res);
      expect(res._statusCode).toBe(404);
    });

    it('should return 409 if contact already accepted', async () => {
      const Contact = (await import('../../src/models/Contact')).default;
      (Contact.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'existing', status: 'accepted' });
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: { contactId: 'user2' } });
      const res = createMockResponse();
      await addContact(req, res);
      expect(res._statusCode).toBe(409);
    });

    it('should return 409 if contact request already pending', async () => {
      const Contact = (await import('../../src/models/Contact')).default;
      (Contact.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'existing', status: 'pending' });
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: { contactId: 'user2' } });
      const res = createMockResponse();
      await addContact(req, res);
      expect(res._statusCode).toBe(409);
    });

    it('should return 201 on successful contact request', async () => {
      const Contact = (await import('../../src/models/Contact')).default;
      (Contact.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const { addContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: { contactId: 'user2' } });
      const res = createMockResponse();
      await addContact(req, res);
      expect(res._statusCode).toBe(201);
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
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, query: {} });
      const res = createMockResponse();
      await getContacts(req, res);
      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.any(Array),
      }));
    });

    it('should gracefully degrade when MongoDB is unavailable', async () => {
      const { waitForMongoReady } = await import('../../src/config/db');
      (waitForMongoReady as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Mongo not ready'));
      const { getContacts } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, query: {} });
      const res = createMockResponse();
      await getContacts(req, res);
      expect(res._statusCode).toBe(200);
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
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' } });
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

    it('should return 404 if action is invalid (Zod validates at route level)', async () => {
      const { handleContactRequest } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { requestId: 'req123' }, body: { action: 'invalid' } });
      const res = createMockResponse();
      await handleContactRequest(req, res);
      // Without Zod, invalid action passes through → Contact.findOne returns null → 404
      expect(res._statusCode).toBe(404);
    });

    it('should return 200 on successful accept', async () => {
      const Contact = (await import('../../src/models/Contact')).default;
      const mockAccept = vi.fn().mockResolvedValue(undefined);
      (Contact.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'contact123', contactId: 'user1', status: 'pending', accept: mockAccept,
        toJSON: () => ({ id: 'contact123', status: 'accepted' }),
      });
      const { handleContactRequest } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { requestId: 'contact123' }, body: { action: 'accept' } });
      const res = createMockResponse();
      await handleContactRequest(req, res);
      expect(mockAccept).toHaveBeenCalled();
      expect(res._statusCode).toBe(200);
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

    it('should return 404 if contact not found', async () => {
      const Contact = (await import('../../src/models/Contact')).default;
      (Contact.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const { removeContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { contactId: 'nonexistent' } });
      const res = createMockResponse();
      await removeContact(req, res);
      expect(res._statusCode).toBe(404);
    });

    it('should return 200 on successful removal', async () => {
      const Contact = (await import('../../src/models/Contact')).default;
      (Contact.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'contact123', userId: 'user1', contactId: 'user2', status: 'accepted',
      });
      const { removeContact } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { contactId: 'contact123' } });
      const res = createMockResponse();
      await removeContact(req, res);
      expect(res._statusCode).toBe(200);
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

    it('should return 200 if query is too short (Zod validates at route level)', async () => {
      const { searchUsers } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, query: { query: 'a' } });
      const res = createMockResponse();
      await searchUsers(req, res);
      // Without Zod, short query passes through → DB search returns results → 200
      expect(res._statusCode).toBe(200);
    });

    it('should return 200 with search results', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'user3', username: 'alice', email: 'alice@example.com', toJSON: () => ({ id: 'user3', username: 'alice', email: 'alice@example.com' }) },
      ]);
      const { searchUsers } = await import('../../src/controllers/contactController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, query: { query: 'ali' } });
      const res = createMockResponse();
      await searchUsers(req, res);
      expect(res._statusCode).toBe(200);
    });
  });
});
