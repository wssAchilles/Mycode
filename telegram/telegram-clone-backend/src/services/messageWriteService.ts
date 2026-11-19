import Message, { MessageStatus, MessageType, IMessage, IAttachment } from '../models/Message';
import ChatCounter from '../models/ChatCounter';
import GroupState from '../models/GroupState';
import { buildChatId, buildGroupChatId, buildPrivateChatId, getChatTypeFromIds } from '../utils/chat';
import { chatRuntimeMetrics } from './chatRuntimeMetrics';
import { advanceChatLastReadSeqWithResult } from '../utils/chatReadState';
import { updateService } from './updateService';
import { buildMessageFanoutCommand } from './chatDelivery/fanoutPlanner';
import { chatFanoutCommandBus } from './chatDelivery/fanoutCommandBus';
import { publishMessagePersistedEvent } from './chatDelivery/messageLifecyclePublisher';
import {
  assertCanSendGroupMessageCached,
  getCachedGroupMemberIds,
  getCachedGroupMeta,
  type CachedGroupMeta,
} from './chatDelivery/writePathCache';

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
  clientTempId?: string; // 离线消息去重 ID
  prefetchedGroupMeta?: CachedGroupMeta; // 上游 controller 已校验的群元信息，避免重复查库
}

export interface MessageWriteResult {
  message: IMessage;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  recipientIds: string[];
  isLargeGroup: boolean;
  fanoutJobId?: string;
  fanoutJobCount?: number;
  isDuplicate?: boolean; // 离线消息重复标记
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

const getGroupMetaOrThrow = async (groupId: string): Promise<CachedGroupMeta> => {
  const meta = await getCachedGroupMeta(groupId);
  if (!meta) {
    throw new Error('群组不存在');
  }
  if (!meta.isActive) {
    throw new Error('群组已被解散');
  }
  return meta;
};

const findDuplicateByClientTempId = async (chatId: string, clientTempId?: string) => {
  if (!clientTempId) return null;
  return Message.findOne({
    chatId,
    'metadata.clientTempId': clientTempId,
  }).lean();
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
  let groupMeta: CachedGroupMeta | null = null;
  let existing: any = null;

  if (chatType === 'group') {
    if (!input.groupId) throw new Error('groupId 不能为空');
    const groupMetaTask = input.prefetchedGroupMeta
      ? Promise.resolve(input.prefetchedGroupMeta).then((meta) => {
          if (!meta.isActive) throw new Error('群组已被解散');
          return meta;
        })
      : getGroupMetaOrThrow(input.groupId);

    // 并行执行群元信息、发送者权限与 clientTempId 幂等查重，避免多趟串行跨区域往返
    const [resolvedMeta, , duplicateDoc] = await Promise.all([
      groupMetaTask,
      assertCanSendGroupMessageCached(input.groupId, input.senderId),
      findDuplicateByClientTempId(chatId, input.clientTempId),
    ]);
    groupMeta = resolvedMeta;
    existing = duplicateDoc;
  } else {
    if (!input.receiverId) {
      throw new Error('receiverId 不能为空');
    }
    existing = await findDuplicateByClientTempId(chatId, input.clientTempId);
  }

  // 先执行 clientTempId 幂等去重，仅当确认为全新消息时再分配单调递增 seq，根除重试造成的序号空洞
  if (existing) {
    chatRuntimeMetrics.increment('message.write.dedupHit');
    return {
      message: existing as unknown as IMessage,
      chatId,
      chatType,
      seq: existing.seq || 0,
      recipientIds: [],
      isLargeGroup: false,
      isDuplicate: true,
    };
  }

  const shouldFanout = chatType === 'private'
    || (groupMeta?.memberCount ?? 0) <= LARGE_GROUP_FANOUT_THRESHOLD;

  // 并行分配递增 seq 与获取扩散成员列表
  const [seq, recipientIds] = await Promise.all([
    getNextSeq(chatId),
    chatType === 'group'
      ? (shouldFanout
          ? getCachedGroupMemberIds(input.groupId as string)
          : Promise.resolve([input.senderId]))
      : Promise.resolve(Array.from(new Set([input.senderId, input.receiverId as string]))),
  ]);

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

  if (input.clientTempId) {
    messageDoc.metadata = { ...messageDoc.metadata, clientTempId: input.clientTempId };
  }

  const message = await Message.create(messageDoc);
  const messageIdStr = message._id.toString();

  // 消息落库后，将彼此独立的发送者水位推进、异步扩散分发与生命周期事件并行执行，压缩尾延迟
  const senderReadStateTask = (async () => {
    const senderReadState = await advanceChatLastReadSeqWithResult(chatId, input.senderId, seq, {
      updateDeliveredSeq: true,
    });
    if (
      chatType === 'private'
      && input.receiverId
      && input.receiverId !== input.senderId
      && seq > 1
      && senderReadState.previousSeq < seq - 1
    ) {
      try {
        await updateService.appendUpdate({
          userId: input.receiverId,
          type: 'read',
          chatId,
          seq: seq - 1,
          payload: { readerId: input.senderId, readCount: 1 },
        });
      } catch {
        // 隐式已读更新属于 best-effort，不阻断主消息写入链路
      }
    }
  })();

  const fanoutTask = (async (): Promise<{ fanoutJobId?: string; fanoutJobCount: number }> => {
    let fanoutJobId: string | undefined;
    let fanoutJobCount = 0;

    if (chatType === 'private' || shouldFanout) {
      const command = buildMessageFanoutCommand({
        messageId: messageIdStr,
        chatId,
        chatType,
        seq,
        senderId: input.senderId,
        recipientIds,
        topology: 'eager',
      });
      chatRuntimeMetrics.observeValue('messageWrite.fanout.recipients', command.recipientIds.length);
      if (command.recipientIds.length > 0) {
        const dispatch = await chatFanoutCommandBus.dispatch(command);
        fanoutJobId = dispatch.jobId;
        fanoutJobCount = dispatch.jobCount;
        if (dispatch.mode === 'queued') {
          chatRuntimeMetrics.increment('messageWrite.fanout.queue.success');
          chatRuntimeMetrics.observeValue('messageWrite.fanout.queue.jobs', fanoutJobCount);
        } else if (dispatch.mode === 'go_primary') {
          chatRuntimeMetrics.increment('messageWrite.fanout.goPrimary.queued');
          chatRuntimeMetrics.observeValue('messageWrite.fanout.goPrimary.jobs', fanoutJobCount);
        } else if (dispatch.mode === 'sync_fallback') {
          chatRuntimeMetrics.increment('messageWrite.fanout.queue.fallback');
          chatRuntimeMetrics.observeValue(
            'messageWrite.fanout.fallback.chunks',
            dispatch.projection?.chunkCount || 0,
          );
        }
      }
    } else if (chatType === 'group' && !shouldFanout) {
      // P2: 大群读扩散 - 更新群组全局状态
      await GroupState.findOneAndUpdate(
        { _id: input.groupId },
        {
          $set: {
            lastSeq: seq,
            lastMessageId: messageIdStr,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      console.log(`[P2] 大群 ${input.groupId} GroupState 已更新: seq=${seq}`);
    }

    return { fanoutJobId, fanoutJobCount };
  })();

  const lifecycleEventTask = publishMessagePersistedEvent({
    messageId: messageIdStr,
    chatId,
    chatType,
    seq,
    senderId: input.senderId,
    recipientIds,
    topology: chatType === 'group' && !shouldFanout ? 'large_group_compat' : 'eager',
    dispatchPlanned: chatType === 'private' || shouldFanout,
    isLargeGroup: chatType === 'group' && !shouldFanout,
  });

  const [, fanoutResult] = await Promise.all([
    senderReadStateTask,
    fanoutTask,
    lifecycleEventTask,
  ]);

  return {
    message,
    chatId,
    chatType,
    seq,
    recipientIds,
    isLargeGroup: chatType === 'group' && !shouldFanout,
    fanoutJobId: fanoutResult.fanoutJobId,
    fanoutJobCount: fanoutResult.fanoutJobCount,
  };
};

export const getPrivateChatIdForUsers = (userId1: string, userId2: string): string =>
  buildPrivateChatId(userId1, userId2);

export const getGroupChatId = (groupId: string): string => buildGroupChatId(groupId);
