import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import GroupMember, { MemberStatus } from '../../models/GroupMember';
import { buildGroupChatId, buildPrivateChatId, parseChatId } from '../../utils/chat';
import { createChildLogger } from '../../utils/logger';
import { getSocketService } from '../socketRegistry';
import { updateService } from '../updateService';
import type {
  MessageMutationAction,
  MessageMutationRealtimePayload,
  MessageReactionSummary,
} from './contracts';

const log = createChildLogger('services:realtimeEvents:messageMutation');

export interface MessageMutationInput {
  _id?: unknown;
  id?: string;
  chatId?: string | null;
  chatType?: string | null;
  isGroupChat?: boolean;
  groupId?: string | null;
  sender?: string | null;
  receiver?: string | null;
  seq?: number | null;
  content?: string | null;
  editedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  reactions?: MessageReactionSummary[] | null;
}

function resolveChatMeta(message: MessageMutationInput): {
  chatId: string;
  chatType: 'private' | 'group';
  groupId: string | null;
} {
  const parsed = message.chatId ? parseChatId(message.chatId) : null;
  const chatType: 'private' | 'group' =
    message.chatType === 'group' || message.isGroupChat || parsed?.type === 'group'
      ? 'group'
      : 'private';

  const groupId =
    message.groupId ||
    (parsed?.type === 'group' ? parsed.groupId : null) ||
    (chatType === 'group' && message.receiver ? String(message.receiver) : null);

  const chatId =
    message.chatId ||
    (chatType === 'group' && groupId
      ? buildGroupChatId(groupId)
      : message.sender && message.receiver
        ? buildPrivateChatId(String(message.sender), String(message.receiver))
        : '');

  return { chatId, chatType, groupId };
}

async function resolveTargetUserIds(
  chatId: string,
  chatType: 'private' | 'group',
  groupId: string | null,
  message: MessageMutationInput,
  actorId: string,
): Promise<string[]> {
  if (chatType === 'group' && groupId) {
    try {
      const members = await GroupMember.findAll({
        where: {
          groupId,
          status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
          isActive: true,
        },
        attributes: ['userId'],
      });
      return Array.from(new Set(members.map((m: any) => String(m.userId)).filter(Boolean)));
    } catch (err) {
      log.warn({ err, groupId }, '查询群活跃成员用于消息变更同步失败');
      return actorId ? [actorId] : [];
    }
  }

  const parsed = chatId ? parseChatId(chatId) : null;
  const candidates = [
    ...(parsed?.userIds || []),
    message.sender ? String(message.sender) : '',
    message.receiver ? String(message.receiver) : '',
    actorId,
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

async function broadcastMessageMutation(
  action: MessageMutationAction,
  message: MessageMutationInput,
  actorId: string,
): Promise<void> {
  try {
    const messageId = message.id || (message._id ? String(message._id) : '');
    const { chatId, chatType, groupId } = resolveChatMeta(message);
    if (!messageId || !chatId) return;

    const emittedAt = new Date().toISOString();
    const toIso = (val: Date | string | null | undefined): string | undefined => {
      if (!val) return undefined;
      return val instanceof Date ? val.toISOString() : String(val);
    };

    const payload: MessageMutationRealtimePayload = {
      eventId: randomUUID(),
      emittedAt,
      action,
      chatId,
      chatType,
      groupId,
      messageId,
      seq: typeof message.seq === 'number' ? message.seq : null,
      actorId,
      ...(action === 'edited'
        ? {
            content: String(message.content ?? ''),
            editedAt: toIso(message.editedAt) ?? emittedAt,
          }
        : action === 'reaction_updated'
          ? {
              reactions: Array.isArray(message.reactions) ? message.reactions : [],
            }
          : {
              deletedAt: toIso(message.deletedAt) ?? emittedAt,
            }),
    };

    const recipientIds = await resolveTargetUserIds(chatId, chatType, groupId, message, actorId);
    if (recipientIds.length > 0 && action !== 'reaction_updated') {
      await updateService.appendUpdates(recipientIds, {
        type: action === 'edited' ? 'message_edit' : 'message_delete',
        chatId,
        seq: typeof message.seq === 'number' ? message.seq : undefined,
        messageId,
        payload,
      });
    }

    const socketService = getSocketService();
    if (!socketService) return;

    if (chatType === 'group' && groupId) {
      socketService.emitRealtimeToRoom(groupId, {
        type: 'messageMutation',
        payload,
      });
    } else if (recipientIds.length > 0) {
      socketService.emitRealtimeToUsers(recipientIds, {
        type: 'messageMutation',
        payload,
      });
    }
  } catch (err) {
    log.warn({ err, action, actorId }, '广播消息编辑/撤回实时事件失败');
  }
}

/**
 * 广播消息编辑事件至会话内全部在线与离线成员
 */
export async function broadcastMessageEdited(
  message: MessageMutationInput,
  actorId: string,
): Promise<void> {
  await broadcastMessageMutation('edited', message, actorId);
}

/**
 * 广播消息删除/撤回事件至会话内全部在线与离线成员
 */
export async function broadcastMessageDeleted(
  message: MessageMutationInput,
  actorId: string,
): Promise<void> {
  await broadcastMessageMutation('deleted', message, actorId);
}

/**
 * 广播消息表情回应更新事件至会话内在线成员
 */
export async function broadcastMessageReactionUpdated(
  message: MessageMutationInput,
  actorId: string,
): Promise<void> {
  await broadcastMessageMutation('reaction_updated', message, actorId);
}
