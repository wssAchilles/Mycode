import { Request, Response } from 'express';
import Group, { GroupType } from '../models/Group';
import GroupMember, { MemberRole, MemberStatus } from '../models/GroupMember';
import User from '../models/User';
import { Op } from 'sequelize';
import { sequelize } from '../config/sequelize';
import ChatCounter from '../models/ChatCounter';
import ChatMemberState from '../models/ChatMemberState';
import Message from '../models/Message';
import { updateService } from '../services/updateService';
import { waitForMongoReady } from '../config/db';
import { buildGroupChatId } from '../utils/chat';
import { getSocketService } from '../services/socketRegistry';
import { createChildLogger } from '../utils/logger';
import { sendSuccess, sendCreated, errors } from '../utils/apiResponse';
import { catchAsync } from '../middleware/errorHandler';
const log = createChildLogger('controllers:groupController');

// 扩展请求接口
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
  };
}

const getActiveGroupMemberIds = async (groupId: string): Promise<string[]> => {
  const members = await GroupMember.findAll({
    where: {
      groupId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    },
    attributes: ['userId']
  });
  return members.map((m: any) => m.userId);
};

const broadcastGroupUpdate = async (params: {
  groupId: string;
  actorId: string;
  action: string;
  targetId?: string;
  payload?: Record<string, any>;
  includeUserIds?: string[];
}) => {
  const memberIds = await getActiveGroupMemberIds(params.groupId);
  const userIds = Array.from(new Set([...(params.includeUserIds || []), ...memberIds]));
  const chatId = buildGroupChatId(params.groupId);
  const updatePayload = {
    action: params.action,
    groupId: params.groupId,
    actorId: params.actorId,
    targetId: params.targetId,
    ...(params.payload || {})
  };

  await updateService.appendUpdates(userIds, {
    type: 'member_change',
    chatId,
    payload: updatePayload
  });

  const socketService = getSocketService();
  if (socketService) {
    socketService.emitGroupUpdate(params.groupId, updatePayload);
    if (params.includeUserIds && params.includeUserIds.length > 0) {
      socketService.emitGroupUpdateToUsers(params.includeUserIds, updatePayload);
    }
  }
};

/**
 * 创建群组
 */
export const createGroup = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const transaction = await sequelize.transaction();

  try {
    const { name, description, type = GroupType.PRIVATE, maxMembers = 200 } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      await transaction.rollback();
      return errors.unauthorized(res);
    }

    if (!name || name.trim().length < 1) {
      await transaction.rollback();
      return errors.badRequest(res, '群组名称不能为空');
    }

    // 创建群组
    const group = await Group.create({
      name: name.trim(),
      description: description?.trim(),
      ownerId: userId,
      type,
      maxMembers,
      memberCount: 1 // 创建者自动成为成员
    }, { transaction });

    // 添加创建者为群主
    await GroupMember.create({
      groupId: group.id,
      userId,
      role: MemberRole.OWNER,
      status: MemberStatus.ACTIVE,
      joinedAt: new Date()
    }, { transaction });

    await transaction.commit();

    // 返回创建的群组信息
    const groupWithMembers = await Group.findByPk(group.id, {
      include: [
        {
          model: User,
          as: 'owner', // 修正：与 associations.ts 保持一致（小写）
          attributes: ['id', 'username', 'email', 'avatarUrl']
        }
      ]
    });

    sendCreated(res, { group: groupWithMembers }, '群组创建成功');
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

/**
 * 获取用户的群组列表
 */
export const getUserGroups = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  let mongoReady = true;
  try {
    await waitForMongoReady(8000);
  } catch (error) {
    mongoReady = false;
    log.warn('Mongo 未就绪，群组未读数/最后消息将暂时为空');
  }

  // 获取用户加入的群组
  const groupMembers = await GroupMember.findAll({
    where: {
      userId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    },
    include: [
      {
        model: Group,
        as: 'group', // 修正：与 associations.ts 中定义的别名保持一致（小写）
        where: {
          isActive: true
        },
        include: [
          {
            model: User,
            as: 'owner', // 修正：与 associations.ts 中定义的别名保持一致（小写）
            attributes: ['id', 'username', 'avatarUrl']
          }
        ]
      }
    ],
    order: [['joinedAt', 'DESC']]
  });

  const groupRows = groupMembers.map((member) => ({
    group: (member as any).group.toJSON(),
    memberRole: member.role,
    joinedAt: member.joinedAt
  }));

  const groupIds = groupRows.map((row) => row.group.id);
  const chatIds = groupIds.map((groupId) => buildGroupChatId(groupId));

  const counterMap = new Map<string, number>();
  const stateMap = new Map<string, number>();
  const lastMessageMap = new Map<string, any>();

  if (mongoReady && chatIds.length > 0) {
    const [counters, states, lastMessagesAgg] = await Promise.all([
      ChatCounter.find({ _id: { $in: chatIds } }).lean(),
      ChatMemberState.find({ chatId: { $in: chatIds }, userId }).lean(),
      Message.aggregate([
        { $match: { chatId: { $in: chatIds }, deletedAt: null } },
        { $sort: { seq: -1, timestamp: -1 } },
        { $group: { _id: '$chatId', doc: { $first: '$$ROOT' } } }
      ])
    ]);

    counters.forEach((c: any) => counterMap.set(c._id, c.seq || 0));
    states.forEach((s: any) => stateMap.set(s.chatId, s.lastReadSeq || 0));

    const senderIds = Array.from(new Set(lastMessagesAgg.map((row: any) => row?.doc?.sender).filter(Boolean)));
    const users = senderIds.length
      ? await User.findAll({ where: { id: senderIds }, attributes: ['id', 'username'] })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    lastMessagesAgg.forEach((row: any) => {
      if (!row?.doc) return;
      const doc = row.doc;
      lastMessageMap.set(row._id, {
        id: doc._id?.toString?.() || doc._id,
        content: doc.content,
        timestamp: doc.timestamp,
        senderId: doc.sender,
        senderUsername: userMap.get(doc.sender) || '未知用户',
        type: doc.type || 'text',
        seq: doc.seq,
        chatId: doc.chatId
      });
    });
  }

  const groups = groupRows.map((row) => {
    const chatId = buildGroupChatId(row.group.id);
    const lastReadSeq = stateMap.get(chatId) || 0;
    const latestSeq = counterMap.get(chatId) || 0;
    const unreadCount = Math.max(latestSeq - lastReadSeq, 0);
    return {
      ...row.group,
      memberRole: row.memberRole,
      joinedAt: row.joinedAt,
      lastMessage: lastMessageMap.get(chatId) || null,
      unreadCount
    };
  });

  sendSuccess(res, {
    groups,
    total: groups.length
  });
});

/**
 * 获取群组详情
 */
export const getGroupDetails = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  // 检查用户是否为群组成员
  const membership = await GroupMember.findOne({
    where: {
      groupId,
      userId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    }
  });

  if (!membership) {
    return errors.forbidden(res, '您不是该群组的成员');
  }

  // 获取群组详情
  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'owner', // 修正：与 associations.ts 保持一致（小写）
        attributes: ['id', 'username', 'email', 'avatarUrl']
      }
    ]
  });

  if (!group) {
    return errors.notFound(res, '群组');
  }

  // 获取群组成员
  const members = await GroupMember.findAll({
    where: {
      groupId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    },
    include: [
      {
        model: User,
        as: 'user', // 修正：与 associations.ts 保持一致（小写）
        attributes: ['id', 'username', 'email', 'avatarUrl']
      }
    ],
    order: [
      ['role', 'ASC'], // 群主和管理员排在前面
      ['joinedAt', 'ASC']
    ]
  });

  sendSuccess(res, {
    group: {
      ...group.toJSON(),
      currentUserRole: membership.role,
      currentUserStatus: membership.status
    },
    members,
    memberCount: members.length
  });
});

/**
 * 添加群组成员
 */
export const addGroupMember = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId } = req.params;
  const { userIds } = req.body; // 可以一次添加多个用户
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return errors.badRequest(res, '用户 ID 列表不能为空');
  }

  // 检查操作权限（管理员或群主才能添加成员）
  const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
  if (!hasPermission) {
    return errors.forbidden(res, '权限不足');
  }

  // 获取群组信息
  const group = await Group.findByPk(groupId);
  if (!group || !group.isActive) {
    return errors.notFound(res, '群组');
  }

  // 检查群组是否已满员
  if (group.isFull()) {
    return errors.badRequest(res, '群组已满员');
  }

  const results = [];
  const addMemberErrors: string[] = [];
  const addedUserIds: string[] = [];

  // 批量查询用户和现有成员（避免 N+1）
  const [users, existingMembers] = await Promise.all([
    User.findAll({ where: { id: userIds } }),
    GroupMember.findAll({ where: { groupId, userId: userIds } }),
  ]);
  const userMap = new Map(users.map(u => [u.id, u]));
  const memberMap = new Map(existingMembers.map(m => [m.userId, m]));

  // 第一轮：验证 + 收集待写入数据
  const toCreate: Array<{ groupId: string; userId: string; role: MemberRole; status: MemberStatus; invitedBy: string; joinedAt: Date }> = [];
  const toReactivate: Array<{ member: GroupMember; user: typeof users[0] }> = [];

  for (const newUserId of userIds) {
    const user = userMap.get(newUserId);
    if (!user) {
      addMemberErrors.push(`用户 ${newUserId} 不存在`);
      continue;
    }

    const existingMember = memberMap.get(newUserId);

    if (existingMember) {
      if (existingMember.isActive && [MemberStatus.ACTIVE, MemberStatus.MUTED].includes(existingMember.status)) {
        addMemberErrors.push(`用户 ${user.username} 已经是群组成员`);
        continue;
      }
      toReactivate.push({ member: existingMember, user });
    } else {
      toCreate.push({
        groupId,
        userId: newUserId,
        role: MemberRole.MEMBER,
        status: MemberStatus.ACTIVE,
        invitedBy: userId,
        joinedAt: new Date(),
      });
      results.push({ user: user.toJSON(), action: 'added' });
      addedUserIds.push(newUserId);
    }
  }

  // 第二轮：批量写入（避免 N+1）
  if (toCreate.length > 0) {
    await GroupMember.bulkCreate(toCreate);
  }

  for (const { member, user } of toReactivate) {
    member.status = MemberStatus.ACTIVE;
    member.isActive = true;
    member.joinedAt = new Date();
    member.invitedBy = userId;
    await member.save();
    results.push({ user: user.toJSON(), action: 'reactivated' });
    addedUserIds.push(member.userId);
  }

  // 更新群组成员数量
  await group.updateMemberCount();

  if (addedUserIds.length > 0) {
    try {
      await waitForMongoReady(8000);
      const chatId = buildGroupChatId(groupId);
      const counter = await ChatCounter.findById(chatId).lean();
      const latestSeq = counter?.seq || 0;

      await Promise.all(
        addedUserIds.map((memberId) =>
          ChatMemberState.updateOne(
            { chatId, userId: memberId },
            {
              $set: {
                lastReadSeq: latestSeq,
                lastDeliveredSeq: latestSeq,
                lastSeenAt: new Date(),
                role: MemberRole.MEMBER
              },
              $setOnInsert: { lastReadSeq: latestSeq, lastDeliveredSeq: latestSeq }
            },
            { upsert: true }
          )
        )
      );
    } catch (error) {
      log.warn({ err: error }, '初始化群成员状态失败');
    }

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'member_added',
      payload: { members: results, memberIds: addedUserIds },
      includeUserIds: addedUserIds
    });
  }

  sendSuccess(res, {
    results,
    errors: addMemberErrors,
    successCount: results.length,
    errorCount: addMemberErrors.length
  }, { message: '成员添加操作完成' });
});

/**
 * 移除群组成员
 */
export const removeGroupMember = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId, memberId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  // 不能移除自己（应该使用退出群组接口）
  if (userId === memberId) {
    return errors.badRequest(res, '不能移除自己，请使用退出群组功能');
  }

  // 检查操作权限
  const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
  if (!hasPermission) {
    return errors.forbidden(res, '权限不足');
  }

  // 查找要移除的成员
  const memberToRemove = await GroupMember.findOne({
    where: {
      groupId,
      userId: memberId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    }
  });

  if (!memberToRemove) {
    return errors.notFound(res, '成员');
  }

  // 不能移除群主
  if (memberToRemove.role === MemberRole.OWNER) {
    return errors.badRequest(res, '不能移除群主');
  }

  // 普通管理员不能移除其他管理员
  const operatorMember = await GroupMember.findOne({
    where: {
      groupId,
      userId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    }
  });

  if (operatorMember?.role === MemberRole.ADMIN && memberToRemove.role === MemberRole.ADMIN) {
    return errors.forbidden(res, '管理员不能移除其他管理员');
  }

  // 移除成员
  await memberToRemove.ban();
  try {
    await ChatMemberState.deleteOne({ chatId: buildGroupChatId(groupId), userId: memberId });
  } catch (error) {
    log.warn({ err: error }, '清理群成员状态失败');
  }

  // 更新群组成员数量
  const group = await Group.findByPk(groupId);
  if (group) {
    await group.updateMemberCount();
  }

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'member_removed',
    targetId: memberId,
    payload: { role: memberToRemove.role },
    includeUserIds: [memberId]
  });

  sendSuccess(res, null, { message: '成员已被移除' });
});

/**
 * 禁言群组成员
 */
export const muteGroupMember = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId, memberId } = req.params;
  const { durationHours = 24 } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  // 检查操作权限
  const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
  if (!hasPermission) {
    return errors.forbidden(res, '权限不足');
  }

  const memberToMute = await GroupMember.findOne({
    where: {
      groupId,
      userId: memberId,
      status: MemberStatus.ACTIVE,
      isActive: true
    }
  });

  if (!memberToMute) {
    return errors.notFound(res, '成员');
  }

  if (memberToMute.role === MemberRole.OWNER) {
    return errors.badRequest(res, '不能禁言群主');
  }

  const operatorMember = await GroupMember.findOne({
    where: {
      groupId,
      userId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    }
  });

  if (operatorMember?.role === MemberRole.ADMIN && memberToMute.role === MemberRole.ADMIN) {
    return errors.forbidden(res, '管理员不能禁言其他管理员');
  }

  await memberToMute.mute(Math.max(Number(durationHours) || 24, 1));

  try {
    await ChatMemberState.updateOne(
      { chatId: buildGroupChatId(groupId), userId: memberId },
      { $set: { mutedUntil: memberToMute.mutedUntil } },
      { upsert: true }
    );
  } catch (error) {
    log.warn({ err: error }, '更新群成员静默状态失败');
  }

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'member_muted',
    targetId: memberId,
    payload: { mutedUntil: memberToMute.mutedUntil },
    includeUserIds: [memberId]
  });

  sendSuccess(res, { mutedUntil: memberToMute.mutedUntil }, { message: '成员已被禁言' });
});

/**
 * 解除群组成员禁言
 */
export const unmuteGroupMember = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId, memberId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
  if (!hasPermission) {
    return errors.forbidden(res, '权限不足');
  }

  const memberToUnmute = await GroupMember.findOne({
    where: {
      groupId,
      userId: memberId,
      status: MemberStatus.MUTED,
      isActive: true
    }
  });

  if (!memberToUnmute) {
    return errors.notFound(res, '被禁言的成员');
  }

  await memberToUnmute.unmute();

  try {
    await ChatMemberState.updateOne(
      { chatId: buildGroupChatId(groupId), userId: memberId },
      { $set: { mutedUntil: null } },
      { upsert: true }
    );
  } catch (error) {
    log.warn({ err: error }, '更新群成员静默状态失败');
  }

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'member_unmuted',
    targetId: memberId,
    includeUserIds: [memberId]
  });

  sendSuccess(res, null, { message: '成员已解除禁言' });
});

/**
 * 提升成员为管理员
 */
export const promoteGroupMember = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId, memberId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  const group = await Group.findByPk(groupId);
  if (!group || !group.isActive) {
    return errors.notFound(res, '群组');
  }

  if (group.ownerId !== userId) {
    return errors.forbidden(res, '只有群主才能提升管理员');
  }

  const memberToPromote = await GroupMember.findOne({
    where: {
      groupId,
      userId: memberId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    }
  });

  if (!memberToPromote) {
    return errors.notFound(res, '成员');
  }

  if (memberToPromote.role === MemberRole.ADMIN) {
    return errors.badRequest(res, '该成员已是管理员');
  }
  if (memberToPromote.role === MemberRole.OWNER) {
    return errors.badRequest(res, '群主无需提升');
  }

  await memberToPromote.promoteToAdmin();

  try {
    await ChatMemberState.updateOne(
      { chatId: buildGroupChatId(groupId), userId: memberId },
      { $set: { role: MemberRole.ADMIN } },
      { upsert: true }
    );
  } catch (error) {
    log.warn({ err: error }, '更新群成员角色失败');
  }

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'member_promoted',
    targetId: memberId,
    payload: { role: memberToPromote.role },
    includeUserIds: [memberId]
  });

  sendSuccess(res, null, { message: '成员已提升为管理员' });
});

/**
 * 降级管理员为普通成员
 */
export const demoteGroupMember = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId, memberId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  const group = await Group.findByPk(groupId);
  if (!group || !group.isActive) {
    return errors.notFound(res, '群组');
  }

  if (group.ownerId !== userId) {
    return errors.forbidden(res, '只有群主才能降级管理员');
  }

  const memberToDemote = await GroupMember.findOne({
    where: {
      groupId,
      userId: memberId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    }
  });

  if (!memberToDemote) {
    return errors.notFound(res, '成员');
  }

  if (memberToDemote.role !== MemberRole.ADMIN) {
    return errors.badRequest(res, '该成员不是管理员');
  }

  await memberToDemote.demoteToMember();

  try {
    await ChatMemberState.updateOne(
      { chatId: buildGroupChatId(groupId), userId: memberId },
      { $set: { role: MemberRole.MEMBER } },
      { upsert: true }
    );
  } catch (error) {
    log.warn({ err: error }, '更新群成员角色失败');
  }

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'member_demoted',
    targetId: memberId,
    payload: { role: memberToDemote.role },
    includeUserIds: [memberId]
  });

  sendSuccess(res, null, { message: '管理员已降级为普通成员' });
});

/**
 * 退出群组
 */
export const leaveGroup = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  // 查找成员身份
  const member = await GroupMember.findOne({
    where: {
      groupId,
      userId,
      status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
      isActive: true
    }
  });

  if (!member) {
    return errors.notFound(res, '群组成员');
  }

  // 群主不能直接退出，需要先转让群主身份
  if (member.role === MemberRole.OWNER) {
    return errors.badRequest(res, '群主不能直接退出群组，请先转让群主身份或解散群组');
  }

  // 退出群组
  await member.leave();
  try {
    await ChatMemberState.deleteOne({ chatId: buildGroupChatId(groupId), userId });
  } catch (error) {
    log.warn({ err: error }, '清理群成员状态失败');
  }

  // 更新群组成员数量
  const group = await Group.findByPk(groupId);
  if (group) {
    await group.updateMemberCount();
  }

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'member_left',
    targetId: userId,
    payload: { role: member.role },
    includeUserIds: [userId]
  });

  sendSuccess(res, null, { message: '已退出群组' });
});

/**
 * 更新群组信息
 */
export const updateGroup = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId } = req.params;
  const { name, description, avatarUrl } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  // 检查操作权限（管理员或群主才能修改群组信息）
  const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
  if (!hasPermission) {
    return errors.forbidden(res, '权限不足');
  }

  // 查找群组
  const group = await Group.findByPk(groupId);
  if (!group || !group.isActive) {
    return errors.notFound(res, '群组');
  }

  // 更新群组信息
  if (name && name.trim().length > 0) {
    group.name = name.trim();
  }
  if (description !== undefined) {
    group.description = description?.trim() || null;
  }
  if (avatarUrl !== undefined) {
    group.avatarUrl = avatarUrl?.trim() || null;
  }

  await group.save();

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'group_updated',
    payload: {
      name: group.name,
      description: group.description,
      avatarUrl: group.avatarUrl
    }
  });

  sendSuccess(res, { group }, { message: '群组信息已更新' });
});

/**
 * 解散群组
 */
export const deleteGroup = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { groupId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return errors.unauthorized(res);
  }

  // 查找群组
  const group = await Group.findByPk(groupId);
  if (!group || !group.isActive) {
    return errors.notFound(res, '群组');
  }

  // 只有群主才能解散群组
  if (group.ownerId !== userId) {
    return errors.forbidden(res, '只有群主才能解散群组');
  }

  const activeMemberIds = await getActiveGroupMemberIds(groupId);

  // 软删除群组
  group.isActive = false;
  await group.save();

  // 将所有成员标记为已退出
  await GroupMember.update(
    {
      status: MemberStatus.LEFT,
      isActive: false
    },
    {
      where: {
        groupId,
        status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] }
      }
    }
  );
  try {
    await ChatMemberState.deleteMany({ chatId: buildGroupChatId(groupId) });
  } catch (error) {
    log.warn({ err: error }, '清理群成员状态失败');
  }

  await broadcastGroupUpdate({
    groupId,
    actorId: userId,
    action: 'group_deleted',
    payload: { groupName: group.name },
    includeUserIds: activeMemberIds
  });

  sendSuccess(res, null, { message: '群组已解散' });
});

/**
 * 转让群主身份
 */
export const transferOwnership = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const transaction = await sequelize.transaction();

  try {
    const { groupId } = req.params;
    const { newOwnerId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      await transaction.rollback();
      return errors.unauthorized(res);
    }

    if (!newOwnerId) {
      await transaction.rollback();
      return errors.badRequest(res, '新群主 ID 不能为空');
    }

    // 查找群组
    const group = await Group.findByPk(groupId, { transaction });
    if (!group || !group.isActive) {
      await transaction.rollback();
      return errors.notFound(res, '群组');
    }

    // 只有群主才能转让群主身份
    if (group.ownerId !== userId) {
      await transaction.rollback();
      return errors.forbidden(res, '只有群主才能转让群主身份');
    }

    // 检查新群主是否为群组成员
    const newOwnerMember = await GroupMember.findOne({
      where: {
        groupId,
        userId: newOwnerId,
        status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
        isActive: true
      },
      transaction
    });

    if (!newOwnerMember) {
      await transaction.rollback();
      return errors.badRequest(res, '新群主必须是群组成员');
    }

    // 获取当前群主成员身份
    const currentOwnerMember = await GroupMember.findOne({
      where: {
        groupId,
        userId,
        role: MemberRole.OWNER
      },
      transaction
    });

    if (!currentOwnerMember) {
      await transaction.rollback();
      return errors.internal(res, '当前群主身份异常');
    }

    // 更新群组的群主 ID
    group.ownerId = newOwnerId;
    await group.save({ transaction });

    // 更新新群主的角色
    newOwnerMember.role = MemberRole.OWNER;
    await newOwnerMember.save({ transaction });

    // 将原群主降级为管理员
    currentOwnerMember.role = MemberRole.ADMIN;
    await currentOwnerMember.save({ transaction });

    await transaction.commit();

    try {
      const chatId = buildGroupChatId(groupId);
      await Promise.all([
        ChatMemberState.updateOne(
          { chatId, userId: newOwnerId },
          { $set: { role: MemberRole.OWNER } },
          { upsert: true }
        ),
        ChatMemberState.updateOne(
          { chatId, userId },
          { $set: { role: MemberRole.ADMIN } },
          { upsert: true }
        )
      ]);
    } catch (error) {
      log.warn({ err: error }, '更新群成员角色状态失败');
    }

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'ownership_transferred',
      targetId: newOwnerId,
      payload: { previousOwnerId: userId }
    });

    sendSuccess(res, null, { message: '群主身份转让成功' });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

/**
 * 搜索公开群组
 */
export const searchGroups = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { query } = req.query;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return errors.badRequest(res, '搜索关键词至少需要2个字符');
  }

  // 搜索公开群组
  const groups = await Group.findAll({
    where: {
      type: GroupType.PUBLIC,
      isActive: true,
      name: { [Op.iLike]: `%${query.trim()}%` }
    },
    include: [
      {
        model: User,
        as: 'owner', // 修正：与 associations.ts 保持一致（小写）
        attributes: ['id', 'username', 'avatarUrl']
      }
    ],
    limit,
    order: [
      ['memberCount', 'DESC'],
      ['createdAt', 'DESC']
    ]
  });

  sendSuccess(res, {
    groups,
    total: groups.length
  });
});
