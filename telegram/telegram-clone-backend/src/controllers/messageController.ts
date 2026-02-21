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

const LEGACY_MESSAGES_SUNSET = process.env.LEGACY_MESSAGES_SUNSET || 'Sat, 01 Aug 2026 00:00:00 GMT';

const setLegacyEndpointHeaders = (res: Response, successorPath: string) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', LEGACY_MESSAGES_SUNSET);
  res.set('Link', `<${successorPath}>; rel="successor-version"`);
  res.set('X-Legacy-Endpoint', 'true');
};

const sendLegacyEndpointGone = (res: Response, endpoint: string, successorPath: string) => {
  setLegacyEndpointHeaders(res, successorPath);
  return res.status(410).json({
    error: `${endpoint} 已下线，请迁移到 cursor 接口`,
    successor: successorPath,
  });
};

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

const formatMessage = (msg: any, userMap: Map<string, string>) => {
  const parsed = msg.chatId ? parseChatId(msg.chatId) : null;
  const chatType = msg.chatType || parsed?.type || (msg.isGroupChat ? 'group' : 'private');
  const groupId = msg.groupId || (parsed?.type === 'group' ? parsed.groupId : null);
  return {
    id: msg.id || msg._id?.toString(),
    chatId: msg.chatId || null,
    groupId,
    chatType,
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
    isGroupChat: chatType === 'group',
    attachments: buildAttachments(msg),
    fileUrl: msg.fileUrl || null,
    fileName: msg.fileName || null,
    fileSize: msg.fileSize || null,
    mimeType: msg.mimeType || null,
    thumbnailUrl: msg.thumbnailUrl || null,
  };
};

const parseOptionalPositiveInt = (value: unknown): number | undefined | null => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

const buildSeqCursorFilter = (beforeSeq?: number, afterSeq?: number) => {
  const filter: Record<string, number | string> = { $type: 'number' };
  if (typeof beforeSeq === 'number') {
    filter.$lt = beforeSeq;
  }
  if (typeof afterSeq === 'number') {
    filter.$gt = afterSeq;
  }
  return filter;
};

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
    const successorPath = currentUserId && receiverId
      ? `/api/messages/chat/${encodeURIComponent(buildPrivateChatId(currentUserId, receiverId))}`
      : '/api/messages/chat/:chatId';

    setLegacyEndpointHeaders(res, successorPath);
    return sendLegacyEndpointGone(res, '/api/messages/conversation/:receiverId', successorPath);
  } catch (error) {
    console.error('获取聊天记录失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取聊天消息（统一 cursor API）
 * - chatId: private => p:userA:userB, group => g:groupId
 * - beforeSeq/afterSeq: cursor
 */
export const getChatMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Message-Cursor-Only': 'true',
    });

    const currentUserId = req.user?.id;
    const { chatId: rawChatId } = req.params;

    if (!currentUserId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    if (!rawChatId) {
      return res.status(400).json({ error: 'chatId 不能为空' });
    }

    const parsed = parseChatId(rawChatId);
    if (!parsed) {
      return res.status(400).json({ error: 'chatId 格式无效' });
    }

    // Canonicalize chatId to avoid private-chat cache/query split caused by non-sorted ids.
    // e.g. p:b:a -> p:a:b
    const chatId =
      parsed.type === 'private' && parsed.userIds && parsed.userIds.length === 2
        ? buildPrivateChatId(parsed.userIds[0], parsed.userIds[1])
        : rawChatId;

    // 游标分页参数
    const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);
    const beforeSeq = parseOptionalPositiveInt(req.query.beforeSeq);
    const afterSeq = parseOptionalPositiveInt(req.query.afterSeq);

    if (beforeSeq === null || afterSeq === null) {
      return res.status(400).json({ error: 'beforeSeq/afterSeq 必须为正整数' });
    }
    if (beforeSeq !== undefined && afterSeq !== undefined) {
      return res.status(400).json({ error: 'beforeSeq 与 afterSeq 不能同时传入' });
    }

    const mode: 'before' | 'after' = afterSeq !== undefined ? 'after' : 'before';

    // Access checks
    if (parsed.type === 'group') {
      const groupId = parsed.groupId as string;
      const isMember = await GroupMember.isMember(groupId, currentUserId);
      if (!isMember) {
        return res.status(403).json({ error: '您不是该群组成员，无权查看消息' });
      }
      const group = await Group.findByPk(groupId, { attributes: ['id', 'isActive'] });
      if (!group || !(group as any).isActive) {
        return res.status(404).json({ error: '群组不存在' });
      }
    } else if (parsed.type === 'private') {
      if (!parsed.userIds || parsed.userIds.length !== 2 || !parsed.userIds.includes(currentUserId)) {
        return res.status(403).json({ error: '无权查看该私聊消息' });
      }
    }

    // 确保 MongoDB 就绪
    try {
      await waitForMongoReady(15000);
    } catch (e) {
      return res.status(503).json({ error: '数据库未就绪，请稍后重试' });
    }

    const isGroupChat = parsed.type === 'group';
    const seqFilter = buildSeqCursorFilter(beforeSeq, afterSeq);

    const sort =
      mode === 'after'
        ? ({ seq: 1 as const, _id: 1 as const })
        : ({ seq: -1 as const, _id: -1 as const });
    const fetchLimit = limit + 1;

    const canonicalQuery: any = {
      deletedAt: null,
      isGroupChat,
      chatId,
      seq: seqFilter,
    };

    const canonicalMessages = await Message.find(canonicalQuery)
      .sort(sort)
      .limit(fetchLimit)
      .lean();

    const orderedMessages = canonicalMessages;

    const hasMore = orderedMessages.length > limit;
    const rawPage = hasMore ? orderedMessages.slice(0, limit) : orderedMessages;

    // Output order keeps historical behavior: oldest -> newest.
    const rawMessages = mode === 'before' ? rawPage.slice().reverse() : rawPage;

    const userIds = [...new Set(rawMessages.map((msg: any) => msg.sender))];
    const users = await User.findAll({
      where: { id: userIds },
      attributes: ['id', 'username']
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const sortedMessages = rawMessages.map((msg: any) => formatMessage({ ...msg, chatId }, userMap));

    const firstSeq = sortedMessages.length ? sortedMessages[0].seq : null;
    const lastSeq = sortedMessages.length ? sortedMessages[sortedMessages.length - 1].seq : null;
    const nextBeforeSeq = mode === 'before' ? firstSeq : null;
    const nextAfterSeq = mode === 'after' ? lastSeq : null;
    const latestSeq = lastSeq;

    res.json({
      messages: sortedMessages,
      paging: {
        hasMore,
        nextBeforeSeq,
        nextAfterSeq,
        latestSeq,
        mode,
        limit
      },
    });
  } catch (error) {
    console.error('获取聊天消息失败:', error);
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
          chatId: buildGroupChatId(targetId),
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
          { chatId: { $in: groupChatIds } }
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
 * 获取消息上下文（以 seq 为锚点）
 */
export const getMessageContext = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const chatId = req.query.chatId as string | undefined;
    const seq = parseInt(req.query.seq as string, 10);
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }

    if (!chatId || !Number.isFinite(seq)) {
      return res.status(400).json({ error: 'chatId 和 seq 不能为空' });
    }

    const parsed = parseChatId(chatId);
    if (!parsed) {
      return res.status(400).json({ error: 'chatId 格式无效' });
    }

    const canonicalChatId =
      parsed.type === 'private' && parsed.userIds && parsed.userIds.length === 2
        ? buildPrivateChatId(parsed.userIds[0], parsed.userIds[1])
        : chatId;

    if (parsed.type === 'group') {
      const groupId = parsed.groupId as string;
      const isMember = await GroupMember.isMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({ error: '您不是该群组成员，无权查看消息' });
      }
    } else if (parsed.type === 'private') {
      if (!parsed.userIds || !parsed.userIds.includes(userId)) {
        return res.status(403).json({ error: '无权查看该私聊消息' });
      }
    }

    await waitForMongoReady(15000);

    const half = Math.floor(limit / 2);
    const startSeq = Math.max(seq - half, 1);
    const endSeq = seq + half;

    const baseCanonicalMatch: any = {
      chatId: canonicalChatId,
      isGroupChat: parsed.type === 'group',
    };

    const seqRangeFilter = { $gte: startSeq, $lte: endSeq, $type: 'number' };
    const beforeSeqFilter = { $lt: startSeq, $type: 'number' };
    const afterSeqFilter = { $gt: endSeq, $type: 'number' };

    const listMatch: any = {
      ...baseCanonicalMatch,
      deletedAt: null,
      seq: seqRangeFilter,
    };
    const beforeMatch: any = {
      ...baseCanonicalMatch,
      deletedAt: null,
      seq: beforeSeqFilter,
    };
    const afterMatch: any = {
      ...baseCanonicalMatch,
      deletedAt: null,
      seq: afterSeqFilter,
    };

    const rawMessages = await Message.find(listMatch)
      .sort({ seq: 1, _id: 1 })
      .lean();

    const userIds = [...new Set(rawMessages.map((msg: any) => msg.sender))];
    const users = await User.findAll({
      where: { id: userIds },
      attributes: ['id', 'username']
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const messages = rawMessages.map((msg: any) => formatMessage({ ...msg, chatId: canonicalChatId }, userMap));

    const [beforeCount, afterCount] = await Promise.all([
      Message.countDocuments(beforeMatch),
      Message.countDocuments(afterMatch)
    ]);

    res.json({
      chatId: canonicalChatId,
      seq,
      messages,
      hasMoreBefore: beforeCount > 0,
      hasMoreAfter: afterCount > 0
    });
  } catch (error) {
    console.error('获取消息上下文失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取群聊消息
 */
export const getGroupMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const successorPath = groupId
      ? `/api/messages/chat/${encodeURIComponent(buildGroupChatId(groupId))}`
      : '/api/messages/chat/:chatId';

    setLegacyEndpointHeaders(res, successorPath);
    return sendLegacyEndpointGone(res, '/api/messages/group/:groupId', successorPath);
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
      chatType,
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

    if (!chatType || (chatType !== 'private' && chatType !== 'group')) {
      return res.status(400).json({ error: 'chatType 必须为 private 或 group' });
    }
    const resolvedGroupId = chatType === 'group' ? groupId : undefined;
    const resolvedReceiverId = chatType === 'private' ? receiverId : undefined;

    // 验证必需字段
    if (chatType === 'group' && !resolvedGroupId) {
      return res.status(400).json({ error: 'groupId 不能为空' });
    }
    if (chatType === 'private' && !resolvedReceiverId) {
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
    if (chatType === 'private' && resolvedReceiverId) {
      const receiver = await User.findByPk(resolvedReceiverId);
      if (!receiver) {
        return res.status(404).json({ error: '接收者不存在' });
      }
    }

    if (chatType === 'group' && resolvedGroupId) {
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
      chatType,
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

    const parsed = parseChatId(chatId);
    if (!parsed) {
      return res.status(400).json({ error: '非法 chatId' });
    }

    // 更新当前用户已读序列
    await ChatMemberState.updateOne(
      { chatId, userId },
      { $max: { lastReadSeq: seq }, $set: { lastSeenAt: new Date() } },
      { upsert: true }
    );

    let readCount = 1;
    // parsed 已在上方确保非空
    if (parsed.type === 'group' && parsed.groupId) {
      const isMember = await GroupMember.isMember(parsed.groupId, userId);
      if (!isMember) {
        return res.status(403).json({ error: '您不是该群组成员' });
      }

      readCount = await ChatMemberState.countDocuments({
        chatId,
        lastReadSeq: { $gte: seq }
      });
    } else if (parsed.type === 'private') {
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
