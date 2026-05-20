import ChatMemberState from '../../models/ChatMemberState';
import GroupMember, { MemberStatus } from '../../models/GroupMember';
import { waitForMongoReady } from '../../config/db';
import { updateService } from '../updateService';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { parseChatId, getPrivateOtherUserId } from '../../utils/chat';
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
    if (!chatId || typeof seq !== 'number') return;

    try {
      await waitForMongoReady(15000);
    } catch {
      return;
    }

    const parsed = parseChatId(chatId);
    if (!parsed) return;

    await ChatMemberState.updateOne(
      { chatId, userId },
      { $max: { lastReadSeq: seq }, $set: { lastSeenAt: new Date() } },
      { upsert: true },
    );

    if (parsed.type === 'group' && parsed.groupId) {
      await this.handleGroupReadReceipt(parsed.groupId, chatId, seq, userId);
    } else if (parsed.type === 'private') {
      await this.handlePrivateReadReceipt(chatId, seq, userId);
    }

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

    const readCount = await ChatMemberState.countDocuments({
      chatId,
      lastReadSeq: { $gte: seq },
    });

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
