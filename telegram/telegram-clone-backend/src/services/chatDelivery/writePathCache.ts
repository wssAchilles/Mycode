import { Op } from 'sequelize';
import User from '../../models/User';
import Group from '../../models/Group';
import GroupMember, { MemberStatus } from '../../models/GroupMember';
import { cacheService } from '../cacheService';

export interface CachedGroupMeta {
  memberCount: number;
  isActive: boolean;
}

interface CachedGroupMemberState {
  isActive: boolean;
  status: string;
  mutedUntil: string | null;
}

// 写路径热数据短 TTL 缓存，显著消除高频发消息对跨区域 PostgreSQL 的重复查询
export const AUTH_USER_CACHE_TTL_SECONDS = 300;
const USER_EXISTS_CACHE_TTL_SECONDS = 300;
const GROUP_META_CACHE_TTL_SECONDS = 120;
const GROUP_MEMBER_STATE_CACHE_TTL_SECONDS = 60;
const GROUP_MEMBER_IDS_CACHE_TTL_SECONDS = 60;

const authUserKey = (userId: string) => `auth:user:${userId}`;
const userExistsKey = (userId: string) => `chat:write:user_exists:${userId}`;
const groupMetaKey = (groupId: string) => `chat:write:group_meta:${groupId}`;
const groupMembersKey = (groupId: string) => `chat:write:group_members:${groupId}`;
const groupMemberStateKey = (groupId: string, userId: string) =>
  `chat:write:group_member:${groupId}:${userId}`;

/**
 * 校验私聊接收者是否存在（仅缓存存在态，避免新注册用户被负缓存误伤）
 */
export async function getCachedUserExists(userId: string): Promise<boolean> {
  if (!userId) return false;
  const key = userExistsKey(userId);
  const cached = await cacheService.get<boolean>(key);
  if (cached === true) {
    return true;
  }

  const user = await User.findByPk(userId);
  if (!user) {
    return false;
  }

  void cacheService.set(key, true, USER_EXISTS_CACHE_TTL_SECONDS);
  return true;
}

/**
 * 查询群组激活状态与成员数量（复用短 TTL 缓存，消除 controller 与 writeService 重复查库）
 */
export async function getCachedGroupMeta(groupId: string): Promise<CachedGroupMeta | null> {
  if (!groupId) return null;
  const key = groupMetaKey(groupId);
  const cached = await cacheService.get<CachedGroupMeta>(key);
  if (cached && typeof cached.isActive === 'boolean' && typeof cached.memberCount === 'number') {
    return cached;
  }

  const group = await Group.findByPk(groupId, {
    attributes: ['id', 'isActive', 'memberCount'],
  });
  if (!group) {
    return null;
  }

  const meta: CachedGroupMeta = {
    isActive: Boolean((group as any).isActive),
    memberCount: Number((group as any).memberCount || 0),
  };
  void cacheService.set(key, meta, GROUP_META_CACHE_TTL_SECONDS);
  return meta;
}

/**
 * 校验用户是否具备向指定群组发送消息的权限（禁言到期自动回源恢复）
 */
export async function assertCanSendGroupMessageCached(
  groupId: string,
  userId: string,
): Promise<void> {
  const key = groupMemberStateKey(groupId, userId);
  const cached = await cacheService.get<CachedGroupMemberState>(key);

  if (cached) {
    if (!cached.isActive || cached.status === MemberStatus.BANNED || cached.status === MemberStatus.LEFT) {
      throw new Error('您不是该群组成员或已被移除');
    }
    if (cached.status === MemberStatus.MUTED) {
      const mutedUntil = cached.mutedUntil ? new Date(cached.mutedUntil) : null;
      if (mutedUntil && mutedUntil > new Date()) {
        throw new Error('您已被禁言');
      }
      // 禁言已到期：跳过缓存，回源执行自动解禁并回写数据库
    } else {
      return;
    }
  }

  const member = await GroupMember.findOne({
    where: {
      groupId,
      userId,
      isActive: true,
    },
  });

  if (!member || member.status === MemberStatus.BANNED || member.status === MemberStatus.LEFT) {
    throw new Error('您不是该群组成员或已被移除');
  }

  let effectiveStatus: string = (member as any).status;
  let effectiveMutedUntil: Date | null = (member as any).mutedUntil
    ? new Date((member as any).mutedUntil)
    : null;

  if (effectiveStatus === MemberStatus.MUTED) {
    if (effectiveMutedUntil && effectiveMutedUntil > new Date()) {
      void cacheService.set<CachedGroupMemberState>(
        key,
        {
          isActive: true,
          status: effectiveStatus,
          mutedUntil: effectiveMutedUntil.toISOString(),
        },
        GROUP_MEMBER_STATE_CACHE_TTL_SECONDS,
      );
      throw new Error('您已被禁言');
    }
    // 禁言到期，自动恢复
    if (effectiveMutedUntil && effectiveMutedUntil <= new Date()) {
      (member as any).status = MemberStatus.ACTIVE;
      (member as any).mutedUntil = null;
      await member.save();
      effectiveStatus = MemberStatus.ACTIVE;
      effectiveMutedUntil = null;
    }
  }

  void cacheService.set<CachedGroupMemberState>(
    key,
    {
      isActive: true,
      status: effectiveStatus,
      mutedUntil: effectiveMutedUntil ? effectiveMutedUntil.toISOString() : null,
    },
    GROUP_MEMBER_STATE_CACHE_TTL_SECONDS,
  );
}

/**
 * 获取群组活跃/禁言成员 ID 列表（用于小群写扩散）
 */
export async function getCachedGroupMemberIds(groupId: string): Promise<string[]> {
  if (!groupId) return [];
  const key = groupMembersKey(groupId);
  const cached = await cacheService.get<string[]>(key);
  if (Array.isArray(cached)) {
    return cached;
  }

  const members = await GroupMember.findAll({
    where: {
      groupId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true,
    },
    attributes: ['userId'],
  });
  const userIds = members.map((m: any) => String(m.userId));
  void cacheService.set(key, userIds, GROUP_MEMBER_IDS_CACHE_TTL_SECONDS);
  return userIds;
}

/**
 * 群成员或群状态变更时主动失效相关写路径缓存，保障权限实时一致性
 */
export async function invalidateGroupWriteCache(
  groupId: string,
  options: { userIds?: string[]; clearAllMembers?: boolean } = {},
): Promise<void> {
  if (!groupId) return;
  const tasks: Array<Promise<unknown>> = [
    cacheService.delete(groupMetaKey(groupId)),
    cacheService.delete(groupMembersKey(groupId)),
  ];

  const uniqueUserIds = Array.from(new Set((options.userIds || []).filter(Boolean)));
  for (const uid of uniqueUserIds) {
    tasks.push(cacheService.delete(groupMemberStateKey(groupId, uid)));
  }

  if (options.clearAllMembers) {
    tasks.push(cacheService.deletePattern(`chat:write:group_member:${groupId}:*`));
  }

  await Promise.allSettled(tasks);
}

/**
 * 用户资料变更时失效鉴权缓存
 */
export async function invalidateAuthUserCache(userId: string): Promise<void> {
  if (!userId) return;
  await cacheService.delete(authUserKey(userId)).catch(() => undefined);
}
