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

const JOB_NAME = 'simclusters-batch-repair';

function assertEvidenceWrite(
    result: { acknowledged: boolean; matchedCount?: number; upsertedCount?: number },
    phase: string,
): void {
    if (!result.acknowledged || (result.matchedCount ?? 0) + (result.upsertedCount ?? 0) === 0) {
        throw new Error(`[SimClustersBatchJob] ${phase} evidence write was not applied`);
    }
}

function evidenceTrigger(value: string | undefined): Trigger {
    if (value === 'cron' || value === 'manual' || value === 'script') {
        return value;
    }
    throw new Error('[SimClustersBatchJob] Invalid completion trigger provenance');
}

// ========== 作业类 ==========
export class SimClustersBatchJob {
    private isRunning = false;
    private abortController: AbortController | undefined;

    constructor(private readonly coordinator: RepairJobCoordinator = repairLeaseCoordinator) {}

    /**
     * 运行批量更新作业
     */
    async run(options: {
        epoch: string;
        maxUsers?: number;
        onlyStale?: boolean;
        trigger?: Trigger;
        onProgress?: (processed: number, total: number) => void;
    }): Promise<{
        success: number;
        failed: number;
        skipped: number;
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
                        let success = 0;
                        let failed = 0;
                        const skipped = 0;
                        const maxUsers = options.maxUsers || CONFIG.maxUsersPerRun;

                        console.log('[SimClustersBatchJob] Starting batch job...');

                        const userIds = await this.getUsersToProcess(maxUsers, options.onlyStale);
                        signal.throwIfAborted();
                        console.log(`[SimClustersBatchJob] Found ${userIds.length} users to process`);

                        if (userIds.length === 0) {
                            console.log('[SimClustersBatchJob] No users to process');
                            return { success, failed, skipped, durationMs: Date.now() - startTime };
                        }

                        for (let i = 0; i < userIds.length; i += CONFIG.batchSize) {
                            signal.throwIfAborted();

                            const batch = userIds.slice(i, i + CONFIG.batchSize);
                            const results = await this.processBatch(batch, signal);
                            signal.throwIfAborted();

                            success += results.success;
                            failed += results.failed;
                            if (failed > 0) {
                                throw new Error('[SimClustersBatchJob] Batch completed with user failures');
                            }

                            const processed = i + batch.length;
                            if (processed % CONFIG.progressInterval === 0 || processed === userIds.length) {
                                console.log(
                                    `[SimClustersBatchJob] Progress: ${processed}/${userIds.length} ` +
                                    `(success: ${success}, failed: ${failed})`
                                );

                                if (options.onProgress) {
                                    options.onProgress(processed, userIds.length);
                                }
                            }
                        }

                        return { success, failed, skipped, durationMs: Date.now() - startTime };
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
                    await this.markRunSucceeded(
                        evidenceId,
                        counts,
                        epoch,
                        provenance,
                    );
                    console.log(
                        `[SimClustersBatchJob] Completed in ${counts.durationMs}ms - ` +
                        `success: ${counts.success}, failed: ${counts.failed}, skipped: ${counts.skipped}`
                    );
                },
                { trigger, releaseTag },
            );
    }

    /**
     * 请求中止作业
     */
    abort(): void {
        this.abortController?.abort(new Error('[SimClustersBatchJob] Abort requested'));
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
        userIds: string[],
        signal: AbortSignal,
    ): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        // 并发处理 (控制并发数)
        const chunks: string[][] = [];
        for (let i = 0; i < userIds.length; i += CONFIG.concurrency) {
            chunks.push(userIds.slice(i, i + CONFIG.concurrency));
        }

        for (const chunk of chunks) {
            signal.throwIfAborted();
            const results = await Promise.allSettled(
                chunk.map((userId) => {
                    signal.throwIfAborted();
                    return simClustersService.computeAndStoreEmbedding(userId, signal);
                })
            );
            signal.throwIfAborted();

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

    private async markRunSucceeded(
        evidenceId: string,
        counts: { success: number; failed: number; skipped: number; durationMs: number },
        epoch: string,
        provenance: RepairCompletionProvenance,
    ): Promise<void> {
        const finishedAt = new Date(provenance.completedAt);
        const write = await RecommendationJobRun.updateOne(
            {
                _id: evidenceId,
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
    }
}

// ========== 导出单例 ==========
export const simClustersBatchJob = new SimClustersBatchJob();
export default simClustersBatchJob;
