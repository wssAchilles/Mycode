import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../../utils/logger';
import { getSocketService } from '../socketRegistry';
import type {
  SocialNotificationAction,
  SocialNotificationActor,
  SocialNotificationRealtimePayload,
} from './contracts';

const log = createChildLogger('services:realtimeEvents:socialNotification');

export interface BroadcastSocialNotificationParams {
  recipientId: string;
  actor: SocialNotificationActor;
  action: SocialNotificationAction;
  postId?: string;
  commentId?: string;
  previewText?: string;
}

/**
 * 广播 Space 社交互动实时通知（点赞 / 评论 / 转发 / 关注）
 * 自操作自动跳过通知，不占用聊天消息 UpdateLog 序列号。
 */
export function broadcastSocialNotification(params: BroadcastSocialNotificationParams): void {
  try {
    const recipientId = String(params.recipientId || '').trim();
    const actorId = String(params.actor?.id || '').trim();
    if (!recipientId || !actorId || recipientId === actorId) {
      return;
    }

    const socketService = getSocketService();
    if (!socketService) return;

    const payload: SocialNotificationRealtimePayload = {
      eventId: randomUUID(),
      emittedAt: new Date().toISOString(),
      action: params.action,
      recipientId,
      actor: {
        id: actorId,
        username: params.actor.username || '未知用户',
        avatarUrl: params.actor.avatarUrl ?? null,
      },
      ...(params.postId ? { postId: params.postId } : {}),
      ...(params.commentId ? { commentId: params.commentId } : {}),
      ...(params.previewText ? { previewText: params.previewText.slice(0, 140) } : {}),
    };

    socketService.emitRealtimeToUser(recipientId, {
      type: 'socialNotification',
      payload,
    });
  } catch (err) {
    log.warn({ err, action: params.action, recipientId: params.recipientId }, '推送社交互动通知失败');
  }
}
