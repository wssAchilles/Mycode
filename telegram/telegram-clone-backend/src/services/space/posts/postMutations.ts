/**
 * Space posts domain (create/read/delete/pin).
 * Extracted from spaceService with identical control flow.
 */
import mongoose from 'mongoose';
import Post, { IPost, MediaType } from '../../../models/Post';
import { recordRecommendationEvent } from '../../recommendation/events';
import { InNetworkTimelineService } from '../../recommendation/InNetworkTimelineService';
import { followingTimelineCache } from '../../recommendation/sources/FollowingTimelineCache';
import { createChildLogger } from '../../../utils/logger';
import type { CreatePostParams } from '../types';
import { extractKeywords } from '../internal/pureHelpers';
import { refreshPostFeatureSnapshots } from '../internal/postFeatureSnapshots';
import { recsysStreamPublisher } from '../../recommendation/realtime';

const log = createChildLogger('services:spaceService');

export async function createPost(params: CreatePostParams): Promise<IPost> {
    const { authorId, content, media, replyToPostId, quotePostId, quoteContent } = params;

    // 提取关键词 (用于 MutedKeywordFilter)
    const keywords = extractKeywords(content);

    const postData: Partial<IPost> = {
        authorId,
        content,
        keywords,
        media: media?.map(m => ({ ...m, type: m.type as MediaType })) || [],
    };

    // 处理回复
    if (replyToPostId) {
        postData.isReply = true;
        postData.replyToPostId = new mongoose.Types.ObjectId(replyToPostId);

        // 获取对话根帖子
        const parentPost = await Post.findById(replyToPostId);
        if (parentPost) {
            postData.conversationId = (parentPost.conversationId || parentPost._id) as mongoose.Types.ObjectId;
            // 增加父帖子评论数
            await Post.incrementStat(parentPost._id as mongoose.Types.ObjectId, 'commentCount', 1);
        }
    }

    // 处理引用转发
    if (quotePostId) {
        postData.isRepost = true;
        postData.originalPostId = new mongoose.Types.ObjectId(quotePostId);
        postData.quoteContent = quoteContent;

        // 增加原帖引用数和转发数
        await Post.incrementStat(new mongoose.Types.ObjectId(quotePostId), 'quoteCount', 1);
        await Post.incrementStat(new mongoose.Types.ObjectId(quotePostId), 'repostCount', 1);
    }

    const post = new Post(postData);
    await post.save();

    // Write-light in-network timeline: one Redis ZSET write per post.
    // Best-effort: feed can fall back to DB-based paths if Redis is unavailable.
    InNetworkTimelineService.addPost(authorId, String(post._id), post.createdAt).catch((err) => {
        log.warn('[SpaceService] timeline addPost failed', err);
    });

    refreshPostFeatureSnapshots([
        post._id as mongoose.Types.ObjectId,
        replyToPostId,
        quotePostId,
    ]);

    // 异步非阻塞推送新帖事件至内网 Stream 并触发 Cloud Run /sid/encode 实时打标
    recsysStreamPublisher.publishPostCreatedAndEncodeSid(post);

    return post;
}

export async function getPost(postId: string, userId?: string): Promise<IPost | null> {
    if (!mongoose.Types.ObjectId.isValid(postId)) return null;

    const post = await Post.findOne({
        _id: postId,
        deletedAt: null,
    });

    if (!post) return null;

    // 记录浏览行为
    if (userId) {
        await recordRecommendationEvent({
            userId,
            eventType: 'click',
            targetId: post._id as mongoose.Types.ObjectId,
            targetAuthorId: post.authorId,
            productSurface: 'space_feed',
        });

        // 增加浏览数
        await Post.incrementStat(post._id as mongoose.Types.ObjectId, 'viewCount', 1);
    }
    return post;
}

export async function getPostsByIds(postIds: string[]): Promise<IPost[]> {
    if (!postIds || postIds.length === 0) return [];

    const normalizedIds = postIds.map((id) => String(id || '').trim()).filter(Boolean);
    const objectIdStrings = normalizedIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const externalIds = normalizedIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));

    const orQuery: Record<string, unknown>[] = [];
    if (objectIdStrings.length > 0) {
        orQuery.push({
            _id: { $in: objectIdStrings.map((id) => new mongoose.Types.ObjectId(id)) },
        });
    }
    if (externalIds.length > 0) {
        orQuery.push({
            'newsMetadata.externalId': { $in: externalIds },
        });
    }
    if (orQuery.length === 0) return [];

    const posts = await Post.find({
        deletedAt: null,
        $or: orQuery,
    });

    // 内存中重新排序 (MongoDB $in 不保证顺序)，同时支持 objectId 和 externalId 两种语料 ID
    const objectIdMap = new Map<string, IPost>();
    const externalIdMap = new Map<string, IPost>();
    for (const p of posts) {
        const idStr = p._id?.toString?.();
        if (idStr) objectIdMap.set(idStr, p);
        const ext = p.newsMetadata?.externalId ? String(p.newsMetadata.externalId) : '';
        if (ext) externalIdMap.set(ext, p);
    }

    return normalizedIds
        .map((id) => {
            if (mongoose.Types.ObjectId.isValid(id)) {
                return objectIdMap.get(id) || externalIdMap.get(id);
            }
            return externalIdMap.get(id);
        })
        .filter((p): p is IPost => !!p);
}

export async function deletePost(postId: string, userId: string): Promise<boolean> {
    const post = await Post.findOne({
        _id: postId,
        authorId: userId,
        deletedAt: null,
    });

    if (!post) return false;

    post.deletedAt = new Date();
    await post.save();

    const deletedPostId = String(post._id);
    // 同步驱逐进程内 FollowingTimelineCache 与 Redis 关注时间线，杜绝删帖后残留幽灵帖
    followingTimelineCache.invalidatePost(post.authorId, deletedPostId);
    InNetworkTimelineService.removePost(post.authorId, deletedPostId).catch(() => undefined);
    recsysStreamPublisher.publishPostDeleted(deletedPostId, post.authorId);
    return true;
}

export const MAX_PINNED_POSTS = 10;

export class PinLimitExceededError extends Error {
    constructor(limit: number = MAX_PINNED_POSTS) {
        super(`最多支持置顶 ${limit} 条动态`);
        this.name = 'PinLimitExceededError';
    }
}

export async function pinPost(postId: string, userId: string): Promise<IPost | null> {
    if (!mongoose.Types.ObjectId.isValid(postId)) return null;
    const postObjectId = new mongoose.Types.ObjectId(postId);

    const post = await Post.findOne({ _id: postObjectId, authorId: userId, deletedAt: null });
    if (!post) return null;

    if (!post.isPinned) {
        const currentPinnedCount = await Post.countDocuments({
            authorId: userId,
            isPinned: true,
            deletedAt: null,
        });
        if (currentPinnedCount >= MAX_PINNED_POSTS) {
            throw new PinLimitExceededError(MAX_PINNED_POSTS);
        }
    }

    post.isPinned = true;
    post.pinnedAt = new Date();
    await post.save();

    return post;
}

export async function unpinPost(postId: string, userId: string): Promise<IPost | null> {
    if (!mongoose.Types.ObjectId.isValid(postId)) return null;
    const postObjectId = new mongoose.Types.ObjectId(postId);

    const post = await Post.findOne({ _id: postObjectId, authorId: userId, deletedAt: null });
    if (!post) return null;

    post.isPinned = false;
    post.pinnedAt = null;
    await post.save();

    return post;
}
