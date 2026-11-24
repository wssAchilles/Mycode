import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../../utils/logger';
import { getSocketService } from '../socketRegistry';
import type { SyncStateRealtimePayload } from './contracts';

const log = createChildLogger('services:realtimeEvents:syncState');

/**
 * 同账号多设备/多标签页已读状态秒级同步：
 * 当用户在任一端推进某会话已读水位后，向同一 user:<id> 推送 syncState，其余标签页立即将红点清零。
 */
export function broadcastSelfReadSync(userId: string, chatId: string, seq: number): void {
  try {
    const cleanUserId = String(userId || '').trim();
    const cleanChatId = String(chatId || '').trim();
    if (!cleanUserId || !cleanChatId || !Number.isFinite(seq) || seq < 1) {
      return;
    }

    const socketService = getSocketService();
    if (!socketService) return;

    const payload: SyncStateRealtimePayload = {
      eventId: randomUUID(),
      emittedAt: new Date().toISOString(),
      action: 'chat_read',
      userId: cleanUserId,
      chatId: cleanChatId,
      seq: Math.floor(seq),
    };

    socketService.emitRealtimeToUser(cleanUserId, {
      type: 'syncState',
      payload,
    });
  } catch (err) {
    log.warn({ err, userId, chatId, seq }, '广播多端已读状态同步失败');
  }
}
