/**
 * SimClustersBatchJob - SimClusters 嵌入批量更新作业
 * 
 * 复刻 X Algorithm 的离线嵌入计算
 * 参考: https://github.com/twitter/the-algorithm/blob/main/src/scala/com/twitter/simclusters_v2/README.md
 * 
 * 运行频率: 每日 (建议凌晨低峰期)
 * 
 * 功能:
 * - 批量更新用户 InterestedIn 嵌入
 * - 批量更新用户 ProducerEmbedding
 * - 增量处理活跃用户优先
 */

import { simClustersService } from '../recommendation/SimClustersService';
import UserFeatureVector from '../../models/UserFeatureVector';
import RealGraphEdge from '../../models/RealGraphEdge';

// ========== 配置 ==========
const CONFIG = {
    // 批量处理配置
    batchSize: 100,                    // 每批处理用户数
    maxUsersPerRun: 10000,             // 每次运行最大处理数

    // 优先级配置
    priorityDays: 7,                   // 优先处理 N 天内活跃用户
    staleThresholdDays: 30,            // N 天未更新的嵌入需要刷新

    // 并发控制
    concurrency: 5,                    // 并发处理数

    // 进度报告
    progressInterval: 100,             // 每 N 个用户报告一次进度
};

// ========== 作业类 ==========
export class SimClustersBatchJob {
    private isRunning = false;
    private abortRequested = false;

    /**
     * 运行批量更新作业
     */
    async run(options?: {
        maxUsers?: number;
        onlyStale?: boolean;
        onProgress?: (processed: number, total: number) => void;
    }): Promise<{
        success: number;
        failed: number;
        skipped: number;
        durationMs: number;
    }> {
        if (this.isRunning) {
            throw new Error('[SimClustersBatchJob] Job is already running');
        }

        this.isRunning = true;
        this.abortRequested = false;

        const startTime = Date.now();
        let success = 0;
        let failed = 0;
        let skipped = 0;

        const maxUsers = options?.maxUsers || CONFIG.maxUsersPerRun;

        try {
            console.log('[SimClustersBatchJob] Starting batch job...');

            // Step 1: 获取需要更新的用户列表
            const userIds = await this.getUsersToProcess(maxUsers, options?.onlyStale);
            console.log(`[SimClustersBatchJob] Found ${userIds.length} users to process`);

            if (userIds.length === 0) {
                console.log('[SimClustersBatchJob] No users to process');
                return { success: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime };
            }

            // Step 2: 分批处理
            for (let i = 0; i < userIds.length; i += CONFIG.batchSize) {
                if (this.abortRequested) {
                    console.log('[SimClustersBatchJob] Abort requested, stopping...');
                    break;
                }

                const batch = userIds.slice(i, i + CONFIG.batchSize);
                const results = await this.processBatch(batch);

                success += results.success;
                failed += results.failed;

                // 进度报告
                const processed = i + batch.length;
                if (processed % CONFIG.progressInterval === 0 || processed === userIds.length) {
                    console.log(
                        `[SimClustersBatchJob] Progress: ${processed}/${userIds.length} ` +
                        `(success: ${success}, failed: ${failed})`
                    );

                    if (options?.onProgress) {
                        options.onProgress(processed, userIds.length);
                    }
                }
            }

        } finally {
            this.isRunning = false;
        }

        const durationMs = Date.now() - startTime;
        console.log(
            `[SimClustersBatchJob] Completed in ${durationMs}ms - ` +
            `success: ${success}, failed: ${failed}, skipped: ${skipped}`
        );

        return { success, failed, skipped, durationMs };
    }

    /**
     * 请求中止作业
     */
    abort(): void {
        this.abortRequested = true;
    }

    /**
     * 检查作业是否正在运行
     */
    get running(): boolean {
        return this.isRunning;
    }

    /**
     * 获取需要处理的用户列表
     */
    private async getUsersToProcess(
        maxUsers: number,
        onlyStale?: boolean
    ): Promise<string[]> {
        const userIds: string[] = [];

        // 策略 1: 最近活跃但嵌入过期的用户
        const staleDate = new Date();
        staleDate.setDate(staleDate.getDate() - CONFIG.staleThresholdDays);

        if (onlyStale) {
            // 只处理过期嵌入
            const staleEmbeddings = await UserFeatureVector.find({
                computedAt: { $lt: staleDate },
            })
                .select('userId')
                .limit(maxUsers);

            userIds.push(...staleEmbeddings.map(e => e.userId));
        } else {
            // 优先处理:
            // 1. 最近有交互但嵌入过期的用户
            // 2. 最近活跃的用户

            const recentDate = new Date();
            recentDate.setDate(recentDate.getDate() - CONFIG.priorityDays);

            // 从 RealGraph 获取最近活跃用户
            const activeEdges = await RealGraphEdge.aggregate([
                { $match: { lastInteractionAt: { $gte: recentDate } } },
                { $group: { _id: '$sourceUserId' } },
                { $limit: maxUsers },
            ]);

            const activeUserIds = activeEdges.map((e: { _id: string }) => e._id);

            // 过滤出嵌入过期的
            const staleEmbeddings = await UserFeatureVector.find({
                userId: { $in: activeUserIds },
                computedAt: { $lt: staleDate },
            }).select('userId');

            const staleIds = new Set(staleEmbeddings.map(e => e.userId));

            // 过期的优先
            for (const id of activeUserIds) {
                if (staleIds.has(id)) {
                    userIds.push(id);
                }
            }

            // 补充未过期的活跃用户
            for (const id of activeUserIds) {
                if (!staleIds.has(id) && userIds.length < maxUsers) {
                    userIds.push(id);
                }
            }
        }

        return userIds.slice(0, maxUsers);
    }

    /**
     * 处理一批用户
     */
    private async processBatch(
        userIds: string[]
    ): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        // 并发处理 (控制并发数)
        const chunks: string[][] = [];
        for (let i = 0; i < userIds.length; i += CONFIG.concurrency) {
            chunks.push(userIds.slice(i, i + CONFIG.concurrency));
        }

        for (const chunk of chunks) {
            const results = await Promise.allSettled(
                chunk.map(userId => simClustersService.computeAndStoreEmbedding(userId))
            );

            for (const result of results) {
                if (result.status === 'fulfilled') {
                    success++;
                } else {
                    failed++;
                    console.error('[SimClustersBatchJob] Failed to process user:', result.reason);
                }
            }
        }

        return { success, failed };
    }
}

// ========== 导出单例 ==========
export const simClustersBatchJob = new SimClustersBatchJob();
export default simClustersBatchJob;
