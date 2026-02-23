/**
 * Fanout Worker - 消息扩散后台处理器
 * P0 优化: 异步处理群组消息的写扩散
 */
import { Job } from 'bullmq';
import { queueService, MessageFanoutJobData } from '../services/queueService';
import ChatMemberState from '../models/ChatMemberState';
import { updateService } from '../services/updateService';
import { chatRuntimeMetrics } from '../services/chatRuntimeMetrics';

const FANOUT_MEMBERSTATE_CHUNK_SIZE = (() => {
    const parsed = Number.parseInt(process.env.FANOUT_MEMBERSTATE_CHUNK_SIZE || '1000', 10);
    if (!Number.isFinite(parsed)) return 1000;
    return Math.min(Math.max(Math.floor(parsed), 100), 5000);
})();

/**
 * 处理消息扩散任务
 * 使用 bulkWrite 批量更新 ChatMemberState，提升性能
 */
const processFanoutJob = async (job: Job<MessageFanoutJobData>): Promise<void> => {
    const { messageId, chatId, seq, senderId, recipientIds, chatType } = job.data;
    void senderId;

    const dedupedRecipients = Array.from(new Set((recipientIds || []).filter(Boolean)));
    chatRuntimeMetrics.increment('fanout.jobs.total');
    chatRuntimeMetrics.observeValue('fanout.chunkSize.config', FANOUT_MEMBERSTATE_CHUNK_SIZE);
    chatRuntimeMetrics.observeValue('fanout.recipients.requested', Array.isArray(recipientIds) ? recipientIds.length : 0);
    chatRuntimeMetrics.observeValue('fanout.recipients.deduped', dedupedRecipients.length);

    if (dedupedRecipients.length === 0) {
        chatRuntimeMetrics.increment('fanout.jobs.empty');
        console.log(`[Fanout] 跳过空接收者列表: ${messageId}`);
        return;
    }

    const startTime = Date.now();
    let chunkCount = 0;

    try {
        for (let i = 0; i < dedupedRecipients.length; i += FANOUT_MEMBERSTATE_CHUNK_SIZE) {
            const chunk = dedupedRecipients.slice(i, i + FANOUT_MEMBERSTATE_CHUNK_SIZE);
            if (!chunk.length) continue;
            chunkCount += 1;
            chatRuntimeMetrics.increment('fanout.chunks.total');
            chatRuntimeMetrics.observeValue('fanout.chunk.recipients', chunk.length);

            // 1. 分块批量更新 ChatMemberState (已送达状态)
            const bulkOps = chunk.map((userId) => ({
                updateOne: {
                    filter: { chatId, userId },
                    update: {
                        $max: { lastDeliveredSeq: seq },
                        $setOnInsert: { lastReadSeq: 0 },
                    },
                    upsert: true,
                },
            }));

            await ChatMemberState.bulkWrite(bulkOps, { ordered: false });

            // 2. 分块写入 UpdateLog + 唤醒通知
            await updateService.appendUpdates(chunk, {
                type: 'message',
                chatId,
                seq,
                messageId,
            });
        }

        const duration = Date.now() - startTime;
        chatRuntimeMetrics.increment('fanout.jobs.success');
        chatRuntimeMetrics.observeDuration('fanout.jobs.latencyMs', duration);
        chatRuntimeMetrics.observeValue('fanout.jobs.chunks', chunkCount);
        console.log(
            `[Fanout] 完成 ${dedupedRecipients.length} 个接收者，` +
            `分块 ${chunkCount}，耗时 ${duration}ms (${chatType}:${chatId}, seq:${seq})`,
        );

    } catch (error: any) {
        chatRuntimeMetrics.increment('fanout.jobs.errors');
        chatRuntimeMetrics.observeDuration('fanout.jobs.latencyMs', Date.now() - startTime);
        console.error(`[Fanout] 处理失败 (${messageId}):`, error.message);
        throw error; // 抛出错误以触发 BullMQ 重试
    }
};

/**
 * 初始化 Fanout Worker
 */
export const initFanoutWorker = (): void => {
    queueService.registerFanoutWorker(processFanoutJob);
    console.log('✅ Fanout Worker 已注册');
};

export default initFanoutWorker;
