import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

// Mock dependencies
vi.mock('../../src/models/Message', () => ({
  default: {
    find: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    countDocuments: vi.fn().mockResolvedValue(0),
    markAsRead: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
  MessageType: { TEXT: 'text', IMAGE: 'image', FILE: 'file' },
  MessageStatus: { SENT: 'sent', DELIVERED: 'delivered', READ: 'read' },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findAll: vi.fn().mockResolvedValue([]),
    findByPk: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/models/Group', () => ({
  default: {
    findByPk: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/models/GroupMember', () => ({
  default: {
    isMember: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: {
    find: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn().mockResolvedValue({}),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../src/models/ChatCounter', () => ({
  default: {
    find: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
  },
}));

vi.mock('../../src/config/db', () => ({
  waitForMongoReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/messageWriteService', () => ({
  createAndFanoutMessage: vi.fn().mockResolvedValue({
    message: {
      _id: 'msg123',
      chatId: 'p:user1:user2',
      content: 'Hello',
      sender: 'user1',
      receiver: 'user2',
      timestamp: new Date(),
      type: 'text',
      seq: 1,
      isGroupChat: false,
    },
  }),
}));

vi.mock('../../src/services/realtimeProtocol/displayPlaneContract', () => ({
  buildRoomMessageDisplayEnvelope: vi.fn().mockReturnValue({}),
  publishRoomMessageDisplay: vi.fn(),
}));

vi.mock('../../src/services/updateService', () => ({
  updateService: {
    appendUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/services/legacyEndpointMetrics', () => ({
  getLegacyEndpointUsageSnapshot: vi.fn().mockReturnValue({}),
  recordLegacyEndpointCall: vi.fn(),
}));

vi.mock('../../src/services/legacyRouteGovernance', () => ({
  evaluateLegacyRouteGovernanceFromEnv: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/utils/chat', () => ({
  buildGroupChatId: vi.fn((id: string) => `g:${id}`),
  buildPrivateChatId: vi.fn((a: string, b: string) => `p:${a}:${b}`),
  getPrivateOtherUserId: vi.fn(),
  parseChatId: vi.fn().mockReturnValue({ type: 'private', userIds: ['user1', 'user2'] }),
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('MessageController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getChatMessages', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { getChatMessages } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();

      await getChatMessages(req, res);

      expect(res._statusCode).toBe(401);
      expect(res._jsonBody).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'UNAUTHORIZED',
          }),
        })
      );
    });

    it('should return 400 if chatId is missing', async () => {
      const { getChatMessages } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: {},
        query: {},
      });
      const res = createMockResponse();

      await getChatMessages(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('sendMessage', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { sendMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await sendMessage(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if chatType is invalid', async () => {
      const { sendMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: { chatType: 'invalid', content: 'hello' },
      });
      const res = createMockResponse();

      await sendMessage(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('markMessagesAsRead', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { markMessagesAsRead } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await markMessagesAsRead(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if messageIds is empty', async () => {
      const { markMessagesAsRead } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: { messageIds: [] },
      });
      const res = createMockResponse();

      await markMessagesAsRead(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('deleteMessage', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { deleteMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: undefined, params: {} });
      const res = createMockResponse();

      await deleteMessage(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if messageId is missing', async () => {
      const { deleteMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: {},
      });
      const res = createMockResponse();

      await deleteMessage(req, res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('getUnreadCount', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { getUnreadCount } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();

      await getUnreadCount(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return unread count for authenticated user', async () => {
      const { getUnreadCount } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
      });
      const res = createMockResponse();

      await getUnreadCount(req, res);

      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toHaveProperty('success', true);
      expect(res._jsonBody).toHaveProperty('data');
      expect(res._jsonBody.data).toHaveProperty('unreadCount');
    });
  });
});
