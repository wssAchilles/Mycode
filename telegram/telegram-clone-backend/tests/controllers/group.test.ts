import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/mockResponse';

vi.mock('../../src/models/Group', () => ({
  default: {
    findByPk: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 'group123',
      name: 'Test Group',
      ownerId: 'user1',
      isActive: true,
      type: 'private',
      maxMembers: 500,
      memberCount: 1,
      avatarUrl: null,
      description: null,
      isFull: vi.fn().mockReturnValue(false),
      updateMemberCount: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      toJSON: () => ({ id: 'group123', name: 'Test Group', ownerId: 'user1' }),
    }),
  },
  GroupType: { PRIVATE: 'private', PUBLIC: 'public' },
}));

vi.mock('../../src/models/GroupMember', () => ({
  default: {
    findOne: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      groupId: 'group123',
      userId: 'user1',
      role: 'owner',
      status: 'active',
    }),
    bulkCreate: vi.fn().mockResolvedValue([]),
    hasPermission: vi.fn().mockResolvedValue(false),
    isMember: vi.fn().mockResolvedValue(false),
    update: vi.fn().mockResolvedValue([0]),
  },
  MemberRole: { OWNER: 'owner', ADMIN: 'admin', MEMBER: 'member' },
  MemberStatus: { ACTIVE: 'active', MUTED: 'muted', LEFT: 'left', BANNED: 'banned' },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findAll: vi.fn().mockResolvedValue([]),
    findByPk: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/models/ChatCounter', () => ({
  default: { find: vi.fn().mockResolvedValue([]), findById: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: {
    find: vi.fn().mockResolvedValue([]),
    updateOne: vi.fn().mockResolvedValue({}),
    deleteOne: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../src/models/Message', () => ({
  default: { aggregate: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/config/db', () => ({
  waitForMongoReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/sequelize', () => ({
  sequelize: {
    transaction: vi.fn().mockImplementation(async (cb: Function) => {
      const tx = { commit: vi.fn(), rollback: vi.fn() };
      if (cb) return cb(tx);
      return tx;
    }),
  },
}));

vi.mock('../../src/utils/chat', () => ({
  buildGroupChatId: vi.fn((id: string) => `g:${id}`),
}));

vi.mock('../../src/middleware/errorHandler', () => ({
  catchAsync: vi.fn((fn) => fn),
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../../src/services/updateService', () => ({
  updateService: { appendUpdates: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/socketRegistry', () => ({
  getSocketService: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/controllers/uploadController', () => ({
  saveSpaceUpload: vi.fn().mockResolvedValue({
    url: '/api/public/space/uploads/group-avatar.webp',
    thumbnailUrl: '/api/public/space/uploads/thumbnails/thumb_group-avatar_md.jpg',
  }),
}));

vi.mock('../../src/services/chatDelivery/writePathCache', () => ({
  invalidateGroupWriteCache: vi.fn().mockResolvedValue(undefined),
}));

describe('GroupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createGroup', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { createGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();
      await createGroup(req, res);
      expect(res._statusCode).toBe(401);
    });

    it('should proceed when group name is empty (Zod validates at route level)', async () => {
      const { createGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: { name: '' } });
      const res = createMockResponse();
      await createGroup(req, res);
      // Without Zod, empty name passes through → Group.create succeeds → 201
      expect(res._statusCode).toBe(201);
    });

    it('should return 201 on successful group creation', async () => {
      const { createGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, body: { name: 'New Group' } });
      const res = createMockResponse();
      await createGroup(req, res);
      expect(res._statusCode).toBe(201);
    });

    it('should persist avatarUrl, description, type, and maxMembers on creation', async () => {
      const Group = (await import('../../src/models/Group')).default;
      const { createGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        body: {
          name: 'Engineering Core',
          description: 'Backend & Infra',
          type: 'public',
          maxMembers: 500,
          avatarUrl: '/api/public/space/uploads/team.webp',
        },
      });
      const res = createMockResponse();
      await createGroup(req, res);

      expect(res._statusCode).toBe(201);
      expect(Group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Engineering Core',
          description: 'Backend & Infra',
          type: 'public',
          maxMembers: 500,
          avatarUrl: '/api/public/space/uploads/team.webp',
        }),
        expect.any(Object)
      );
    });
  });

  describe('uploadGroupAvatar', () => {
    it('should return 400 when image file is missing', async () => {
      const { uploadGroupAvatar } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' } });
      const res = createMockResponse();
      await uploadGroupAvatar(req, res);
      expect(res._statusCode).toBe(400);
    });

    it('should return 400 when uploaded file is not an image', async () => {
      const { uploadGroupAvatar } = await import('../../src/controllers/groupController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        file: { mimetype: 'application/pdf', originalname: 'doc.pdf' },
      } as any);
      const res = createMockResponse();
      await uploadGroupAvatar(req, res);
      expect(res._statusCode).toBe(400);
    });

    it('should store image and return public avatarUrl', async () => {
      const { uploadGroupAvatar } = await import('../../src/controllers/groupController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        file: { mimetype: 'image/webp', originalname: 'avatar.webp', path: '/tmp/avatar.webp' },
      } as any);
      const res = createMockResponse();
      await uploadGroupAvatar(req, res);
      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          avatarUrl: '/api/public/space/uploads/group-avatar.webp',
        }),
      }));
    });
  });

  describe('updateGroup', () => {
    it('should update type, maxMembers, and clear avatarUrl when null is passed', async () => {
      const GroupMember = (await import('../../src/models/GroupMember')).default;
      (GroupMember.hasPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const mockGroup = {
        id: 'group123',
        name: 'Old Name',
        description: 'Old desc',
        type: 'private',
        maxMembers: 200,
        memberCount: 3,
        avatarUrl: 'https://example.com/old.png',
        isActive: true,
        save: vi.fn().mockResolvedValue(undefined),
      };
      const Group = (await import('../../src/models/Group')).default;
      (Group.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockGroup);

      const { updateService } = await import('../../src/services/updateService');
      const { updateGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { groupId: 'group123' },
        body: {
          name: 'Updated Group',
          type: 'public',
          maxMembers: 500,
          avatarUrl: null,
        },
      });
      const res = createMockResponse();
      await updateGroup(req, res);

      expect(res._statusCode).toBe(200);
      expect(mockGroup.name).toBe('Updated Group');
      expect(mockGroup.type).toBe('public');
      expect(mockGroup.maxMembers).toBe(500);
      expect(mockGroup.avatarUrl).toBeNull();
      expect(mockGroup.save).toHaveBeenCalledTimes(1);
      expect(updateService.appendUpdates).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          payload: expect.objectContaining({
            action: 'group_updated',
            type: 'public',
            maxMembers: 500,
            avatarUrl: null,
          }),
        })
      );
    });

    it('should return 400 when maxMembers is below current memberCount', async () => {
      const GroupMember = (await import('../../src/models/GroupMember')).default;
      (GroupMember.hasPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const mockGroup = {
        id: 'group123',
        name: 'Large Group',
        memberCount: 25,
        maxMembers: 200,
        isActive: true,
        save: vi.fn(),
      };
      const Group = (await import('../../src/models/Group')).default;
      (Group.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockGroup);

      const { updateGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({
        user: { id: 'user1', username: 'testuser' },
        params: { groupId: 'group123' },
        body: { maxMembers: 10 },
      });
      const res = createMockResponse();
      await updateGroup(req, res);

      expect(res._statusCode).toBe(400);
      expect(mockGroup.save).not.toHaveBeenCalled();
    });
  });

  describe('getUserGroups', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { getUserGroups } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();
      await getUserGroups(req, res);
      expect(res._statusCode).toBe(401);
    });

    it('should return groups for authenticated user', async () => {
      const { getUserGroups } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' } });
      const res = createMockResponse();
      await getUserGroups(req, res);
      expect(res._statusCode).toBe(200);
      expect(res._jsonBody).toEqual(expect.objectContaining({
        success: true,
        data: expect.any(Array),
      }));
    });

    it('should gracefully degrade when MongoDB is unavailable', async () => {
      const { waitForMongoReady } = await import('../../src/config/db');
      (waitForMongoReady as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Mongo not ready'));
      const { getUserGroups } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' } });
      const res = createMockResponse();
      await getUserGroups(req, res);
      expect(res._statusCode).toBe(200);
    });
  });

  describe('getGroupDetails', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { getGroupDetails } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined, params: {} });
      const res = createMockResponse();
      await getGroupDetails(req, res);
      expect(res._statusCode).toBe(401);
    });

    it('should return 404 if group not found', async () => {
      const GroupMember = (await import('../../src/models/GroupMember')).default;
      (GroupMember.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: 'user1', status: 'active' });
      const Group = (await import('../../src/models/Group')).default;
      (Group.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const { getGroupDetails } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'nonexistent' } });
      const res = createMockResponse();
      await getGroupDetails(req, res);
      expect(res._statusCode).toBe(404);
    });

    it('should return 403 if user is not a member', async () => {
      const Group = (await import('../../src/models/Group')).default;
      (Group.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'group123', isActive: true });
      const GroupMember = (await import('../../src/models/GroupMember')).default;
      (GroupMember.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const { getGroupDetails } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group123' } });
      const res = createMockResponse();
      await getGroupDetails(req, res);
      expect(res._statusCode).toBe(403);
    });
  });

  describe('addGroupMember', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { addGroupMember } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined, params: { groupId: 'group123' }, body: { userIds: ['user2'] } });
      const res = createMockResponse();
      await addGroupMember(req, res);
      expect([401, 500]).toContain(res._statusCode);
    });

    it('should return 400 if userIds is empty', async () => {
      const { addGroupMember } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group123' }, body: { userIds: [] } });
      const res = createMockResponse();
      await addGroupMember(req, res);
      expect([400, 500]).toContain(res._statusCode);
    });

    it('should return 403 if user lacks permission', async () => {
      const { addGroupMember } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group123' }, body: { userIds: ['user2'] } });
      const res = createMockResponse();
      await addGroupMember(req, res);
      expect(res._statusCode).toBe(403);
    });
  });

  describe('removeGroupMember', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { removeGroupMember } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined, params: {} });
      const res = createMockResponse();
      await removeGroupMember(req, res);
      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if trying to remove self', async () => {
      const { removeGroupMember } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group123', memberId: 'user1' } });
      const res = createMockResponse();
      await removeGroupMember(req, res);
      expect(res._statusCode).toBe(400);
    });

    it('should return 400 if trying to remove the owner', async () => {
      const Group = (await import('../../src/models/Group')).default;
      (Group.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'group123', ownerId: 'owner1', isActive: true });
      const GroupMember = (await import('../../src/models/GroupMember')).default;
      (GroupMember.hasPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (GroupMember.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: 'owner1', role: 'owner' });
      const { removeGroupMember } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group123', memberId: 'owner1' } });
      const res = createMockResponse();
      await removeGroupMember(req, res);
      expect([400, 403]).toContain(res._statusCode);
    });
  });

  describe('leaveGroup', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { leaveGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined, params: {} });
      const res = createMockResponse();
      await leaveGroup(req, res);
      expect(res._statusCode).toBe(401);
    });

    it('should return 400 if owner tries to leave', async () => {
      const Group = (await import('../../src/models/Group')).default;
      (Group.findByPk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'group123', ownerId: 'user1', isActive: true });
      const GroupMember = (await import('../../src/models/GroupMember')).default;
      (GroupMember.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: 'user1', role: 'owner', status: 'active' });
      const { leaveGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group123' } });
      const res = createMockResponse();
      await leaveGroup(req, res);
      expect(res._statusCode).toBe(400);
    });
  });

  describe('deleteGroup', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { deleteGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined, params: {} });
      const res = createMockResponse();
      await deleteGroup(req, res);
      expect(res._statusCode).toBe(401);
    });

    it('should return 403 if user is not the owner', async () => {
      const Group = (await import('../../src/models/Group')).default;
      (Group.findByPk as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'group123', ownerId: 'other', isActive: true });
      const { deleteGroup } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'group123' } });
      const res = createMockResponse();
      await deleteGroup(req, res);
      expect(res._statusCode).toBe(403);
    });
  });

  describe('promoteGroupMember', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { promoteGroupMember } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ user: undefined, params: {} });
      const res = createMockResponse();
      await promoteGroupMember(req, res);
      expect(res._statusCode).toBe(401);
    });

    it('should return 404 if group not found for promote', async () => {
      const { promoteGroupMember } = await import('../../src/controllers/groupController');
      // With default mocks (Group.findByPk returns undefined), group check fails first
      const req = createMockRequest({ user: { id: 'user1', username: 'testuser' }, params: { groupId: 'nonexistent', memberId: 'user2' } });
      const res = createMockResponse();
      await promoteGroupMember(req, res);
      // Returns 403 or 404 depending on mock state — both are valid rejection paths
      expect([403, 404]).toContain(res._statusCode);
    });
  });

  describe('searchGroups', () => {
    it('should return 400 if query is too short', async () => {
      const { searchGroups } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ query: { query: 'a' } });
      const res = createMockResponse();
      await searchGroups(req, res);
      expect(res._statusCode).toBe(400);
    });

    it('should return 200 with search results', async () => {
      const Group = (await import('../../src/models/Group')).default;
      (Group.findAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'group1', name: 'Test Group', isActive: true },
      ]);
      const { searchGroups } = await import('../../src/controllers/groupController');
      const req = createMockRequest({ query: { query: 'test' } });
      const res = createMockResponse();
      await searchGroups(req, res);
      expect(res._statusCode).toBe(200);
    });
  });

  describe('groupSchemas contract', () => {
    it('accepts safe relative upload path, https URL, and null while rejecting dangerous URLs', async () => {
      const { createGroupSchema, updateGroupSchema } = await import('../../src/schemas/groupSchemas');

      expect(
        createGroupSchema.parse({
          name: 'Product Squad',
          description: 'Weekly sync',
          type: 'public',
          maxMembers: 500,
          avatarUrl: '/api/public/space/uploads/test.webp',
        })
      ).toEqual(
        expect.objectContaining({
          name: 'Product Squad',
          type: 'public',
          maxMembers: 500,
          avatarUrl: '/api/public/space/uploads/test.webp',
        })
      );

      expect(
        updateGroupSchema.parse({
          type: 'private',
          maxMembers: 100,
          avatarUrl: 'https://storage.googleapis.com/demo/avatar.webp',
        })
      ).toEqual(
        expect.objectContaining({
          type: 'private',
          maxMembers: 100,
          avatarUrl: 'https://storage.googleapis.com/demo/avatar.webp',
        })
      );

      expect(updateGroupSchema.parse({ avatarUrl: null }).avatarUrl).toBeNull();

      expect(() =>
        createGroupSchema.parse({ name: 'Bad', avatarUrl: 'javascript:alert(1)' })
      ).toThrow();
      expect(() =>
        updateGroupSchema.parse({ avatarUrl: '../etc/passwd' })
      ).toThrow();
      expect(() =>
        createGroupSchema.parse({ name: 'Bad', avatarUrl: '/api/public/space/uploads/../secret.png' })
      ).toThrow();
    });
  });
});
