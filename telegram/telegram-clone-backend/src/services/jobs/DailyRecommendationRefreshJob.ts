import mongoose from 'mongoose';
import User from '../../models/User';
import Post from '../../models/Post';
import PostFeatureSnapshot from '../../models/PostFeatureSnapshot';
import RecommendationJobRun from '../../models/RecommendationJobRun';
import { simClustersService } from '../recommendation/SimClustersService';
import { realGraphService } from '../recommendation/RealGraphService';
import { registeredUserFeatureBootstrapService } from '../recommendation/users';
import { postFeatureSnapshotService } from '../recommendation/contentFeatures';
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
    featureExport?: {
        usersExported: number;
        clustersExported: number;
        postsExported: number;
        durationMs: number;
    };
}

const CONFIG = {
    userBatchSize: 100,
    userLimit: Math.max(1, parseInt(String(process.env.DAILY_RECOMMENDATION_REFRESH_USER_LIMIT || '100000'), 10) || 100000),
    postDays: Math.max(1, parseInt(String(process.env.DAILY_RECOMMENDATION_REFRESH_POST_DAYS || '30'), 10) || 30),
    postBatchSize: Math.max(1, parseInt(String(process.env.DAILY_RECOMMENDATION_REFRESH_POST_BATCH || '200'), 10) || 200),
};

export class DailyRecommendationRefreshJob {
    private isRunning = false;

    async run(options: DailyRecommendationRefreshOptions = {}): Promise<DailyRecommendationRefreshResult> {
        if (this.isRunning) {
            throw new Error('[DailyRecommendationRefreshJob] Job is already running');
        }

        this.isRunning = true;
        const startedAt = new Date();
        const runDoc = await RecommendationJobRun.create({
            jobName: 'daily_recommendation_refresh',
            status: 'running',
            startedAt,
            trigger: options.trigger ?? 'cron',
            releaseTag: process.env.RELEASE_TAG || process.env.SENTRY_RELEASE,
            summary: {},
        });

        try {
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
        const featureExport = options.skipFeatureExport
            ? undefined
            : await featureExportJob.run();

        return {
            users: {
                registered: bootstrap.scanned,
                bootstrapped: bootstrap.created,
                embeddingsUpdated: userEmbeddingResult.success,
                embeddingFailures: userEmbeddingResult.failed,
            },
            realGraph: {
                decayedEdges: realGraphDecay.totalProcessed,
                predictionMatched: realGraphPrediction.matched,
                predictionUpdated: realGraphPrediction.updated,
            },
            posts: postRefresh,
            featureExport,
        };
    }

    private async refreshAllRegisteredUserEmbeddings(limit: number): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;
        let offset = 0;

        while (offset < limit) {
            const users = await User.findAll({
                attributes: ['id'],
                order: [['createdAt', 'DESC']],
                offset,
                limit: Math.min(CONFIG.userBatchSize, limit - offset),
            });
            if (users.length === 0) break;

            const result = await simClustersService.batchUpdateEmbeddings(
                users.map((user) => user.id),
            );
            success += result.success;
            failed += result.failed;
            offset += users.length;
        }

        return { success, failed };
    }

    private async refreshRecentPostSnapshots(days: number, batchSize: number): Promise<{ scanned: number; refreshed: number }> {
        const createdAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        let scanned = 0;
        let refreshed = 0;
        let cursor: Date | undefined;

        while (true) {
            const query: Record<string, unknown> = {
                createdAt: cursor
                    ? { $gte: createdAfter, $lt: cursor }
                    : { $gte: createdAfter },
                deletedAt: null,
            };

            const posts = await Post.find(query)
                .select('_id authorId content keywords language createdAt updatedAt media stats engagementScore isNews newsMetadata.clusterId')
                .sort({ createdAt: -1, _id: -1 })
                .limit(batchSize)
                .lean();

            if (posts.length === 0) break;

            const postIds = posts.map((post) => post._id as mongoose.Types.ObjectId);
            await postFeatureSnapshotService.refreshSnapshotsByPostIds(postIds);
            scanned += posts.length;
            refreshed += posts.length;
            cursor = new Date(posts[posts.length - 1].createdAt);
        }

        const totalSnapshots = await PostFeatureSnapshot.countDocuments();
        return {
            scanned,
            refreshed: Math.min(refreshed, totalSnapshots),
        };
    }

    get running(): boolean {
        return this.isRunning;
    }
}

export const dailyRecommendationRefreshJob = new DailyRecommendationRefreshJob();
