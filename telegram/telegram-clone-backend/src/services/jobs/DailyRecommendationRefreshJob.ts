import mongoose from 'mongoose';
import { Op } from 'sequelize';
import User from '../../models/User';
import Post from '../../models/Post';
import PostFeatureSnapshot from '../../models/PostFeatureSnapshot';
import RecommendationJobRun from '../../models/RecommendationJobRun';
import { simClustersService } from '../recommendation/SimClustersService';
import { realGraphService } from '../recommendation/RealGraphService';
import { registeredUserFeatureBootstrapService } from '../recommendation/users';
import { postFeatureSnapshotService } from '../recommendation/contentFeatures';
import {
    scanEmbeddingContractEvidence,
    type PersistedEmbeddingEvidenceSummary,
} from '../ops/recommendation/embeddingEvidenceAudit';
import { featureExportJob } from './FeatureExportJob';

type Trigger = 'cron' | 'manual' | 'script';

export interface DailyRecommendationRefreshOptions {
    trigger?: Trigger;
    userLimit?: number;
    postDays?: number;
    postBatchSize?: number;
    skipFeatureExport?: boolean;
}

export interface DailyRecommendationRefreshResult {
    users: {
        registered: number;
        bootstrapped: number;
        embeddingsUpdated: number;
        embeddingFailures: number;
        denseVectorsRepaired: number;
    };
    realGraph: {
        decayedEdges: number;
        predictionMatched: number;
        predictionUpdated: number;
    };
    posts: {
        scanned: number;
        refreshed: number;
    };
    postDiagnostics?: {
        windowDays: number;
        historicalBackfillTriggered: boolean;
        reason: 'none' | 'empty_recent_window' | 'invalid_snapshots_detected' | 'empty_recent_window_and_invalid_snapshots';
        historicalScanned: number;
        historicalRefreshed: number;
        invalidSnapshotsBefore: number;
        invalidSnapshotsAfter: number;
    };
    featureExport?: {
        usersExported: number;
        clustersExported: number;
        postsExported: number;
        durationMs: number;
    };
    embeddingEvidence: PersistedEmbeddingEvidenceSummary;
}

const CONFIG = {
    userBatchSize: 100,
    userLimit: Math.max(1, parseInt(String(process.env.DAILY_RECOMMENDATION_REFRESH_USER_LIMIT || '100000'), 10) || 100000),
    postDays: Math.max(1, parseInt(String(process.env.DAILY_RECOMMENDATION_REFRESH_POST_DAYS || '30'), 10) || 30),
    postBatchSize: Math.max(1, parseInt(String(process.env.DAILY_RECOMMENDATION_REFRESH_POST_BATCH || '200'), 10) || 200),
    historicalPostBackfillLimit: Math.max(1, parseInt(String(process.env.DAILY_RECOMMENDATION_HISTORICAL_POST_BACKFILL_LIMIT || '500'), 10) || 500),
};

export class DailyRecommendationRefreshJob {
    private isRunning = false;

    async run(options: DailyRecommendationRefreshOptions = {}): Promise<DailyRecommendationRefreshResult> {
        if (this.isRunning) {
            throw new Error('[DailyRecommendationRefreshJob] Job is already running');
        }

        this.isRunning = true;
        const startedAt = new Date();
        let runDoc: { _id: unknown } | undefined;

        try {
            runDoc = await RecommendationJobRun.create({
                jobName: 'daily_recommendation_refresh',
                status: 'running',
                startedAt,
                trigger: options.trigger ?? 'cron',
                releaseTag: process.env.RELEASE_TAG || process.env.SENTRY_RELEASE,
                summary: {},
            });
            const result = await this.execute(options);
            const finishedAt = new Date();
            await RecommendationJobRun.updateOne(
                { _id: runDoc._id },
                {
                    $set: {
                        status: 'success',
                        finishedAt,
                        durationMs: finishedAt.getTime() - startedAt.getTime(),
                        summary: result,
                    },
                },
            );
            return result;
        } catch (error) {
            if (runDoc) {
                const finishedAt = new Date();
                await RecommendationJobRun.updateOne(
                    { _id: runDoc._id },
                    {
                        $set: {
                            status: 'failed',
                            finishedAt,
                            durationMs: finishedAt.getTime() - startedAt.getTime(),
                            error: error instanceof Error ? error.message : String(error),
                        },
                    },
                );
            }
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    private async execute(options: DailyRecommendationRefreshOptions): Promise<DailyRecommendationRefreshResult> {
        const userLimit = Math.max(1, Math.min(options.userLimit ?? CONFIG.userLimit, 100000));
        const postDays = Math.max(1, options.postDays ?? CONFIG.postDays);
        const postBatchSize = Math.max(1, Math.min(options.postBatchSize ?? CONFIG.postBatchSize, 1000));

        const bootstrap = await registeredUserFeatureBootstrapService.backfill({
            limit: userLimit,
            batchSize: 500,
        });
        const userEmbeddingResult = await this.refreshAllRegisteredUserEmbeddings(userLimit);
        const realGraphDecay = await realGraphService.applyDailyDecay();
        const realGraphPrediction = await realGraphService.backfillPredictionMetadata({
            limit: 10000,
            batchSize: 500,
            since: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000),
            force: true,
        });
        const postRefresh = await this.refreshRecentPostSnapshots(postDays, postBatchSize);
        let { embeddingEvidence } = await scanEmbeddingContractEvidence({ limit: undefined });
        const invalidSnapshotsBefore = embeddingEvidence.cohorts?.postFeatureSnapshots?.invalid ?? 0;

        const emptyRecentWindow = postRefresh.scanned === 0;
        const hasInvalidSnapshots = invalidSnapshotsBefore > 0;
        let historicalScanned = 0;
        let historicalRefreshed = 0;

        // 当最近 N 天扫描为空或检测到 invalid 快照时，执行有界增量历史快照补齐
        if (emptyRecentWindow || hasInvalidSnapshots) {
            const backfill = await this.backfillHistoricalPostSnapshots({
                batchSize: postBatchSize,
                limit: CONFIG.historicalPostBackfillLimit,
                preferInvalidSnapshots: hasInvalidSnapshots,
                createdBefore: new Date(Date.now() - postDays * 24 * 60 * 60 * 1000),
            });
            historicalScanned = backfill.scanned;
            historicalRefreshed = backfill.refreshed;
            if (historicalRefreshed > 0) {
                const refreshedEvidence = await scanEmbeddingContractEvidence({ limit: undefined });
                embeddingEvidence = refreshedEvidence.embeddingEvidence;
            }
        }

        const invalidSnapshotsAfter = embeddingEvidence.cohorts?.postFeatureSnapshots?.invalid ?? 0;
        const backfillReason = emptyRecentWindow && hasInvalidSnapshots
            ? 'empty_recent_window_and_invalid_snapshots'
            : emptyRecentWindow
                ? 'empty_recent_window'
                : hasInvalidSnapshots
                    ? 'invalid_snapshots_detected'
                    : 'none';

        const featureExport = options.skipFeatureExport
            ? undefined
            : await featureExportJob.run();

        return {
            users: {
                registered: bootstrap.scanned,
                bootstrapped: bootstrap.created,
                embeddingsUpdated: userEmbeddingResult.success,
                embeddingFailures: userEmbeddingResult.failed,
                denseVectorsRepaired: userEmbeddingResult.denseVectorsRepaired,
            },
            realGraph: {
                decayedEdges: realGraphDecay.totalProcessed,
                predictionMatched: realGraphPrediction.matched,
                predictionUpdated: realGraphPrediction.updated,
            },
            posts: postRefresh,
            postDiagnostics: {
                windowDays: postDays,
                historicalBackfillTriggered: emptyRecentWindow || hasInvalidSnapshots,
                reason: backfillReason,
                historicalScanned,
                historicalRefreshed,
                invalidSnapshotsBefore,
                invalidSnapshotsAfter,
            },
            featureExport,
            embeddingEvidence,
        };
    }

    private async refreshAllRegisteredUserEmbeddings(limit: number): Promise<{
        success: number;
        failed: number;
        denseVectorsRepaired: number;
    }> {
        let success = 0;
        let failed = 0;
        let denseVectorsRepaired = 0;
        let cursor: { createdAt: Date; id: string } | undefined;

        while (success + failed < limit) {
            const users = await User.findAll({
                attributes: ['id', 'username', 'region', 'language', 'createdAt'],
                where: cursor
                    ? {
                        [Op.or]: [
                            { createdAt: { [Op.lt]: cursor.createdAt } },
                            {
                                createdAt: cursor.createdAt,
                                id: { [Op.lt]: cursor.id },
                            },
                        ],
                    }
                    : undefined,
                order: [
                    ['createdAt', 'DESC'],
                    ['id', 'DESC'],
                ],
                limit: Math.min(CONFIG.userBatchSize, limit - success - failed),
            });
            if (users.length === 0) break;

            const result = await simClustersService.batchUpdateEmbeddings(
                users.map((user) => user.id),
            );
            const denseRepair = await registeredUserFeatureBootstrapService.repairDenseVectors(users);
            success += result.success;
            failed += result.failed;
            denseVectorsRepaired += denseRepair.repaired;

            const lastUser = users[users.length - 1];
            cursor = {
                createdAt: lastUser.createdAt,
                id: lastUser.id,
            };
        }

        return { success, failed, denseVectorsRepaired };
    }

    private async refreshRecentPostSnapshots(days: number, batchSize: number): Promise<{ scanned: number; refreshed: number }> {
        const createdAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        let scanned = 0;
        let refreshed = 0;
        let cursor: { createdAt: Date; id: mongoose.Types.ObjectId } | undefined;

        while (true) {
            const query: Record<string, unknown> = {
                ...(cursor
                    ? {
                        $or: [
                            { createdAt: { $gte: createdAfter, $lt: cursor.createdAt } },
                            { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
                        ],
                    }
                    : { createdAt: { $gte: createdAfter } }),
                deletedAt: null,
            };

            const posts = await Post.find(query)
                .select('_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId')
                .sort({ createdAt: -1, _id: -1 })
                .limit(batchSize)
                .lean();

            if (posts.length === 0) break;

            const postIds = posts.map((post) => post._id as mongoose.Types.ObjectId);
            const refreshedSnapshots = await postFeatureSnapshotService.refreshSnapshotsByPostIds(postIds);
            scanned += posts.length;
            refreshed += refreshedSnapshots.size;
            const lastPost = posts[posts.length - 1];
            cursor = {
                createdAt: new Date(lastPost.createdAt),
                id: lastPost._id as mongoose.Types.ObjectId,
            };
        }

        return { scanned, refreshed };
    }

    /**
     * 安全增量补齐历史帖子快照：
     * - 仅在最近窗口无帖子或存在 invalid 快照时触发
     * - 每次受 limit 上限约束，避免全表扫爆内存或连接
     */
    private async backfillHistoricalPostSnapshots(options: {
        batchSize: number;
        limit: number;
        preferInvalidSnapshots: boolean;
        createdBefore: Date;
    }): Promise<{ scanned: number; refreshed: number }> {
        const candidateIds: mongoose.Types.ObjectId[] = [];
        const seenIds = new Set<string>();

        if (options.preferInvalidSnapshots && typeof (PostFeatureSnapshot as any)?.find === 'function') {
            const staleSnapshots = await PostFeatureSnapshot.find({
                $or: [
                    { embeddingContract: { $exists: false } },
                    { embeddingContract: null },
                    { denseEmbedding: { $exists: false } },
                    { denseEmbedding: { $size: 0 } },
                ],
            })
                .sort({ computedAt: 1, _id: 1 })
                .limit(options.limit)
                .select('postId')
                .lean();

            for (const snap of staleSnapshots) {
                const rawId = (snap as { postId?: mongoose.Types.ObjectId }).postId;
                const key = rawId ? String(rawId) : '';
                if (!key || seenIds.has(key)) continue;
                seenIds.add(key);
                candidateIds.push(rawId as mongoose.Types.ObjectId);
            }
        }

        if (candidateIds.length < options.limit) {
            const remaining = options.limit - candidateIds.length;
            const historicalPosts = await Post.find({
                deletedAt: null,
                createdAt: { $lt: options.createdBefore },
            })
                .select('_id')
                .sort({ createdAt: -1, _id: -1 })
                .limit(remaining)
                .lean();

            for (const post of historicalPosts) {
                const rawId = post._id as mongoose.Types.ObjectId;
                const key = rawId ? String(rawId) : '';
                if (!key || seenIds.has(key)) continue;
                seenIds.add(key);
                candidateIds.push(rawId);
            }
        }

        let refreshed = 0;
        for (let i = 0; i < candidateIds.length; i += options.batchSize) {
            const chunk = candidateIds.slice(i, i + options.batchSize);
            const updated = await postFeatureSnapshotService.refreshSnapshotsByPostIds(chunk);
            refreshed += updated.size;
        }

        return {
            scanned: candidateIds.length,
            refreshed,
        };
    }

    get running(): boolean {
        return this.isRunning;
    }
}

export const dailyRecommendationRefreshJob = new DailyRecommendationRefreshJob();
