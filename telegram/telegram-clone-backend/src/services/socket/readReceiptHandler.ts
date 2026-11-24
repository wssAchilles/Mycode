import ChatMemberState from '../../models/ChatMemberState';
import GroupMember, { MemberStatus } from '../../models/GroupMember';
import { waitForMongoReady } from '../../config/db';
import { updateService } from '../updateService';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { parseChatId, getPrivateOtherUserId, buildGroupChatId, buildPrivateChatId } from '../../utils/chat';
import { advanceChatLastReadSeq, computeGroupReadCountAtSeq } from '../../utils/chatReadState';
import { broadcastSelfReadSync } from '../realtimeEvents';
import { Op } from 'sequelize';
import { createChildLogger } from '../../utils/logger';
import type { TypedSocketIOServer, TypedSocket, RealtimeBatchEvent } from './types';

const log = createChildLogger('services:socket:readReceipt');

export interface ReadReceiptHandlerDeps {
  io: TypedSocketIOServer;
  emitRealtimeToRoom: (groupId: string, event: RealtimeBatchEvent) => void;
  emitRealtimeToUser: (userId: string, event: RealtimeBatchEvent) => void;
  emitLegacyRealtimeEvents: boolean;
}

export class ReadReceiptHandler {
  constructor(private deps: ReadReceiptHandlerDeps) {}

  async handleReadChat(socket: TypedSocket, data: { chatId: string; seq: number }): Promise<void> {
    const { userId } = socket.data;
    if (!userId) return;

    const startedAt = Date.now();
    const { chatId, seq } = data || {};
    if (!chatId || typeof seq !== 'number' || !Number.isFinite(seq) || seq < 1) return;

    try {
      await waitForMongoReady(15000);
    } catch {
      return;
    }

    const parsed = parseChatId(chatId);
    if (!parsed) return;

    // 幂等校验：若已标记至相同或更高 seq，跳过冗余 read 更新与广播
    const seqAdvanced = await advanceChatLastReadSeq(chatId, userId, seq);
    if (!seqAdvanced) {
      chatRuntimeMetrics.observeDuration('socket.readChat.latencyMs', Date.now() - startedAt);
      return;
    }

    const canonicalChatId =
      parsed.type === 'private' && parsed.userIds?.length === 2
        ? buildPrivateChatId(parsed.userIds[0], parsed.userIds[1])
        : parsed.type === 'group' && parsed.groupId
          ? buildGroupChatId(parsed.groupId)
          : chatId;

    if (parsed.type === 'group' && parsed.groupId) {
      await this.handleGroupReadReceipt(parsed.groupId, canonicalChatId, seq, userId);
    } else if (parsed.type === 'private') {
      await this.handlePrivateReadReceipt(canonicalChatId, seq, userId);
    }

    // 同步推进当前账号其余在线端已读水位，消除切换标签后红点残留
    broadcastSelfReadSync(userId, canonicalChatId, seq);

    chatRuntimeMetrics.observeDuration('socket.readChat.latencyMs', Date.now() - startedAt);
  }

  private async handleGroupReadReceipt(
    groupId: string,
    chatId: string,
    seq: number,
    userId: string,
  ): Promise<void> {
    const member = await GroupMember.findOne({
      where: {
        groupId,
        userId,
        status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
        isActive: true,
      },
    });
    if (!member) return;

    const readCount = await computeGroupReadCountAtSeq(chatId, seq);

    if (this.deps.emitLegacyRealtimeEvents) {
      this.deps.io.to(`room:${groupId}`).emit('readReceipt', {
        chatId,
        seq,
        readCount,
        readerId: userId,
      });
    }

    this.deps.emitRealtimeToRoom(groupId, {
      type: 'readReceipt',
      payload: { chatId, seq, readCount, readerId: userId },
    });

    chatRuntimeMetrics.increment('socket.readChat.group');
    chatRuntimeMetrics.observeValue('socket.readChat.groupReadCount', readCount);
  }

  private async handlePrivateReadReceipt(
    chatId: string,
    seq: number,
    userId: string,
  ): Promise<void> {
    const otherUserId = getPrivateOtherUserId(chatId, userId);
    if (!otherUserId) return;

    if (this.deps.emitLegacyRealtimeEvents) {
      this.deps.io.to(`user:${otherUserId}`).emit('readReceipt', {
        chatId,
        seq,
        readCount: 1,
        readerId: userId,
      });
    }

    this.deps.emitRealtimeToUser(otherUserId, {
      type: 'readReceipt',
      payload: { chatId, seq, readCount: 1, readerId: userId },
    });

    await updateService.appendUpdate({
      userId: otherUserId,
      type: 'read',
      chatId,
      seq,
      payload: { readerId: userId, readCount: 1 },
    });

    chatRuntimeMetrics.increment('socket.readChat.private');
  }
}
