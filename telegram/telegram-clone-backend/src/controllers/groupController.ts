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
      status: MemberStatus.ACTIVE,
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
export const createGroup = async (req: AuthenticatedRequest, res: Response) => {
  const transaction = await sequelize.transaction();

  try {
    const { name, description, type = GroupType.PRIVATE, maxMembers = 200 } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      await transaction.rollback();
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!name || name.trim().length < 1) {
      await transaction.rollback();
      return res.status(400).json({ error: '群组名称不能为空' });
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

    res.status(201).json({
      message: '群组创建成功',
      group: groupWithMembers
    });
  } catch (error) {
    await transaction.rollback();
    console.error('创建群组失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取用户的群组列表
 */
export const getUserGroups = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    let mongoReady = true;
    try {
      await waitForMongoReady(8000);
    } catch (error) {
      mongoReady = false;
      console.warn('Mongo 未就绪，群组未读数/最后消息将暂时为空');
    }

    // 获取用户加入的群组
    const groupMembers = await GroupMember.findAll({
      where: {
        userId,
        status: MemberStatus.ACTIVE,
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

    res.json({
      groups,
      total: groups.length
    });
  } catch (error) {
    console.error('获取群组列表失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取群组详情
 */
export const getGroupDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 检查用户是否为群组成员
    const membership = await GroupMember.findOne({
      where: {
        groupId,
        userId,
        status: MemberStatus.ACTIVE,
        isActive: true
      }
    });

    if (!membership) {
      return res.status(403).json({ error: '您不是该群组的成员' });
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
      return res.status(404).json({ error: '群组不存在' });
    }

    // 获取群组成员
    const members = await GroupMember.findAll({
      where: {
        groupId,
        status: MemberStatus.ACTIVE,
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

    res.json({
      group: {
        ...group.toJSON(),
        currentUserRole: membership.role,
        currentUserStatus: membership.status
      },
      members,
      memberCount: members.length
    });
  } catch (error) {
    console.error('获取群组详情失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 添加群组成员
 */
export const addGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { userIds } = req.body; // 可以一次添加多个用户
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: '用户 ID 列表不能为空' });
    }

    // 检查操作权限（管理员或群主才能添加成员）
    const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
    if (!hasPermission) {
      return res.status(403).json({ error: '权限不足' });
    }

    // 获取群组信息
    const group = await Group.findByPk(groupId);
    if (!group || !group.isActive) {
      return res.status(404).json({ error: '群组不存在' });
    }

    // 检查群组是否已满员
    if (group.isFull()) {
      return res.status(400).json({ error: '群组已满员' });
    }

    const results = [];
    const errors = [];
    const addedUserIds: string[] = [];

    for (const newUserId of userIds) {
      try {
        // 检查用户是否存在
        const user = await User.findByPk(newUserId);
        if (!user) {
          errors.push(`用户 ${newUserId} 不存在`);
          continue;
        }

        // 检查用户是否已经是群组成员
        const existingMember = await GroupMember.findOne({
          where: {
            groupId,
            userId: newUserId
          }
        });

        if (existingMember) {
          if (existingMember.status === MemberStatus.ACTIVE) {
            errors.push(`用户 ${user.username} 已经是群组成员`);
            continue;
          } else {
            // 重新激活已退出或被踢出的成员
            existingMember.status = MemberStatus.ACTIVE;
            existingMember.isActive = true;
            existingMember.joinedAt = new Date();
          existingMember.invitedBy = userId;
          await existingMember.save();
          results.push({
            user: user.toJSON(),
            action: 'reactivated'
          });
          addedUserIds.push(newUserId);
        }
      } else {
        // 添加新成员
        await GroupMember.create({
          groupId,
          userId: newUserId,
            role: MemberRole.MEMBER,
            status: MemberStatus.ACTIVE,
            invitedBy: userId,
            joinedAt: new Date()
          });

        results.push({
          user: user.toJSON(),
          action: 'added'
        });
        addedUserIds.push(newUserId);
      }
    } catch (error) {
      errors.push(`添加用户 ${newUserId} 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
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
        console.warn('初始化群成员状态失败:', error);
      }

      await broadcastGroupUpdate({
        groupId,
        actorId: userId,
        action: 'member_added',
        payload: { members: results, memberIds: addedUserIds },
        includeUserIds: addedUserIds
      });
    }

    res.json({
      message: '成员添加操作完成',
      results,
      errors,
      successCount: results.length,
      errorCount: errors.length
    });
  } catch (error) {
    console.error('添加群组成员失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 移除群组成员
 */
export const removeGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId, memberId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 不能移除自己（应该使用退出群组接口）
    if (userId === memberId) {
      return res.status(400).json({ error: '不能移除自己，请使用退出群组功能' });
    }

    // 检查操作权限
    const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
    if (!hasPermission) {
      return res.status(403).json({ error: '权限不足' });
    }

    // 查找要移除的成员
    const memberToRemove = await GroupMember.findOne({
      where: {
        groupId,
        userId: memberId,
        status: MemberStatus.ACTIVE,
        isActive: true
      }
    });

    if (!memberToRemove) {
      return res.status(404).json({ error: '成员不存在或已被移除' });
    }

    // 不能移除群主
    if (memberToRemove.role === MemberRole.OWNER) {
      return res.status(400).json({ error: '不能移除群主' });
    }

    // 普通管理员不能移除其他管理员
    const operatorMember = await GroupMember.findOne({
      where: {
        groupId,
        userId,
        status: MemberStatus.ACTIVE,
        isActive: true
      }
    });

    if (operatorMember?.role === MemberRole.ADMIN && memberToRemove.role === MemberRole.ADMIN) {
      return res.status(403).json({ error: '管理员不能移除其他管理员' });
    }

    // 移除成员
    await memberToRemove.ban();

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

    res.json({ message: '成员已被移除' });
  } catch (error) {
    console.error('移除群组成员失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 禁言群组成员
 */
export const muteGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId, memberId } = req.params;
    const { durationHours = 24 } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 检查操作权限
    const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
    if (!hasPermission) {
      return res.status(403).json({ error: '权限不足' });
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
      return res.status(404).json({ error: '成员不存在或已被移除' });
    }

    if (memberToMute.role === MemberRole.OWNER) {
      return res.status(400).json({ error: '不能禁言群主' });
    }

    const operatorMember = await GroupMember.findOne({
      where: {
        groupId,
        userId,
        status: MemberStatus.ACTIVE,
        isActive: true
      }
    });

    if (operatorMember?.role === MemberRole.ADMIN && memberToMute.role === MemberRole.ADMIN) {
      return res.status(403).json({ error: '管理员不能禁言其他管理员' });
    }

    await memberToMute.mute(Math.max(Number(durationHours) || 24, 1));

    try {
      await ChatMemberState.updateOne(
        { chatId: buildGroupChatId(groupId), userId: memberId },
        { $set: { mutedUntil: memberToMute.mutedUntil } },
        { upsert: true }
      );
    } catch (error) {
      console.warn('更新群成员静默状态失败:', error);
    }

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'member_muted',
      targetId: memberId,
      payload: { mutedUntil: memberToMute.mutedUntil },
      includeUserIds: [memberId]
    });

    res.json({ message: '成员已被禁言', mutedUntil: memberToMute.mutedUntil });
  } catch (error) {
    console.error('禁言成员失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 解除群组成员禁言
 */
export const unmuteGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId, memberId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
    if (!hasPermission) {
      return res.status(403).json({ error: '权限不足' });
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
      return res.status(404).json({ error: '成员未被禁言或不存在' });
    }

    await memberToUnmute.unmute();

    try {
      await ChatMemberState.updateOne(
        { chatId: buildGroupChatId(groupId), userId: memberId },
        { $set: { mutedUntil: null } },
        { upsert: true }
      );
    } catch (error) {
      console.warn('更新群成员静默状态失败:', error);
    }

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'member_unmuted',
      targetId: memberId,
      includeUserIds: [memberId]
    });

    res.json({ message: '成员已解除禁言' });
  } catch (error) {
    console.error('解除禁言失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 提升成员为管理员
 */
export const promoteGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId, memberId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    const group = await Group.findByPk(groupId);
    if (!group || !group.isActive) {
      return res.status(404).json({ error: '群组不存在' });
    }

    if (group.ownerId !== userId) {
      return res.status(403).json({ error: '只有群主才能提升管理员' });
    }

    const memberToPromote = await GroupMember.findOne({
      where: {
        groupId,
        userId: memberId,
        status: MemberStatus.ACTIVE,
        isActive: true
      }
    });

    if (!memberToPromote) {
      return res.status(404).json({ error: '成员不存在或已被移除' });
    }

    if (memberToPromote.role === MemberRole.ADMIN) {
      return res.status(400).json({ error: '该成员已是管理员' });
    }
    if (memberToPromote.role === MemberRole.OWNER) {
      return res.status(400).json({ error: '群主无需提升' });
    }

    await memberToPromote.promoteToAdmin();

    try {
      await ChatMemberState.updateOne(
        { chatId: buildGroupChatId(groupId), userId: memberId },
        { $set: { role: MemberRole.ADMIN } },
        { upsert: true }
      );
    } catch (error) {
      console.warn('更新群成员角色失败:', error);
    }

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'member_promoted',
      targetId: memberId,
      payload: { role: memberToPromote.role },
      includeUserIds: [memberId]
    });

    res.json({ message: '成员已提升为管理员' });
  } catch (error) {
    console.error('提升管理员失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 降级管理员为普通成员
 */
export const demoteGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId, memberId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    const group = await Group.findByPk(groupId);
    if (!group || !group.isActive) {
      return res.status(404).json({ error: '群组不存在' });
    }

    if (group.ownerId !== userId) {
      return res.status(403).json({ error: '只有群主才能降级管理员' });
    }

    const memberToDemote = await GroupMember.findOne({
      where: {
        groupId,
        userId: memberId,
        status: MemberStatus.ACTIVE,
        isActive: true
      }
    });

    if (!memberToDemote) {
      return res.status(404).json({ error: '成员不存在或已被移除' });
    }

    if (memberToDemote.role !== MemberRole.ADMIN) {
      return res.status(400).json({ error: '该成员不是管理员' });
    }

    await memberToDemote.demoteToMember();

    try {
      await ChatMemberState.updateOne(
        { chatId: buildGroupChatId(groupId), userId: memberId },
        { $set: { role: MemberRole.MEMBER } },
        { upsert: true }
      );
    } catch (error) {
      console.warn('更新群成员角色失败:', error);
    }

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'member_demoted',
      targetId: memberId,
      payload: { role: memberToDemote.role },
      includeUserIds: [memberId]
    });

    res.json({ message: '管理员已降级为普通成员' });
  } catch (error) {
    console.error('降级管理员失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 退出群组
 */
export const leaveGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 查找成员身份
    const member = await GroupMember.findOne({
      where: {
        groupId,
        userId,
        status: MemberStatus.ACTIVE,
        isActive: true
      }
    });

    if (!member) {
      return res.status(404).json({ error: '您不是该群组的成员' });
    }

    // 群主不能直接退出，需要先转让群主身份
    if (member.role === MemberRole.OWNER) {
      return res.status(400).json({ error: '群主不能直接退出群组，请先转让群主身份或解散群组' });
    }

    // 退出群组
    await member.leave();

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

    res.json({ message: '已退出群组' });
  } catch (error) {
    console.error('退出群组失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 更新群组信息
 */
export const updateGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { name, description, avatarUrl } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 检查操作权限（管理员或群主才能修改群组信息）
    const hasPermission = await GroupMember.hasPermission(groupId, userId, MemberRole.ADMIN);
    if (!hasPermission) {
      return res.status(403).json({ error: '权限不足' });
    }

    // 查找群组
    const group = await Group.findByPk(groupId);
    if (!group || !group.isActive) {
      return res.status(404).json({ error: '群组不存在' });
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

    res.json({
      message: '群组信息已更新',
      group
    });
  } catch (error) {
    console.error('更新群组信息失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 解散群组
 */
export const deleteGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 查找群组
    const group = await Group.findByPk(groupId);
    if (!group || !group.isActive) {
      return res.status(404).json({ error: '群组不存在' });
    }

    // 只有群主才能解散群组
    if (group.ownerId !== userId) {
      return res.status(403).json({ error: '只有群主才能解散群组' });
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
          status: MemberStatus.ACTIVE
        }
      }
    );

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'group_deleted',
      payload: { groupName: group.name },
      includeUserIds: activeMemberIds
    });

    res.json({ message: '群组已解散' });
  } catch (error) {
    console.error('解散群组失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 转让群主身份
 */
export const transferOwnership = async (req: AuthenticatedRequest, res: Response) => {
  const transaction = await sequelize.transaction();

  try {
    const { groupId } = req.params;
    const { newOwnerId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      await transaction.rollback();
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!newOwnerId) {
      await transaction.rollback();
      return res.status(400).json({ error: '新群主 ID 不能为空' });
    }

    // 查找群组
    const group = await Group.findByPk(groupId, { transaction });
    if (!group || !group.isActive) {
      await transaction.rollback();
      return res.status(404).json({ error: '群组不存在' });
    }

    // 只有群主才能转让群主身份
    if (group.ownerId !== userId) {
      await transaction.rollback();
      return res.status(403).json({ error: '只有群主才能转让群主身份' });
    }

    // 检查新群主是否为群组成员
    const newOwnerMember = await GroupMember.findOne({
      where: {
        groupId,
        userId: newOwnerId,
        status: MemberStatus.ACTIVE,
        isActive: true
      },
      transaction
    });

    if (!newOwnerMember) {
      await transaction.rollback();
      return res.status(400).json({ error: '新群主必须是群组成员' });
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
      return res.status(500).json({ error: '当前群主身份异常' });
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
      console.warn('更新群成员角色状态失败:', error);
    }

    await broadcastGroupUpdate({
      groupId,
      actorId: userId,
      action: 'ownership_transferred',
      targetId: newOwnerId,
      payload: { previousOwnerId: userId }
    });

    res.json({ message: '群主身份转让成功' });
  } catch (error) {
    await transaction.rollback();
    console.error('转让群主身份失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 搜索公开群组
 */
export const searchGroups = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: '搜索关键词至少需要2个字符' });
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

    res.json({
      groups,
      total: groups.length
    });
  } catch (error) {
    console.error('搜索群组失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
