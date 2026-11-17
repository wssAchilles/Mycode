import mongoose from 'mongoose';
import Post from '../../models/Post';
import PostFeatureSnapshot from '../../models/PostFeatureSnapshot';
import { inferContentSafetyCategories } from '../recommendation/contentFeatures/featureExtraction';
import {
    RecsysStreamPublisher,
    recsysStreamPublisher as defaultPublisher,
    SidEncoderClient,
    sidEncoderClient as defaultSidClient,
} from '../recommendation/realtime';
import { createChildLogger } from '../../utils/logger';

const log = createChildLogger('services:jobs:PostSemanticBackfillJob');

export interface PostSemanticBackfillOptions {
    batchSize?: number;
    maxPosts?: number;
    onlyMissing?: boolean;
    dryRun?: boolean;
}

export interface PostSemanticBackfillResult {
    scanned: number;
    updated: number;
    failed: number;
    totalActivePosts: number;
    semanticReadyPosts: number;
    semanticReadyRatio: number;
    durationMs: number;
}

/**
 * PostSemanticBackfillJob - 存量帖子 V3 Semantic ID (6x256) 与安全标签回刷作业
 */
export class PostSemanticBackfillJob {
    private isRunning = false;
    private abortController: AbortController | null = null;
    private readonly sidClient: SidEncoderClient;
    private readonly publisher: RecsysStreamPublisher;

    constructor(deps?: { sidClient?: SidEncoderClient; publisher?: RecsysStreamPublisher }) {
        this.sidClient = deps?.sidClient ?? defaultSidClient;
        this.publisher = deps?.publisher ?? defaultPublisher;
    }

    async run(options: PostSemanticBackfillOptions = {}): Promise<PostSemanticBackfillResult> {
        if (this.isRunning) {
            throw new Error('[PostSemanticBackfillJob] Job is already running');
        }

        const batchSize = Math.max(1, Math.min(100, options.batchSize ?? 20));
        const maxPosts = options.maxPosts && options.maxPosts > 0 ? options.maxPosts : Number.MAX_SAFE_INTEGER;
        const onlyMissing = options.onlyMissing ?? true;
        const dryRun = options.dryRun ?? false;

        this.isRunning = true;
        this.abortController = new AbortController();
        const startedAt = Date.now();

        let scanned = 0;
        let updated = 0;
        let failed = 0;

        try {
            const filter: Record<string, unknown> = { deletedAt: null };
            if (onlyMissing) {
                filter.$or = [
                    { semanticStatus: { $ne: 'semantic_ready' } },
                    { semanticIds: { $exists: false } },
                    { semanticIds: { $size: 0 } },
                ];
            }

            let lastId: mongoose.Types.ObjectId | null = null;
            while (scanned < maxPosts && !this.abortController.signal.aborted) {
                const pageQuery = lastId
                    ? { ...filter, _id: { $gt: lastId } }
                    : filter;

                const remaining = maxPosts - scanned;
                const pageLimit = Math.min(batchSize, remaining);
                const docs = await Post.find(pageQuery)
                    .sort({ _id: 1 })
                    .limit(pageLimit)
                    .select('_id content keywords newsMetadata.title isNsfw')
                    .lean();

                if (docs.length === 0) {
                    break;
                }

                lastId = docs[docs.length - 1]._id as mongoose.Types.ObjectId;
                scanned += docs.length;

                if (dryRun) {
                    continue;
                }

                const encoded = await this.sidClient.encodeBatch(
                    docs.map((doc) => ({
                        postId: String(doc._id),
                        content: String(doc.content || ''),
                        title: doc.newsMetadata?.title,
                        keywords: Array.isArray(doc.keywords) ? doc.keywords : [],
                    })),
                );

                const encodedMap = new Map(encoded.map((item) => [item.postId, item]));
                const postOps: Parameters<typeof Post.bulkWrite>[0] = [];
                const snapshotOps: Parameters<typeof PostFeatureSnapshot.bulkWrite>[0] = [];
                const docById = new Map(docs.map((d) => [String(d._id), d]));

                for (const doc of docs) {
                    const postIdStr = String(doc._id);
                    const resItem = encodedMap.get(postIdStr);
                    if (!resItem) {
                        failed += 1;
                        postOps.push({
                            updateOne: {
                                filter: { _id: doc._id },
                                update: { $set: { semanticStatus: 'failed' } },
                            },
                        });
                        continue;
                    }

                    const safetyLabels = inferContentSafetyCategories({
                        content: String(doc.content || ''),
                    });
                    if (doc.isNsfw && !safetyLabels.includes('nsfw')) {
                        safetyLabels.push('nsfw');
                    }

                    postOps.push({
                        updateOne: {
                            filter: { _id: doc._id },
                            update: {
                                $set: {
                                    semanticIds: resItem.semanticIds,
                                    ...(resItem.semanticIdsU64 ? { semanticIdsU64: resItem.semanticIdsU64 } : {}),
                                    contentSafetyLabels: safetyLabels,
                                    semanticStatus: 'semantic_ready',
                                },
                            },
                        },
                    });

                    snapshotOps.push({
                        updateOne: {
                            filter: { postId: doc._id },
                            update: {
                                $set: {
                                    denseEmbedding: resItem.embedding256d,
                                    embeddingContract: resItem.embeddingContract,
                                    embeddingModelMode: 'remote_prediction',
                                    embeddingPlanVersion: 'v3_sid_text_encoder_onnx',
                                    contentSafetyCategories: safetyLabels,
                                    computedAt: new Date(),
                                },
                            },
                        },
                    });

                    updated += 1;
                }

                if (postOps.length > 0) {
                    await Post.bulkWrite(postOps, { ordered: false });
                }
                if (snapshotOps.length > 0) {
                    await PostFeatureSnapshot.bulkWrite(snapshotOps, { ordered: false });
                }

                // 通知内网 Stream，供 Rust 倒排索引增量激活
                for (const item of encoded) {
                    const orig = docById.get(item.postId);
                    const labels = inferContentSafetyCategories({
                        content: String(orig?.content || ''),
                    });
                    if (orig?.isNsfw && !labels.includes('nsfw')) {
                        labels.push('nsfw');
                    }
                    await this.publisher.publishEvent('post.sid_assigned', {
                        postId: item.postId,
                        semanticIds: item.semanticIds,
                        semanticIdsU64: item.semanticIdsU64,
                        contentSafetyLabels: labels,
                        artifactVersion: item.embeddingContract.artifactVersion,
                    });
                }
            }

            const [totalActivePosts, semanticReadyPosts] = await Promise.all([
                Post.countDocuments({ deletedAt: null }),
                Post.countDocuments({ deletedAt: null, semanticStatus: 'semantic_ready' }),
            ]);
            const semanticReadyRatio = totalActivePosts > 0 ? semanticReadyPosts / totalActivePosts : 1.0;

            const result: PostSemanticBackfillResult = {
                scanned,
                updated,
                failed,
                totalActivePosts,
                semanticReadyPosts,
                semanticReadyRatio,
                durationMs: Date.now() - startedAt,
            };

            log.info(result, '[PostSemanticBackfillJob] Completed');
            return result;
        } finally {
            this.isRunning = false;
            this.abortController = null;
        }
    }

    abort(): void {
        this.abortController?.abort(new Error('[PostSemanticBackfillJob] Abort requested'));
    }

    getStatus(): { isRunning: boolean } {
        return { isRunning: this.isRunning };
    }
}

export const postSemanticBackfillJob = new PostSemanticBackfillJob();
