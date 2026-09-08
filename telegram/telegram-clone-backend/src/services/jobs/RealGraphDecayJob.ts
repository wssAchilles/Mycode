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
import RecommendationJobRun from '../../models/RecommendationJobRun';
import {
    repairLeaseCoordinator,
    repairRunId,
    type RepairCompletionProvenance,
    type RepairJobCoordinator,
} from './coordination/repairLease';

type Trigger = 'cron' | 'manual' | 'script';

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

const JOB_NAME = 'realgraph-decay-repair';

function assertEvidenceWrite(
    result: { acknowledged: boolean; matchedCount?: number; upsertedCount?: number },
    phase: string,
): void {
    if (!result.acknowledged || (result.matchedCount ?? 0) + (result.upsertedCount ?? 0) === 0) {
        throw new Error(`[RealGraphDecayJob] ${phase} evidence write was not applied`);
    }
}

function evidenceTrigger(value: string | undefined): Trigger {
    if (value === 'cron' || value === 'manual' || value === 'script') {
        return value;
    }
    throw new Error('[RealGraphDecayJob] Invalid completion trigger provenance');
}

// ========== 作业类 ==========
export class RealGraphDecayJob {
    private isRunning = false;
    private abortController: AbortController | undefined;

    constructor(private readonly coordinator: RepairJobCoordinator = repairLeaseCoordinator) {}

    /**
     * 运行衰减作业
     */
    async run(options: {
        epoch: string;
        skipCleanup?: boolean;
        trigger?: Trigger;
        onProgress?: (batches: number, edges: number) => void;
    }): Promise<{
        decayedEdges: number;
        cleanedEdges: number;
        batches: number;
        durationMs: number;
    }> {
        const epoch = String(options?.epoch ?? '').trim();
        const evidenceId = repairRunId(JOB_NAME, epoch);
        const evidenceFilter = { _id: evidenceId };
        const trigger = options.trigger ?? 'manual';
        const releaseTag = process.env.RELEASE_TAG || process.env.SENTRY_RELEASE;

        return this.coordinator.execute(
                JOB_NAME,
                epoch,
                async (leaseSignal, attempt) => {
                    leaseSignal.throwIfAborted();
                    this.isRunning = true;
                    const abortController = new AbortController();
                    this.abortController = abortController;
                    const signal = AbortSignal.any([leaseSignal, abortController.signal]);
                    const startTime = Date.now();
                    const startedAt = new Date(attempt.startedAt);
                    let evidenceStarted = false;
                    try {
                        const write = await RecommendationJobRun.updateOne(
                            {
                                ...evidenceFilter,
                                status: { $ne: 'success' },
                                $or: [
                                    { 'summary.fenceToken': { $lt: attempt.fenceToken } },
                                    { 'summary.fenceToken': { $exists: false } },
                                ],
                            },
                            {
                                $set: {
                                    status: 'running',
                                    jobName: JOB_NAME,
                                    mode: 'repair',
                                    startedAt,
                                    trigger,
                                    releaseTag,
                                    summary: {
                                        mode: 'repair',
                                        epoch,
                                        attemptId: attempt.attemptId,
                                        fenceToken: attempt.fenceToken,
                                        attemptStartedAt: attempt.startedAt,
                                    },
                                },
                                $unset: {
                                    finishedAt: 1,
                                    durationMs: 1,
                                    counts: 1,
                                    error: 1,
                                },
                            },
                            { upsert: true, signal },
                        );
                        assertEvidenceWrite(write, 'running');
                        evidenceStarted = true;
                        signal.throwIfAborted();
                        let decayedEdges = 0;
                        let cleanedEdges = 0;
                        let batches = 0;

                        console.log('[RealGraphDecayJob] Starting decay job...');

                        const decayResult = await realGraphService.applyDailyDecay(signal);
                        signal.throwIfAborted();
                        if (decayResult.errors > 0) {
                            throw new Error('[RealGraphDecayJob] Decay completed with mutation errors');
                        }
                        decayedEdges = decayResult.totalProcessed;
                        batches = decayResult.batches;

                        console.log(
                            `[RealGraphDecayJob] Decay complete: ${decayedEdges} edges in ${batches} batches`
                        );

                        if (CONFIG.cleanupEnabled && !options.skipCleanup) {
                            signal.throwIfAborted();
                            cleanedEdges = await realGraphService.cleanupStaleEdges(
                                CONFIG.cleanupMinScore,
                                CONFIG.cleanupInactiveDays,
                                signal,
                            );
                            signal.throwIfAborted();

                            console.log(`[RealGraphDecayJob] Cleanup complete: ${cleanedEdges} edges removed`);
                        }

                        if (options.onProgress) {
                            options.onProgress(batches, decayedEdges);
                        }

                        return {
                            decayedEdges,
                            cleanedEdges,
                            batches,
                            durationMs: Date.now() - startTime,
                        };
                    } catch (error) {
                        if (evidenceStarted && !leaseSignal.aborted) {
                            const finishedAt = new Date();
                            const write = await RecommendationJobRun.updateOne(
                                {
                                    ...evidenceFilter,
                                    status: 'running',
                                    'summary.attemptId': attempt.attemptId,
                                    'summary.fenceToken': attempt.fenceToken,
                                },
                                {
                                    $set: {
                                        jobName: JOB_NAME,
                                        mode: 'repair',
                                        status: 'failed',
                                        startedAt,
                                        finishedAt,
                                        durationMs: finishedAt.getTime() - startedAt.getTime(),
                                        trigger,
                                        releaseTag,
                                        summary: {
                                            mode: 'repair',
                                            epoch,
                                            attemptId: attempt.attemptId,
                                            fenceToken: attempt.fenceToken,
                                            attemptStartedAt: attempt.startedAt,
                                        },
                                        error: error instanceof Error ? error.message : String(error),
                                    },
                                },
                                { signal: leaseSignal },
                            );
                            assertEvidenceWrite(write, 'failure');
                        }
                        throw error;
                    } finally {
                        this.isRunning = false;
                        if (this.abortController === abortController) {
                            this.abortController = undefined;
                        }
                    }
                },
                async (counts, provenance) => {
                    const finishedAt = new Date(provenance.completedAt);
                    const write = await RecommendationJobRun.updateOne(
                        {
                            ...evidenceFilter,
                            $or: [
                                {
                                    'summary.attemptId': provenance.attemptId,
                                    'summary.fenceToken': provenance.fenceToken,
                                },
                                { 'summary.fenceToken': { $lt: provenance.fenceToken } },
                                {
                                    status: { $exists: false },
                                    'summary.fenceToken': { $exists: false },
                                },
                            ],
                        },
                        {
                            $set: {
                                jobName: JOB_NAME,
                                mode: 'repair',
                                status: 'success',
                                startedAt: new Date(provenance.startedAt),
                                finishedAt,
                                durationMs: counts.durationMs,
                                trigger: evidenceTrigger(provenance.trigger),
                                releaseTag: provenance.releaseTag,
                                counts,
                                summary: {
                                    mode: 'repair',
                                    epoch,
                                    attemptId: provenance.attemptId,
                                    fenceToken: provenance.fenceToken,
                                    attemptStartedAt: provenance.startedAt,
                                    completedAt: provenance.completedAt,
                                    counts,
                                },
                            },
                            $unset: { error: 1 },
                        },
                        { upsert: true },
                    );
                    assertEvidenceWrite(write, 'success');

                    console.log(
                        `[RealGraphDecayJob] Completed in ${counts.durationMs}ms - ` +
                        `decayed: ${counts.decayedEdges}, cleaned: ${counts.cleanedEdges}`
                    );
                },
                { trigger, releaseTag },
            );
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
        this.abortController?.abort(new Error('[RealGraphDecayJob] Abort requested'));
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
