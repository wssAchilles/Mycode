import { Request, Response } from 'express';
import Message, { MessageType, MessageStatus } from '../models/Message';
import User from '../models/User';
import GroupMember from '../models/GroupMember';
import { waitForMongoReady } from '../config/db';

// 扩展请求接口
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
  };
}

/**
 * 获取与特定用户的聊天记录
 */
export const getConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 禁用缓存，确保返回最新数据
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const { receiverId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!receiverId) {
      return res.status(400).json({ error: '接收者 ID 不能为空' });
    }

    // 获取分页参数
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100); // 最多100条

    // 验证接收者是否存在
    const receiver = await User.findByPk(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: '接收者不存在' });
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    // 获取聊天记录
    const rawMessages = await Message.getConversation(currentUserId, receiverId, page, limit);

    // 获取所有相关用户的信息
    const userIds = [...new Set(rawMessages.map(msg => msg.sender))];
    const users = await User.findAll({
      where: {
        id: userIds
      },
      attributes: ['id', 'username']
    });

    // 创建用户ID到用户名的映射
    const userMap = new Map(users.map(user => [user.id, user.username]));

    // 转换消息格式，添加正确的字段名
    const formattedMessages = rawMessages.map(msg => ({
      id: msg.id || msg._id?.toString(),
      content: msg.content,
      senderId: msg.sender,  // 原来的 sender 字段映射到 senderId
      senderUsername: userMap.get(msg.sender) || '未知用户',
      userId: msg.sender,    // 兼容字段
      username: userMap.get(msg.sender) || '未知用户',  // 兼容字段
      timestamp: msg.timestamp,
      type: msg.type || 'text',
      status: msg.status,
      isGroupChat: msg.isGroupChat || false,
      // 文件相关字段
      fileUrl: msg.fileUrl || null,
      fileName: msg.fileName || null,
      fileSize: msg.fileSize || null,
      mimeType: msg.mimeType || null,
      thumbnailUrl: msg.thumbnailUrl || null
    }));

    // MongoDB已经按时间降序排列（最新在前），前端会反转显示（最新在底部）
    const sortedMessages = formattedMessages;

    // 获取总消息数（用于分页信息）
    const totalMessages = await Message.countDocuments({
      $or: [
        { sender: currentUserId, receiver: receiverId },
        { sender: receiverId, receiver: currentUserId }
      ],
      deletedAt: null,
      isGroupChat: false
    });

    const totalPages = Math.ceil(totalMessages / limit);
    const hasMore = page < totalPages;

    res.json({
      messages: sortedMessages,
      pagination: {
        currentPage: page,
        totalPages,
        totalMessages,
        hasMore,
        limit
      }
    });
  } catch (error) {
    console.error('获取聊天记录失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取群聊消息
 */
export const getGroupMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!groupId) {
      return res.status(400).json({ error: '群组 ID 不能为空' });
    }

    // 获取分页参数
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // 验证用户是否为群组成员
    const isMember = await GroupMember.isMember(groupId, currentUserId);
    if (!isMember) {
      return res.status(403).json({ error: '您不是该群组成员，无权查看消息' });
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    // 获取群聊消息
    const messages = await Message.getGroupMessages(groupId, page, limit);

    // 反转数组
    const sortedMessages = messages.reverse();

    // 获取总消息数
    const totalMessages = await Message.countDocuments({
      receiver: groupId,
      deletedAt: null,
      isGroupChat: true
    });

    const totalPages = Math.ceil(totalMessages / limit);
    const hasMore = page < totalPages;

    res.json({
      messages: sortedMessages,
      pagination: {
        currentPage: page,
        totalPages,
        totalMessages,
        hasMore,
        limit
      }
    });
  } catch (error) {
    console.error('获取群聊消息失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 发送消息（HTTP API）
 */
export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      receiverId,
      content,
      type = MessageType.TEXT,
      isGroupChat = false,
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      thumbnailUrl
    } = req.body;
    const senderId = req.user?.id;

    if (!senderId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 验证必需字段
    if (!receiverId || !content) {
      return res.status(400).json({ error: '接收者 ID 和消息内容不能为空' });
    }

    // 验证消息类型
    if (!Object.values(MessageType).includes(type)) {
      return res.status(400).json({ error: '无效的消息类型' });
    }

    // 验证接收者存在
    if (!isGroupChat) {
      const receiver = await User.findByPk(receiverId);
      if (!receiver) {
        return res.status(404).json({ error: '接收者不存在' });
      }
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    // 创建新消息
    const newMessage = new Message({
      sender: senderId,
      receiver: receiverId,
      content: content.trim(),
      type,
      isGroupChat,
      status: MessageStatus.SENT,
      // 文件相关字段
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      fileSize: fileSize || null,
      mimeType: mimeType || null,
      thumbnailUrl: thumbnailUrl || null
    });

    // 保存到数据库
    const savedMessage = await newMessage.save();

    res.status(201).json({
      message: '消息发送成功',
      data: savedMessage
    });
  } catch (error) {
    console.error('发送消息失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 标记消息为已读
 */
export const markMessagesAsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { messageIds } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: '消息 ID 列表不能为空' });
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    // 标记消息为已读
    const result = await Message.markAsRead(messageIds, userId);

    res.json({
      message: '消息已标记为已读',
      updatedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('标记消息已读失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 删除消息（软删除）
 */
export const deleteMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!messageId) {
      return res.status(400).json({ error: '消息 ID 不能为空' });
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    // 查找消息
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: '消息不存在' });
    }

    // 验证权限（只有发送者可以删除消息）
    if (message.sender !== userId) {
      return res.status(403).json({ error: '无权删除此消息' });
    }

    // 软删除消息
    await message.softDelete();

    res.json({ message: '消息已删除' });
  } catch (error) {
    console.error('删除消息失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 编辑消息
 */
export const editMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!messageId || !content) {
      return res.status(400).json({ error: '消息 ID 和内容不能为空' });
    }

    // 查找消息
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: '消息不存在' });
    }

    // 验证权限
    if (message.sender !== userId) {
      return res.status(403).json({ error: '无权编辑此消息' });
    }

    // 编辑消息
    await message.editContent(content.trim());

    res.json({
      message: '消息已编辑',
      data: message
    });
  } catch (error) {
    console.error('编辑消息失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取未读消息数量
 */
export const getUnreadCount = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    // 统计未读消息数量
    const unreadCount = await Message.countDocuments({
      receiver: userId,
      status: { $ne: MessageStatus.READ },
      deletedAt: null
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error('获取未读消息数量失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
