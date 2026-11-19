import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheStore: new Map<string, unknown>(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDelete: vi.fn(),
  cacheDeletePattern: vi.fn(),
  userFindByPk: vi.fn(),
  groupFindByPk: vi.fn(),
  groupMemberFindOne: vi.fn(),
  groupMemberFindAll: vi.fn(),
  outboxUpdateOne: vi.fn(),
  outboxFindById: vi.fn(),
}));

vi.mock('../../src/services/cacheService', () => ({
  cacheService: {
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    delete: mocks.cacheDelete,
    deletePattern: mocks.cacheDeletePattern,
  },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findByPk: mocks.userFindByPk,
  },
}));

vi.mock('../../src/models/Group', () => ({
  default: {
    findByPk: mocks.groupFindByPk,
  },
}));

vi.mock('../../src/models/GroupMember', () => ({
  MemberStatus: {
    ACTIVE: 'active',
    MUTED: 'muted',
    BANNED: 'banned',
    LEFT: 'left',
  },
  default: {
    findOne: mocks.groupMemberFindOne,
    findAll: mocks.groupMemberFindAll,
  },
}));

vi.mock('../../src/models/ChatDeliveryOutbox', () => ({
  default: {
    updateOne: mocks.outboxUpdateOne,
    findById: mocks.outboxFindById,
  },
}));

import {
  assertCanSendGroupMessageCached,
  getCachedGroupMemberIds,
  getCachedGroupMeta,
  getCachedUserExists,
  invalidateGroupWriteCache,
} from '../../src/services/chatDelivery/writePathCache';
import { ChatDeliveryOutboxService } from '../../src/services/chatDelivery/outboxService';

describe('消息写路径缓存与原子 Outbox 优化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheStore.clear();
    mocks.cacheGet.mockImplementation(async (key: string) => {
      return mocks.cacheStore.has(key) ? mocks.cacheStore.get(key) : null;
    });
    mocks.cacheSet.mockImplementation(async (key: string, value: unknown) => {
      mocks.cacheStore.set(key, value);
      return true;
    });
    mocks.cacheDelete.mockImplementation(async (key: string) => {
      mocks.cacheStore.delete(key);
      return true;
    });
    mocks.cacheDeletePattern.mockImplementation(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      let count = 0;
      for (const k of Array.from(mocks.cacheStore.keys())) {
        if (k.startsWith(prefix)) {
          mocks.cacheStore.delete(k);
          count += 1;
        }
      }
      return count;
    });
  });

  it('命中短 TTL 缓存时跳过跨区域 PostgreSQL 查询，且不负缓存不存在用户', async () => {
    mocks.userFindByPk.mockResolvedValueOnce(null);
    expect(await getCachedUserExists('u-new')).toBe(false);
    expect(mocks.cacheSet).not.toHaveBeenCalled();

    mocks.userFindByPk.mockResolvedValueOnce({ id: 'u-new' });
    expect(await getCachedUserExists('u-new')).toBe(true);
    // 二次查询命中缓存，不再访问数据库
    expect(await getCachedUserExists('u-new')).toBe(true);
    expect(mocks.userFindByPk).toHaveBeenCalledTimes(2);

    mocks.groupFindByPk.mockResolvedValueOnce({ id: 'g-1', isActive: true, memberCount: 12 });
    expect(await getCachedGroupMeta('g-1')).toEqual({ isActive: true, memberCount: 12 });
    expect(await getCachedGroupMeta('g-1')).toEqual({ isActive: true, memberCount: 12 });
    expect(mocks.groupFindByPk).toHaveBeenCalledTimes(1);

    mocks.groupMemberFindAll.mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]);
    expect(await getCachedGroupMemberIds('g-1')).toEqual(['u1', 'u2']);
    expect(await getCachedGroupMemberIds('g-1')).toEqual(['u1', 'u2']);
    expect(mocks.groupMemberFindAll).toHaveBeenCalledTimes(1);
  });

  it('群成员权限缓存正确拦截禁言、到期自动回源解禁并支持主动失效', async () => {
    // 命中未过期禁言缓存直接拦截
    const futureIso = new Date(Date.now() + 60_000).toISOString();
    mocks.cacheStore.set('chat:write:group_member:g-2:u-muted', {
      isActive: true,
      status: 'muted',
      mutedUntil: futureIso,
    });
    await expect(assertCanSendGroupMessageCached('g-2', 'u-muted')).rejects.toThrow('您已被禁言');
    expect(mocks.groupMemberFindOne).not.toHaveBeenCalled();

    // 禁言已到期时穿透缓存回源自动解禁并回写缓存
    const pastIso = new Date(Date.now() - 10_000).toISOString();
    mocks.cacheStore.set('chat:write:group_member:g-2:u-expired', {
      isActive: true,
      status: 'muted',
      mutedUntil: pastIso,
    });
    const saveMock = vi.fn().mockResolvedValue(undefined);
    mocks.groupMemberFindOne.mockResolvedValueOnce({
      status: 'muted',
      mutedUntil: new Date(pastIso),
      isActive: true,
      save: saveMock,
    });
    await expect(assertCanSendGroupMessageCached('g-2', 'u-expired')).resolves.toBeUndefined();
    expect(saveMock).toHaveBeenCalledTimes(1);

    // 主动失效后再次校验会回源拦截已被移出的成员
    await invalidateGroupWriteCache('g-2', { userIds: ['u-expired'] });
    mocks.groupMemberFindOne.mockResolvedValueOnce(null);
    await expect(assertCanSendGroupMessageCached('g-2', 'u-expired')).rejects.toThrow('您不是该群组成员或已被移除');
  });

  it('单分片 Outbox 入队走单次原子 updateOne，避免 findById + save 双次往返', async () => {
    mocks.outboxUpdateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
    const service = new ChatDeliveryOutboxService();

    await service.markGoPrimaryQueued('outbox-atomic-1', [{ id: 'go-primary:outbox-atomic-1:0' }]);

    expect(mocks.outboxUpdateOne).toHaveBeenCalledTimes(1);
    expect(mocks.outboxFindById).not.toHaveBeenCalled();
  });
});
