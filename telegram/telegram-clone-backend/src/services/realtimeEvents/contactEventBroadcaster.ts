import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../../utils/logger';
import { getSocketService } from '../socketRegistry';
import { updateService } from '../updateService';
import type { ContactRealtimePayload } from './contracts';

const log = createChildLogger('services:realtimeEvents:contact');

export type ContactRealtimePayloadDraft = Omit<ContactRealtimePayload, 'eventId' | 'emittedAt'>;

export interface ContactEventDeliveryTarget {
  userId: string;
  payload: ContactRealtimePayloadDraft;
}

export interface BroadcastContactEventParams {
  deliveries: ContactEventDeliveryTarget[];
  /** 是否同步写入 UpdateLog 供离线重连通过 difference 补齐 */
  persistUpdateLog?: boolean;
}

/**
 * 在事务提交后广播联系人变更事件：
 * 同时写入增量 UpdateLog（断线可追回）并通过 Socket/Redis 实时推送到受影响用户的全部在线端。
 */
export async function broadcastContactEvent(params: BroadcastContactEventParams): Promise<void> {
  const deliveries = (params.deliveries || []).filter((item) => Boolean(item?.userId));
  if (!deliveries.length) return;

  const emittedAt = new Date().toISOString();
  const persistUpdateLog = params.persistUpdateLog !== false;
  const socketService = getSocketService();

  // 先为每位目标用户构建幂等事件载荷（含各自视角的摘要）
  const resolvedDeliveries = deliveries.map((entry) => ({
    userId: entry.userId,
    payload: {
      ...entry.payload,
      eventId: randomUUID(),
      emittedAt,
    } satisfies ContactRealtimePayload,
  }));

  if (persistUpdateLog) {
    // 并行写入各自用户的增量日志，best-effort 失败绝不回滚主写请求
    await Promise.all(
      resolvedDeliveries.map(async (entry) => {
        try {
          await updateService.appendUpdate({
            userId: entry.userId,
            type: 'contact_change',
            chatId: 'contacts',
            payload: entry.payload,
          });
        } catch (err) {
          log.warn({ err, userId: entry.userId, action: entry.payload.action }, '写入联系人 UpdateLog 失败');
        }
      }),
    );
  }

  if (!socketService) return;

  for (const entry of resolvedDeliveries) {
    try {
      socketService.emitRealtimeToUser(entry.userId, {
        type: 'contactUpdate',
        payload: entry.payload,
      });
    } catch (err) {
      log.warn({ err, userId: entry.userId, action: entry.payload.action }, '推送联系人实时事件失败');
    }
  }
}
