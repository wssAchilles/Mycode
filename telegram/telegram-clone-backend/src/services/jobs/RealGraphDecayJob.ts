/**
 * RealGraphDecayJob - RealGraph 每日衰减作业
 * 
 * 复刻 X Algorithm 的 Real Graph Rollup Job
 * 参考: https://github.com/twitter/the-algorithm/blob/main/src/scala/com/twitter/interaction_graph/README.md
 * 
 * 运行频率: 每日 (建议凌晨低峰期)
 * 
 * 功能:
 * - 应用时间衰减到交互计数
 * - 重置每日计数
 * - 清理低分数边
 */

import { realGraphService } from '../recommendation/RealGraphService';
import RealGraphEdge, { DECAY_CONFIG } from '../../models/RealGraphEdge';

// ========== 配置 ==========
const CONFIG = {
    // 衰减批次配置
    batchSize: 5000,                   // 每批处理边数
    maxBatches: 100,                   // 每次运行最大批次

    // 清理配置
    cleanupEnabled: true,              // 是否启用清理
    cleanupMinScore: DECAY_CONFIG.minRetainScore,
    cleanupInactiveDays: 90,           // 清理 N 天未活动的低分边

    // 进度报告
    progressInterval: 5,               // 每 N 批次报告一次
};

// ========== 作业类 ==========
export class RealGraphDecayJob {
    private isRunning = false;
    private abortRequested = false;

    /**
     * 运行衰减作业
     */
    async run(options?: {
        skipCleanup?: boolean;
        onProgress?: (batches: number, edges: number) => void;
    }): Promise<{
        decayedEdges: number;
        cleanedEdges: number;
        batches: number;
        durationMs: number;
    }> {
        if (this.isRunning) {
            throw new Error('[RealGraphDecayJob] Job is already running');
        }

        this.isRunning = true;
        this.abortRequested = false;

        const startTime = Date.now();
        let decayedEdges = 0;
        let cleanedEdges = 0;
        let batches = 0;

        try {
            console.log('[RealGraphDecayJob] Starting decay job...');

            // Step 1: 应用衰减
            const decayResult = await realGraphService.applyDailyDecay();
            decayedEdges = decayResult.totalProcessed;
            batches = decayResult.batches;

            console.log(
                `[RealGraphDecayJob] Decay complete: ${decayedEdges} edges in ${batches} batches`
            );

            // Step 2: 清理过期边 (可选)
            if (CONFIG.cleanupEnabled && !options?.skipCleanup) {
                cleanedEdges = await realGraphService.cleanupStaleEdges(
                    CONFIG.cleanupMinScore,
                    CONFIG.cleanupInactiveDays
                );

                console.log(`[RealGraphDecayJob] Cleanup complete: ${cleanedEdges} edges removed`);
            }

            if (options?.onProgress) {
                options.onProgress(batches, decayedEdges);
            }

        } finally {
            this.isRunning = false;
        }

        const durationMs = Date.now() - startTime;
        console.log(
            `[RealGraphDecayJob] Completed in ${durationMs}ms - ` +
            `decayed: ${decayedEdges}, cleaned: ${cleanedEdges}`
        );

        return { decayedEdges, cleanedEdges, batches, durationMs };
    }

    /**
     * 仅运行清理 (不衰减)
     */
    async cleanupOnly(): Promise<number> {
        console.log('[RealGraphDecayJob] Running cleanup only...');

        return realGraphService.cleanupStaleEdges(
            CONFIG.cleanupMinScore,
            CONFIG.cleanupInactiveDays
        );
    }

    /**
     * 获取待处理边统计
     */
    async getStats(): Promise<{
        totalEdges: number;
        staleEdges: number;
        lowScoreEdges: number;
    }> {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CONFIG.cleanupInactiveDays);

        const [totalEdges, staleEdges, lowScoreEdges] = await Promise.all([
            RealGraphEdge.countDocuments(),
            RealGraphEdge.countDocuments({ lastDecayAppliedAt: { $lt: yesterday } }),
            RealGraphEdge.countDocuments({
                decayedSum: { $lt: CONFIG.cleanupMinScore },
                lastInteractionAt: { $lt: cutoffDate },
            }),
        ]);

        return { totalEdges, staleEdges, lowScoreEdges };
    }

    /**
     * 请求中止
     */
    abort(): void {
        this.abortRequested = true;
    }

    /**
     * 检查是否正在运行
     */
    get running(): boolean {
        return this.isRunning;
    }
}

// ========== 导出单例 ==========
export const realGraphDecayJob = new RealGraphDecayJob();
export default realGraphDecayJob;
