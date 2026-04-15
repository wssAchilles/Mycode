/**
 * Fanout Worker - 消息扩散后台处理器
 * P0 优化: 异步处理群组消息的写扩散
 */
import { Job } from 'bullmq';
import { queueService, MessageFanoutJobData } from '../services/queueService';
import { chatRuntimeMetrics } from '../services/chatRuntimeMetrics';
import { projectMessageFanoutCommand } from '../services/chatDelivery/deliveryProjector';
import { chatFanoutCommandBus } from '../services/chatDelivery/fanoutCommandBus';

/**
 * 处理消息扩散任务
 * 使用 bulkWrite 批量更新 ChatMemberState，提升性能
 */
const processFanoutJob = async (job: Job<MessageFanoutJobData>): Promise<void> => {
    const { messageId, chatId, seq, senderId, recipientIds, chatType } = job.data;
    void senderId;

    const dedupedRecipients = Array.from(new Set((recipientIds || []).filter(Boolean)));
    chatRuntimeMetrics.increment('fanout.jobs.total');
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
        await chatFanoutCommandBus.recordProjectionStarted(job.data, {
            chunkIndex: job.data.delivery?.chunkIndex ?? 0,
            jobId: String(job.id || ''),
            attemptCount: job.attemptsMade + 1,
        });
        const projection = await projectMessageFanoutCommand(job.data);
        chunkCount = projection.chunkCount;
        await chatFanoutCommandBus.recordProjectionSuccess(job.data, projection, {
            chunkIndex: job.data.delivery?.chunkIndex ?? 0,
            jobId: String(job.id || ''),
            attemptCount: job.attemptsMade + 1,
        });

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
        await chatFanoutCommandBus.recordProjectionFailure(job.data, error, {
            chunkIndex: job.data.delivery?.chunkIndex ?? 0,
            jobId: String(job.id || ''),
            attemptCount: job.attemptsMade + 1,
            terminal: job.attemptsMade + 1 >= Number(job.opts.attempts || 1),
        });
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
