import { describe, expect, it, vi } from 'vitest';
import {
  calculateDecorrelatedJitter,
  calculateMessagePriority,
  pruneOfflineQueue,
  sortOfflineQueuePerChatFIFO,
  type QueuedMessage,
} from '../core/chat/offlineQueue';

function createMockMsg(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: `offline_${Math.random().toString(36).slice(2, 8)}`,
    chatId: 'chat-1',
    content: '测试消息内容',
    senderId: 'user-sender',
    clientTempId: `temp_${Math.random().toString(36).slice(2, 8)}`,
    chatType: 'private',
    receiverId: 'user-receiver',
    type: 'text',
    vectorClock: { userId: 'user-sender', timestamp: Date.now() },
    createdAt: Date.now(),
    retryCount: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('offlineQueueV2 - 学术与工程算法增强测试', () => {
  describe('calculateDecorrelatedJitter (去相关抖动退避推导验证)', () => {
    it('返回的等待时延始终在 [baseDelay, maxDelay] 之间', () => {
      const baseDelay = 500;
      const maxDelay = 30000;
      let prevDelay = baseDelay;

      for (let i = 0; i < 20; i++) {
        const nextDelay = calculateDecorrelatedJitter(baseDelay, maxDelay, prevDelay);
        expect(nextDelay).toBeGreaterThanOrEqual(baseDelay);
        expect(nextDelay).toBeLessThanOrEqual(maxDelay);
        prevDelay = nextDelay;
      }
    });

    it('当上一次时延达到上限时，下一次时延仍被限制在 maxDelay 且具有随机抖动', () => {
      const baseDelay = 500;
      const maxDelay = 30000;
      const prevDelay = 30000;

      const samples = Array.from({ length: 10 }, () =>
        calculateDecorrelatedJitter(baseDelay, maxDelay, prevDelay),
      );

      // 所有样本都不能超过 maxDelay
      samples.forEach((sample) => {
        expect(sample).toBeLessThanOrEqual(maxDelay);
        expect(sample).toBeGreaterThanOrEqual(baseDelay);
      });

      // 验证存在随机抖动性（不全相等）
      const uniqueSamples = new Set(samples);
      expect(uniqueSamples.size).toBeGreaterThan(1);
    });
  });

  describe('calculateMessagePriority (消息权重与优先级评分)', () => {
    it('在同等时间下，纯文本消息的优先级显著高于大体积媒体消息', () => {
      const now = Date.now();
      const textMsg = createMockMsg({ type: 'text', createdAt: now });
      const mediaMsg = createMockMsg({ type: 'file', fileSize: 10 * 1024 * 1024, createdAt: now });

      const textScore = calculateMessagePriority(textMsg, now);
      const mediaScore = calculateMessagePriority(mediaMsg, now);

      expect(textScore).toBeGreaterThan(mediaScore);
    });

    it('新发送的消息优先级高于陈旧过期的离线消息', () => {
      const now = Date.now();
      const freshMsg = createMockMsg({ createdAt: now - 1000 });
      const oldMsg = createMockMsg({ createdAt: now - 3600 * 24 * 1000 }); // 24小时前

      const freshScore = calculateMessagePriority(freshMsg, now);
      const oldScore = calculateMessagePriority(oldMsg, now);

      expect(freshScore).toBeGreaterThan(oldScore);
    });
  });

  describe('pruneOfflineQueue (有界容量保护与淘汰策略)', () => {
    it('当未发送消息超出容量上限时，淘汰优先级最低的消息并将其标记为 failed', async () => {
      const now = Date.now();
      const highPriorityMsg = createMockMsg({ id: 'msg-text-fresh', type: 'text', createdAt: now });
      const lowPriorityMsg1 = createMockMsg({
        id: 'msg-file-old',
        type: 'file',
        fileSize: 50 * 1024 * 1024,
        createdAt: now - 3600 * 48 * 1000,
      });
      const lowPriorityMsg2 = createMockMsg({
        id: 'msg-file-older',
        type: 'file',
        fileSize: 100 * 1024 * 1024,
        createdAt: now - 3600 * 72 * 1000,
      });

      const queue = [lowPriorityMsg2, highPriorityMsg, lowPriorityMsg1];
      const markFailed = vi.fn().mockResolvedValue(undefined);

      const pruned = await pruneOfflineQueue(queue, 1, { markFailed, now });

      // 保留优先级最高的文本消息
      expect(pruned.length).toBe(1);
      expect(pruned[0].id).toBe('msg-text-fresh');

      // 淘汰的 2 条消息被标记为 failed
      expect(markFailed).toHaveBeenCalledWith('msg-file-older');
      expect(markFailed).toHaveBeenCalledWith('msg-file-old');
    });
  });

  describe('sortOfflineQueuePerChatFIFO (会话内保序与跨会话调度)', () => {
    it('相同会话内的离线消息严格按 createdAt FIFO 正序重放', () => {
      const msg1 = createMockMsg({ chatId: 'chat-A', createdAt: 100, content: 'A-1' });
      const msg2 = createMockMsg({ chatId: 'chat-A', createdAt: 200, content: 'A-2' });
      const msg3 = createMockMsg({ chatId: 'chat-A', createdAt: 300, content: 'A-3' });

      // 传入倒序队列
      const sorted = sortOfflineQueuePerChatFIFO([msg3, msg1, msg2]);

      expect(sorted.map((m) => m.content)).toEqual(['A-1', 'A-2', 'A-3']);
    });

    it('跨会话进行轮询调度，避免单一活跃会话垄断重试通道', () => {
      const a1 = createMockMsg({ chatId: 'chat-A', createdAt: 100, content: 'A-1' });
      const a2 = createMockMsg({ chatId: 'chat-A', createdAt: 110, content: 'A-2' });
      const b1 = createMockMsg({ chatId: 'chat-B', createdAt: 105, content: 'B-1' });
      const b2 = createMockMsg({ chatId: 'chat-B', createdAt: 115, content: 'B-2' });

      const sorted = sortOfflineQueuePerChatFIFO([a1, a2, b1, b2]);

      // 会话 A 和 B 应该交替轮询重放
      expect(sorted[0].chatId).not.toEqual(sorted[1].chatId);
      expect(sorted.length).toBe(4);
    });
  });
});
