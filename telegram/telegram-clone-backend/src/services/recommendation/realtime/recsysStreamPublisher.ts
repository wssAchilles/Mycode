import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { redis as defaultRedis } from '../../../config/redis';
import Post, { IPost } from '../../../models/Post';
import PostFeatureSnapshot from '../../../models/PostFeatureSnapshot';
import { inferContentSafetyCategories } from '../contentFeatures/featureExtraction';
import { createChildLogger } from '../../../utils/logger';
import {
    SidEncoderClient,
    sidEncoderClient as defaultSidEncoderClient,
} from './sidEncoderClient';

const log = createChildLogger('services:recommendation:recsysStreamPublisher');

export const RECSYS_EVENT_STREAM_KEY =
    process.env.RECSYS_EVENT_STREAM_KEY || 'recsys:events:v1';

// 严格限定 Redis Stream 上限为 10000，适配 VPS 192mb 内存约束
export const RECSYS_EVENT_STREAM_MAX_LEN = Math.max(
    1000,
    Math.min(
        20000,
        parseInt(String(process.env.RECSYS_EVENT_STREAM_MAX_LEN || '10000'), 10) || 10000,
    ),
);

export type RecsysStreamEventType =
    | 'post.created'
    | 'post.deleted'
    | 'post.sid_assigned'
    | 'graph.edge_delta';

export type GraphEdgeOp =
    | 'follow'
    | 'unfollow'
    | 'block'
    | 'unblock'
    | 'mute'
    | 'unmute';

export interface GraphEdgeDeltaPayload {
    sourceUserId: string;
    targetUserId: string;
    edgeOp: GraphEdgeOp;
    weightDelta?: number;
    timestampMs?: number;
}

export interface RecsysStreamPublisherDeps {
    redisClient?: Pick<Redis, 'xadd' | 'status'> | null;
    sidClient?: SidEncoderClient;
}

/**
 * 推荐系统 VPS 内网实时事件总线（Redis Stream `recsys:events:v1` + 异步 Cloud Run SID 编码闭环）
 */
export class RecsysStreamPublisher {
    private readonly redisClient: Pick<Redis, 'xadd' | 'status'> | null;
    private readonly sidClient: SidEncoderClient;

    constructor(deps: RecsysStreamPublisherDeps = {}) {
        this.redisClient = deps.redisClient === undefined ? defaultRedis : deps.redisClient;
        this.sidClient = deps.sidClient ?? defaultSidEncoderClient;
    }

    /**
     * 安全写入 VPS 内网 Redis Stream，强制 MAXLEN ~ 10000 防 OOM
     */
    async publishEvent(
        eventType: RecsysStreamEventType,
        payload: Record<string, unknown>,
    ): Promise<string | null> {
        if (!this.redisClient || (this.redisClient.status && this.redisClient.status !== 'ready')) {
            return null;
        }
        try {
            const fields: string[] = [
                'eventType',
                eventType,
                'timestampMs',
                String(Date.now()),
                'payload',
                JSON.stringify(payload),
            ];
            const entryId = await this.redisClient.xadd(
                RECSYS_EVENT_STREAM_KEY,
                'MAXLEN',
                '~',
                String(RECSYS_EVENT_STREAM_MAX_LEN),
                '*',
                ...fields,
            );
            return entryId ? String(entryId) : null;
        } catch (err: any) {
            log.warn(
                { err: err?.message || String(err), eventType },
                '[RecsysStreamPublisher] Redis XADD failed (non-fatal)',
            );
            return null;
        }
    }

    /**
     * 发帖即时发射：先写入 `post.created`，再异步不阻塞调 Cloud Run `/sid/encode` 回写 SID 与安全标签
     */
    publishPostCreatedAndEncodeSid(post: Pick<IPost, '_id' | 'authorId' | 'content' | 'keywords' | 'isReply' | 'isNews' | 'newsMetadata' | 'createdAt' | 'isNsfw'>): void {
        const postId = String(post._id);
        const safetyLabels = inferContentSafetyCategories({
            content: post.content || '',
            isNews: Boolean(post.isNews),
        });
        if (post.isNsfw && !safetyLabels.includes('nsfw')) {
            safetyLabels.push('nsfw');
        }

        this.publishEvent('post.created', {
            postId,
            authorId: String(post.authorId),
            createdAtMs: post.createdAt ? new Date(post.createdAt).getTime() : Date.now(),
            isReply: Boolean(post.isReply),
            isNews: Boolean(post.isNews),
            contentSafetyLabels: safetyLabels,
        }).catch(() => {});

        // 异步非阻塞 HTTP 直推 Cloud Run /sid/encode，不阻塞用户发帖响应
        this.encodeAndPersistPostSemantics({
            postId,
            content: post.content || '',
            title: post.newsMetadata?.title,
            keywords: post.keywords || [],
            safetyLabels,
        }).catch((err: any) => {
            log.warn(
                { err: err?.message || String(err), postId },
                '[RecsysStreamPublisher] Async SID encoding failed',
            );
        });
    }

    /**
     * 删帖即时发射 `post.deleted` 供 Rust InNetworkStore 秒级剔除
     */
    publishPostDeleted(postId: string, authorId: string): void {
        this.publishEvent('post.deleted', {
            postId,
            authorId,
            deletedAtMs: Date.now(),
        }).catch(() => {});
    }

    /**
     * 社交关系变更即时发射 `graph.edge_delta` 供 C++ Graph Kernel 秒级断边/建边
     */
    publishGraphEdgeDelta(delta: GraphEdgeDeltaPayload): void {
        this.publishEvent('graph.edge_delta', {
            sourceUserId: String(delta.sourceUserId),
            targetUserId: String(delta.targetUserId),
            edgeOp: delta.edgeOp,
            weightDelta: delta.weightDelta ?? resolveDefaultEdgeWeightDelta(delta.edgeOp),
            timestampMs: delta.timestampMs ?? Date.now(),
        }).catch(() => {});
    }

    /**
     * 异步调用 /sid/encode 并原子回写 Post 与 PostFeatureSnapshot 后通知 Stream
     */
    async encodeAndPersistPostSemantics(input: {
        postId: string;
        content: string;
        title?: string;
        keywords?: string[];
        safetyLabels?: string[];
    }): Promise<boolean> {
        const encoded = await this.sidClient.encodeBatch([
            {
                postId: input.postId,
                content: input.content,
                title: input.title,
                keywords: input.keywords,
            },
        ]);

        if (encoded.length === 0) {
            if (mongoose.Types.ObjectId.isValid(input.postId)) {
                await Post.updateOne(
                    { _id: new mongoose.Types.ObjectId(input.postId) },
                    { $set: { semanticStatus: 'failed' } },
                ).catch(() => {});
            }
            return false;
        }

        const item = encoded[0];
        const safetyLabels = input.safetyLabels ?? inferContentSafetyCategories({
            content: input.content,
        });

        if (mongoose.Types.ObjectId.isValid(item.postId)) {
            const objId = new mongoose.Types.ObjectId(item.postId);
            await Promise.all([
                Post.updateOne(
                    { _id: objId },
                    {
                        $set: {
                            semanticIds: item.semanticIds,
                            ...(item.semanticIdsU64 ? { semanticIdsU64: item.semanticIdsU64 } : {}),
                            contentSafetyLabels: safetyLabels,
                            semanticStatus: 'semantic_ready',
                        },
                    },
                ),
                PostFeatureSnapshot.updateOne(
                    { postId: objId },
                    {
                        $set: {
                            denseEmbedding: item.embedding256d,
                            embeddingContract: item.embeddingContract,
                            embeddingModelMode: 'remote_prediction',
                            embeddingPlanVersion: 'v3_sid_text_encoder_onnx',
                            contentSafetyCategories: safetyLabels,
                            computedAt: new Date(),
                        },
                    },
                ),
            ]);
        }

        await this.publishEvent('post.sid_assigned', {
            postId: item.postId,
            semanticIds: item.semanticIds,
            semanticIdsU64: item.semanticIdsU64,
            contentSafetyLabels: safetyLabels,
            artifactVersion: item.embeddingContract.artifactVersion,
        });

        return true;
    }
}

function resolveDefaultEdgeWeightDelta(edgeOp: GraphEdgeOp): number {
    switch (edgeOp) {
        case 'follow':
            return 1.0;
        case 'unfollow':
            return -1.0;
        case 'block':
            return -10.0;
        case 'unblock':
            return 0.0;
        case 'mute':
            return -5.0;
        case 'unmute':
            return 0.0;
    }
}

export const recsysStreamPublisher = new RecsysStreamPublisher();
