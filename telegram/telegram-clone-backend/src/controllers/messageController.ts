import { Request, Response } from 'express';
import Message, { MessageType, MessageStatus } from '../models/Message';
import ChatMemberState from '../models/ChatMemberState';
import ChatCounter from '../models/ChatCounter';
import User from '../models/User';
import Group from '../models/Group';
import GroupMember, { MemberStatus } from '../models/GroupMember';
import { waitForMongoReady } from '../config/db';
import { createAndFanoutMessage } from '../services/messageWriteService';
import { updateService } from '../services/updateService';
import { buildGroupChatId, buildPrivateChatId, getPrivateOtherUserId, parseChatId } from '../utils/chat';

// 扩展请求接口
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
  };
}

const buildAttachments = (msg: any) => {
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    return msg.attachments;
  }
  if (msg.fileUrl) {
    return [{
      fileUrl: msg.fileUrl,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      mimeType: msg.mimeType,
      thumbnailUrl: msg.thumbnailUrl,
    }];
  }
  return null;
};

const formatMessage = (msg: any, userMap: Map<string, string>) => ({
  id: msg.id || msg._id?.toString(),
  chatId: msg.chatId || null,
  groupId: msg.groupId || (msg.isGroupChat ? msg.receiver : null),
  seq: msg.seq || null,
  content: msg.content,
  senderId: msg.sender,
  senderUsername: userMap.get(msg.sender) || '未知用户',
  userId: msg.sender,
  username: userMap.get(msg.sender) || '未知用户',
  receiverId: msg.receiver,
  timestamp: msg.timestamp,
  type: msg.type || 'text',
  status: msg.status,
  isGroupChat: msg.isGroupChat || false,
  attachments: buildAttachments(msg),
  fileUrl: msg.fileUrl || null,
  fileName: msg.fileName || null,
  fileSize: msg.fileSize || null,
  mimeType: msg.mimeType || null,
  thumbnailUrl: msg.thumbnailUrl || null,
});

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

    const chatId = buildPrivateChatId(currentUserId, receiverId);
    const query = {
      $or: [
        { chatId },
        { sender: currentUserId, receiver: receiverId },
        { sender: receiverId, receiver: currentUserId }
      ],
      deletedAt: null,
      isGroupChat: false
    };

    const totalMessages = await Message.countDocuments(query);
    const totalPages = Math.ceil(totalMessages / limit);
    const skip = (page - 1) * limit;

    const rawMessages = await Message.find(query)
      .sort({ seq: -1, timestamp: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const userIds = [...new Set(rawMessages.map(msg => msg.sender))];
    const users = await User.findAll({
      where: { id: userIds },
      attributes: ['id', 'username']
    });
    const userMap = new Map(users.map(user => [user.id, user.username]));

    const formattedMessages = rawMessages
      .slice()
      .reverse()
      .map((msg: any) => formatMessage({ ...msg, chatId: msg.chatId || chatId }, userMap));

    const sortedMessages = formattedMessages;

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
 * 搜索消息
 */
export const searchMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const keyword = (req.query.q as string || '').trim();
    const targetId = req.query.targetId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!keyword || keyword.length < 2) {
      return res.status(400).json({ error: '搜索关键词至少需要2个字符' });
    }

    await waitForMongoReady(15000);

    let participantsCondition: any;

    if (targetId) {
      const isGroupMember = await GroupMember.isMember(targetId, userId);
      if (isGroupMember) {
        participantsCondition = {
          $or: [
            { chatId: buildGroupChatId(targetId) },
            { receiver: targetId }
          ],
          isGroupChat: true
        };
      } else {
        participantsCondition = {
          $or: [
            { sender: userId, receiver: targetId },
            { sender: targetId, receiver: userId }
          ],
          isGroupChat: false
        };
      }
    } else {
      const groupMembers = await GroupMember.findAll({
        where: { userId, isActive: true },
        attributes: ['groupId']
      });
      const groupIds = groupMembers.map((m: any) => m.groupId);
      const groupChatIds = groupIds.map((id: string) => buildGroupChatId(id));

      participantsCondition = {
        $or: [
          { sender: userId },
          { receiver: userId },
          { chatId: { $in: groupChatIds } },
          { receiver: { $in: groupIds } }
        ]
      };
    }

    const messages = await Message.find(
      {
        ...participantsCondition,
        deletedAt: null,
        $text: { $search: keyword }
      },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' }, timestamp: -1 })
      .limit(limit)
      .lean();

    const uniqueUserIds = [...new Set(messages.flatMap((msg) => [msg.sender, msg.receiver]))];
    const users = await User.findAll({
      where: { id: uniqueUserIds },
      attributes: ['id', 'username']
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const formatted = messages.map((msg: any) => {
      const fallbackChatId = msg.isGroupChat
        ? buildGroupChatId(msg.receiver)
        : buildPrivateChatId(msg.sender, msg.receiver);
      return formatMessage({ ...msg, chatId: msg.chatId || fallbackChatId }, userMap);
    });

    res.json({
      messages: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error('搜索消息失败:', error);
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

    const chatId = buildGroupChatId(groupId);
    const query = {
      $or: [
        { chatId },
        { receiver: groupId }
      ],
      deletedAt: null,
      isGroupChat: true
    };

    const totalMessages = await Message.countDocuments(query);
    const totalPages = Math.ceil(totalMessages / limit);
    const skip = (page - 1) * limit;

    const rawMessages = await Message.find(query)
      .sort({ seq: -1, timestamp: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const userIds = [...new Set(rawMessages.map((msg: any) => msg.sender))];
    const users = await User.findAll({
      where: { id: userIds },
      attributes: ['id', 'username']
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const sortedMessages = rawMessages
      .slice()
      .reverse()
      .map((msg: any) => formatMessage({ ...msg, chatId: msg.chatId || chatId, groupId }, userMap));

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
      groupId,
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

    const resolvedIsGroupChat = !!groupId || isGroupChat;
    const resolvedGroupId = resolvedIsGroupChat ? (groupId || receiverId) : undefined;
    const resolvedReceiverId = resolvedIsGroupChat ? undefined : receiverId;

    // 验证必需字段
    if (!receiverId && !resolvedGroupId) {
      return res.status(400).json({ error: '接收者 ID 不能为空' });
    }

    if (!content && !fileUrl) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    // 验证消息类型
    if (!Object.values(MessageType).includes(type)) {
      return res.status(400).json({ error: '无效的消息类型' });
    }

    // 验证接收者存在
    if (!resolvedIsGroupChat && resolvedReceiverId) {
      const receiver = await User.findByPk(resolvedReceiverId);
      if (!receiver) {
        return res.status(404).json({ error: '接收者不存在' });
      }
    }

    if (resolvedIsGroupChat && resolvedGroupId) {
      const group = await Group.findByPk(resolvedGroupId);
      if (!group || !group.isActive) {
        return res.status(404).json({ error: '群组不存在' });
      }
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    const { message } = await createAndFanoutMessage({
      senderId,
      receiverId: resolvedReceiverId,
      groupId: resolvedGroupId,
      content: content?.trim(),
      type,
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      thumbnailUrl
    });

    res.status(201).json({ message: '消息发送成功', data: message });
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

    // 同步更新 ChatMemberState（如果有 seq）
    const messages = await Message.find({ _id: { $in: messageIds } }).lean();
    const chatSeqMap = new Map<string, number>();
    for (const msg of messages) {
      const chatId = msg.chatId || (msg.isGroupChat ? buildGroupChatId(msg.receiver) : buildPrivateChatId(msg.sender, msg.receiver));
      const seq = msg.seq || 0;
      if (!seq) continue;
      const prev = chatSeqMap.get(chatId) || 0;
      if (seq > prev) chatSeqMap.set(chatId, seq);
    }

    await Promise.all(
      Array.from(chatSeqMap.entries()).map(([chatId, seq]) =>
        ChatMemberState.updateOne(
          { chatId, userId },
          { $max: { lastReadSeq: seq }, $set: { lastSeenAt: new Date() } },
          { upsert: true }
        )
      )
    );

    res.json({
      message: '消息已标记为已读',
      updatedCount: result.modifiedCount,
      messageIds
    });
  } catch (error) {
    console.error('标记消息已读失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 标记聊天为已读（按 seq）
 */
export const markChatAsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    const { seq } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!chatId || typeof seq !== 'number') {
      return res.status(400).json({ error: 'chatId 或 seq 不能为空' });
    }

    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    let parsed = parseChatId(chatId);
    if (!parsed) {
      const isMember = await GroupMember.isMember(chatId, userId);
      if (isMember) {
        parsed = { type: 'group', groupId: chatId } as any;
      } else {
        return res.status(400).json({ error: '非法 chatId' });
      }
    }

    // 更新当前用户已读序列
    await ChatMemberState.updateOne(
      { chatId, userId },
      { $max: { lastReadSeq: seq }, $set: { lastSeenAt: new Date() } },
      { upsert: true }
    );

    let readCount = 1;
    // parsed 已在上方确保非空
    if (parsed!.type === 'group' && parsed!.groupId) {
      const members = await GroupMember.findAll({
        where: {
          groupId: parsed!.groupId,
          status: MemberStatus.ACTIVE,
          isActive: true
        },
        attributes: ['userId']
      });
      const memberIds = members.map((m: any) => m.userId);

      readCount = await ChatMemberState.countDocuments({
        chatId,
        userId: { $in: memberIds },
        lastReadSeq: { $gte: seq }
      });

      const notifyIds = memberIds.filter((id) => id !== userId);
      await updateService.appendUpdates(notifyIds, {
        type: 'read',
        chatId,
        seq,
        payload: { readerId: userId, readCount }
      });
    } else if (parsed!.type === 'private') {
      const otherUserId = getPrivateOtherUserId(chatId, userId);
      if (otherUserId) {
        await updateService.appendUpdate({
          userId: otherUserId,
          type: 'read',
          chatId,
          seq,
          payload: { readerId: userId, readCount: 1 }
        });
      }
    }

    res.json({ chatId, seq, readCount });
  } catch (error) {
    console.error('标记聊天已读失败:', error);
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

    const states = await ChatMemberState.find({ userId }).lean();
    if (!states.length) {
      return res.json({ unreadCount: 0 });
    }

    const chatIds = states.map((s) => s.chatId);
    const counters = await ChatCounter.find({ _id: { $in: chatIds } }).lean();
    const counterMap = new Map(counters.map((c: any) => [c._id, c.seq]));

    const unreadCount = states.reduce((sum, state: any) => {
      const lastSeq = counterMap.get(state.chatId) || 0;
      const lastRead = state.lastReadSeq || 0;
      return sum + Math.max(0, lastSeq - lastRead);
    }, 0);

    res.json({ unreadCount });
  } catch (error) {
    console.error('获取未读消息数量失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
