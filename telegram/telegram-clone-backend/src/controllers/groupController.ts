import { Request, Response } from 'express';
import Group, { GroupType } from '../models/Group';
import GroupMember, { MemberRole, MemberStatus } from '../models/GroupMember';
import User from '../models/User';
import { Op } from 'sequelize';
import { sequelize } from '../config/sequelize';

// 扩展请求接口
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
  };
}

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
          as: 'Owner',
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
          as: 'Group',
          where: {
            isActive: true
          },
          include: [
            {
              model: User,
              as: 'Owner',
              attributes: ['id', 'username', 'avatarUrl']
            }
          ]
        }
      ],
      order: [['joinedAt', 'DESC']]
    });
    
    const groups = groupMembers.map(member => ({
      ...member.Group.toJSON(),
      memberRole: member.role,
      joinedAt: member.joinedAt
    }));
    
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
          as: 'Owner',
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
          as: 'User',
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
        currentUserRole: membership.role
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
        }
      } catch (error) {
        errors.push(`添加用户 ${newUserId} 失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // 更新群组成员数量
    await group.updateMemberCount();
    
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
    
    res.json({ message: '成员已被移除' });
  } catch (error) {
    console.error('移除群组成员失败:', error);
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
          as: 'Owner',
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
