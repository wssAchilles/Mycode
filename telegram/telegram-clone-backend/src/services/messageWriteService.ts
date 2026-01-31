import Message, { MessageStatus, MessageType, IMessage, IAttachment } from '../models/Message';
import ChatCounter from '../models/ChatCounter';
import ChatMemberState from '../models/ChatMemberState';
import Group from '../models/Group';
import GroupMember, { MemberStatus } from '../models/GroupMember';
import { buildChatId, buildGroupChatId, buildPrivateChatId, getChatTypeFromIds } from '../utils/chat';
import { updateService } from './updateService';

interface CreateMessageInput {
  senderId: string;
  receiverId?: string;
  groupId?: string;
  chatType?: 'private' | 'group';
  content?: string;
  type?: MessageType;
  attachments?: IAttachment[];
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  replyTo?: string;
}

export interface MessageWriteResult {
  message: IMessage;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  recipientIds: string[];
  isLargeGroup: boolean;
}

const LARGE_GROUP_FANOUT_THRESHOLD = Math.max(
  Number.parseInt(process.env.GROUP_FANOUT_THRESHOLD || '500', 10) || 500,
  50
);

const getNextSeq = async (chatId: string): Promise<number> => {
  const doc = await ChatCounter.findOneAndUpdate(
    { _id: chatId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean();
  return doc?.seq || 1;
};

const getGroupMemberIds = async (groupId: string): Promise<string[]> => {
  const members = await GroupMember.findAll({
    where: {
      groupId,
      status: MemberStatus.ACTIVE,
      isActive: true,
    },
    attributes: ['userId'],
  });
  return members.map((m: any) => m.userId);
};

const getGroupMeta = async (groupId: string): Promise<{ memberCount: number; isActive: boolean }> => {
  const group = await Group.findByPk(groupId, { attributes: ['id', 'isActive', 'memberCount'] });
  if (!group) {
    throw new Error('群组不存在');
  }
  if (!(group as any).isActive) {
    throw new Error('群组已被解散');
  }
  return {
    memberCount: (group as any).memberCount || 0,
    isActive: (group as any).isActive,
  };
};

const assertCanSendGroupMessage = async (groupId: string, userId: string): Promise<void> => {
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

  if (member.status === MemberStatus.MUTED) {
    const mutedUntil = (member as any).mutedUntil as Date | null;
    if (mutedUntil && mutedUntil > new Date()) {
      throw new Error('您已被禁言');
    }
    // 禁言到期，自动恢复
    if (mutedUntil && mutedUntil <= new Date()) {
      (member as any).status = MemberStatus.ACTIVE;
      (member as any).mutedUntil = null;
      await member.save();
    }
  }
};

const normalizeContent = (content?: string, attachments?: IAttachment[], fileName?: string): string => {
  const trimmed = (content || '').trim();
  if (trimmed) return trimmed;
  if (attachments && attachments.length > 0) {
    return attachments[0].fileName || fileName || '附件';
  }
  return ' '; // 保证 content 非空
};

const buildAttachments = (input: CreateMessageInput): IAttachment[] | undefined => {
  if (input.attachments && input.attachments.length > 0) return input.attachments;
  if (input.fileUrl) {
    return [
      {
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        thumbnailUrl: input.thumbnailUrl,
      },
    ];
  }
  return undefined;
};

export const createAndFanoutMessage = async (input: CreateMessageInput): Promise<MessageWriteResult> => {
  const derivedChatType = getChatTypeFromIds(input.groupId) as 'private' | 'group';
  const chatType = input.chatType || derivedChatType;
  if (input.chatType && input.chatType !== derivedChatType) {
    throw new Error('chatType 与 groupId 不一致');
  }
  const chatId = buildChatId(input.senderId, input.receiverId, input.groupId);
  let groupMeta: { memberCount: number; isActive: boolean } | null = null;

  if (chatType === 'group') {
    if (!input.groupId) throw new Error('groupId 不能为空');
    groupMeta = await getGroupMeta(input.groupId);
    await assertCanSendGroupMessage(input.groupId, input.senderId);
  } else if (!input.receiverId) {
    throw new Error('receiverId 不能为空');
  }

  const seq = await getNextSeq(chatId);
  const attachments = buildAttachments(input);
  const content = normalizeContent(input.content, attachments, input.fileName);

  const messageDoc: any = {
    sender: input.senderId,
    receiver: input.groupId || input.receiverId,
    chatId,
    chatType,
    groupId: input.groupId || null,
    seq,
    type: input.type || MessageType.TEXT,
    content,
    isGroupChat: chatType === 'group',
    status: MessageStatus.DELIVERED,
    attachments: attachments || null,
    replyTo: input.replyTo || null,
    fileUrl: null,
    fileName: null,
    fileSize: null,
    mimeType: null,
    thumbnailUrl: null,
  };

  if (attachments && attachments.length > 0) {
    const first = attachments[0];
    messageDoc.fileUrl = first.fileUrl || null;
    messageDoc.fileName = first.fileName || null;
    messageDoc.fileSize = first.fileSize || null;
    messageDoc.mimeType = first.mimeType || null;
    messageDoc.thumbnailUrl = first.thumbnailUrl || null;
  } else {
    messageDoc.fileUrl = input.fileUrl || null;
    messageDoc.fileName = input.fileName || null;
    messageDoc.fileSize = input.fileSize || null;
    messageDoc.mimeType = input.mimeType || null;
    messageDoc.thumbnailUrl = input.thumbnailUrl || null;
  }

  const message = await Message.create(messageDoc);

  let recipientIds: string[] = [];
  let shouldFanout = true;
  if (chatType === 'group') {
    const memberCount = groupMeta?.memberCount ?? (await getGroupMeta(input.groupId as string)).memberCount;
    shouldFanout = memberCount <= LARGE_GROUP_FANOUT_THRESHOLD;
    recipientIds = shouldFanout
      ? await getGroupMemberIds(input.groupId as string)
      : [input.senderId];
  } else {
    recipientIds = Array.from(new Set([input.senderId, input.receiverId as string]));
  }

  // 更新成员状态（送达）
  if (chatType === 'private' || shouldFanout) {
    await Promise.all(
      recipientIds.map((userId) =>
        ChatMemberState.updateOne(
          { chatId, userId },
          { $max: { lastDeliveredSeq: seq }, $setOnInsert: { lastReadSeq: 0 } },
          { upsert: true }
        )
      )
    );
  }

  // 发送者视为已读
  await ChatMemberState.updateOne(
    { chatId, userId: input.senderId },
    { $max: { lastReadSeq: seq, lastDeliveredSeq: seq }, $set: { lastSeenAt: new Date() } },
    { upsert: true }
  );

  if (chatType === 'private' || shouldFanout) {
    await updateService.appendUpdates(recipientIds, {
      type: 'message',
      chatId,
      seq,
      messageId: message._id.toString(),
    });
  }

  return { message, chatId, chatType, seq, recipientIds, isLargeGroup: chatType === 'group' && !shouldFanout };
};

export const getPrivateChatIdForUsers = (userId1: string, userId2: string): string =>
  buildPrivateChatId(userId1, userId2);

export const getGroupChatId = (groupId: string): string => buildGroupChatId(groupId);
