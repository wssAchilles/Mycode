/**
 * Fanout Worker - 消息扩散后台处理器
 * P0 优化: 异步处理群组消息的写扩散
 */
import { Job } from 'bullmq';
import { queueService, MessageFanoutJobData } from '../services/queueService';
import ChatMemberState from '../models/ChatMemberState';
import { updateService } from '../services/updateService';

/**
 * 处理消息扩散任务
 * 使用 bulkWrite 批量更新 ChatMemberState，提升性能
 */
const processFanoutJob = async (job: Job<MessageFanoutJobData>): Promise<void> => {
    const { messageId, chatId, seq, senderId, recipientIds, chatType } = job.data;

    if (!recipientIds || recipientIds.length === 0) {
        console.log(`[Fanout] 跳过空接收者列表: ${messageId}`);
        return;
    }

    const startTime = Date.now();

    try {
        // 1. 批量更新 ChatMemberState (已送达状态)
        // 使用 bulkWrite 替代 Promise.all(updateOne) 提升性能
        const bulkOps = recipientIds.map((userId) => ({
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

        // 2. 批量写入 UpdateLog
        await updateService.appendUpdates(recipientIds, {
            type: 'message',
            chatId,
            seq,
            messageId,
        });

        const duration = Date.now() - startTime;
        console.log(`[Fanout] 完成 ${recipientIds.length} 个接收者，耗时 ${duration}ms (${chatType}:${chatId}, seq:${seq})`);

    } catch (error: any) {
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
