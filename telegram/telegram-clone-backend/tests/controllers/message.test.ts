import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

// Mock dependencies
vi.mock('../../src/models/Message', () => ({
  default: {
    find: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]), sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) }),
    findById: vi.fn().mockResolvedValue(null),
    countDocuments: vi.fn().mockResolvedValue(0),
    markAsRead: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    aggregate: vi.fn().mockResolvedValue([]),
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
    findAll: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: {
    find: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn().mockResolvedValue({}),
    countDocuments: vi.fn().mockResolvedValue(0),
    deleteOne: vi.fn().mockResolvedValue({}),
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
  getLegacyEndpointUsageSnapshot: vi.fn().mockReturnValue({ conversation: { totalCalls: 0 }, group: { totalCalls: 0 } }),
  recordLegacyEndpointCall: vi.fn(),
}));

vi.mock('../../src/services/legacyRouteGovernance', () => ({
  evaluateLegacyRouteGovernanceFromEnv: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/utils/chat', () => ({
  buildGroupChatId: vi.fn((id: string) => `g:${id}`),
  buildPrivateChatId: vi.fn((a: string, b: string) => `p:${a}:${b}`),
  getPrivateOtherUserId: vi.fn((chatId: string, userId: string) => 'user2'),
  parseChatId: vi.fn().mockReturnValue({ type: 'private', userIds: ['user1', 'user2'] }),
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

    it('should return 400 if both beforeSeq and afterSeq are provided', async () => {
      const { getChatMessages } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { chatId: 'p:user1:user2' },
        query: { beforeSeq: '10', afterSeq: '5' },
      });
      const res = createMockResponse();

      await getChatMessages(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 200 with messages for valid request', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.find as ReturnType<typeof vi.fn>).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([
              { _id: 'msg1', content: 'hello', sender: 'user1', seq: 1, chatId: 'p:user1:user2' },
            ]),
          }),
        }),
      });

      const { getChatMessages } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { chatId: 'p:user1:user2' },
        query: { limit: '20' },
      });
      const res = createMockResponse();

      await getChatMessages(req, res);

      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          messages: expect.any(Array),
        }),
      }));
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

    it('should proceed when chatType is invalid (Zod validates at route level)', async () => {
      const { sendMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: { chatType: 'invalid', content: 'hello' },
      });
      const res = createMockResponse();

      await sendMessage(req, res);

      // Without Zod, invalid chatType passes through → neither private nor group path
      // → no receiver/group validation → message created → 201
      expect(res._statusCode).toBe(201);
    });

    it('should return 404 if content and fileUrl are both missing (Zod validates at route level)', async () => {
      const { sendMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: { chatType: 'private', receiverId: 'user2' },
      });
      const res = createMockResponse();

      await sendMessage(req, res);

      // Without Zod, empty content passes through → receiver lookup returns null → 404
      expect(res._statusCode).toBe(404);
    });

    it('should return 201 on successful message send', async () => {
      const User = (await import('../../src/models/User')).default;
      (User.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'user2', username: 'receiver',
      });

      const { sendMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: { chatType: 'private', receiverId: 'user2', content: 'Hello' },
      });
      const res = createMockResponse();

      await sendMessage(req, res);

      expect(res._statusCode).toBe(201);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
      }));
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

    it('should return 200 on successful mark as read', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.markAsRead as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ modifiedCount: 2 });
      (Message.find as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([
          { _id: 'msg1', chatId: 'p:user1:user2', sender: 'user1', receiver: 'user2', seq: 1 },
          { _id: 'msg2', chatId: 'p:user1:user2', sender: 'user1', receiver: 'user2', seq: 2 },
        ]),
      });

      const { markMessagesAsRead } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: { messageIds: ['msg1', 'msg2'] },
      });
      const res = createMockResponse();

      await markMessagesAsRead(req, res);

      expect(res._statusCode).toBe(200);
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

    it('should return 404 if message not found', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { deleteMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { messageId: 'nonexistent' },
      });
      const res = createMockResponse();

      await deleteMessage(req, res);

      expect(res._statusCode).toBe(404);
    });

    it('should return 403 if user is not the sender', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        _id: 'msg123',
        sender: 'user2',
        softDelete: vi.fn().mockResolvedValue(undefined),
      });

      const { deleteMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { messageId: 'msg123' },
      });
      const res = createMockResponse();

      await deleteMessage(req, res);

      expect(res._statusCode).toBe(403);
    });

    it('should return 200 on successful delete', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        _id: 'msg123',
        sender: 'user1',
        softDelete: vi.fn().mockResolvedValue(undefined),
      });

      const { deleteMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { messageId: 'msg123' },
      });
      const res = createMockResponse();

      await deleteMessage(req, res);

      expect(res._statusCode).toBe(200);
    });
  });

  describe('editMessage', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { editMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: undefined, params: {}, body: {} });
      const res = createMockResponse();

      await editMessage(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if messageId or content is missing', async () => {
      const { editMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: {},
        body: {},
      });
      const res = createMockResponse();

      await editMessage(req, res);

      expect(res._statusCode).toBe(400);
    });

    it('should return 404 if message not found', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { editMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { messageId: 'nonexistent' },
        body: { content: 'edited' },
      });
      const res = createMockResponse();

      await editMessage(req, res);

      expect(res._statusCode).toBe(404);
    });

    it('should return 403 if user is not the sender', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        _id: 'msg123',
        sender: 'user2',
        editContent: vi.fn().mockResolvedValue(undefined),
      });

      const { editMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { messageId: 'msg123' },
        body: { content: 'edited' },
      });
      const res = createMockResponse();

      await editMessage(req, res);

      expect(res._statusCode).toBe(403);
    });

    it('should return 200 on successful edit', async () => {
      const Message = (await import('../../src/models/Message')).default;
      (Message.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        _id: 'msg123',
        sender: 'user1',
        editContent: vi.fn().mockResolvedValue({
          _id: 'msg123',
          content: 'edited',
          edited: true,
          editedAt: new Date(),
        }),
      });

      const { editMessage } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { messageId: 'msg123' },
        body: { content: 'edited' },
      });
      const res = createMockResponse();

      await editMessage(req, res);

      expect(res._statusCode).toBe(200);
    });
  });

  describe('searchMessages', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { searchMessages } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await searchMessages(req, res);

      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if keyword is too short', async () => {
      const { searchMessages } = await import('../../src/controllers/messageController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        query: { keyword: 'a' },
      });
      const res = createMockResponse();

      await searchMessages(req, res);

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

  describe('legacy endpoints', () => {
    it('getConversation should return 404 Gone with deprecation headers', async () => {
      const { getConversation } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { receiverId: 'user2' } });
      const res = createMockResponse();

      await getConversation(req, res);

      expect(res._statusCode).toBe(404);
      expect(res._headers).toHaveProperty('Deprecation', 'true');
      expect(res._headers).toHaveProperty('Sunset');
    });

    it('getGroupMessages should return 404 Gone with deprecation headers', async () => {
      const { getGroupMessages } = await import('../../src/controllers/messageController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group1' } });
      const res = createMockResponse();

      await getGroupMessages(req, res);

      expect(res._statusCode).toBe(404);
      expect(res._headers).toHaveProperty('Deprecation', 'true');
    });
  });
});
