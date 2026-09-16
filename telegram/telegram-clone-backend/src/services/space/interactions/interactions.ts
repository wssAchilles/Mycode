/**
 * Space interactions domain (like/repost/comment).
 * Extracted from spaceService with identical control flow.
 */
import mongoose from 'mongoose';
import Post, { IPost } from '../../../models/Post';
import Like from '../../../models/Like';
import Repost, { RepostType } from '../../../models/Repost';
import Comment, { IComment } from '../../../models/Comment';
import { recordRecommendationEvent } from '../../recommendation/events';
import { refreshPostFeatureSnapshots } from '../internal/postFeatureSnapshots';
import { getUserMap } from '../internal/userMap';

export async function likePost(postId: string, userId: string): Promise<boolean> {
    const postObjId = new mongoose.Types.ObjectId(postId);
    const post = await Post.findById(postObjId);

    if (!post) return false;

    try {
        await Like.create({
            userId,
            postId: postObjId,
            authorId: post.authorId,
        });

        // 增加点赞数
        await Post.incrementStat(postObjId, 'likeCount', 1);

        await recordRecommendationEvent({
            userId,
            eventType: 'like',
            targetId: postObjId,
            targetAuthorId: post.authorId,
            productSurface: 'space_feed',
        });

        refreshPostFeatureSnapshots([postObjId]);

        return true;
    } catch (error: unknown) {
        // 重复点赞
        if ((error as { code?: number }).code === 11000) {
            return false;
        }
        throw error;
    }
}

export async function unlikePost(postId: string, userId: string): Promise<boolean> {
    const postObjId = new mongoose.Types.ObjectId(postId);
    const result = await Like.deleteOne({ userId, postId: postObjId });

    if (result.deletedCount > 0) {
        await Post.incrementStat(postObjId, 'likeCount', -1);
        refreshPostFeatureSnapshots([postObjId]);
        return true;
    }

    return false;
}

export async function repostPost(postId: string, userId: string): Promise<IPost | null> {
    const postObjId = new mongoose.Types.ObjectId(postId);
    const post = await Post.findById(postObjId);

    if (!post) return null;

    try {
        await Repost.create({
            userId,
            postId: postObjId,
            type: RepostType.REPOST,
        });

        // 增加转发数
        await Post.incrementStat(postObjId, 'repostCount', 1);

        await recordRecommendationEvent({
            userId,
            eventType: 'repost',
            targetId: postObjId,
            targetAuthorId: post.authorId,
            productSurface: 'space_feed',
        });

        refreshPostFeatureSnapshots([postObjId]);

        // 返回更新后的帖子
        const updated = await Post.findById(postObjId);
        return updated;
    } catch (error: unknown) {
        if ((error as { code?: number }).code === 11000) {
            return null;
        }
        throw error;
    }
}

export async function unrepostPost(postId: string, userId: string): Promise<boolean> {
    const postObjId = new mongoose.Types.ObjectId(postId);
    const result = await Repost.deleteOne({
        userId,
        postId: postObjId,
        type: RepostType.REPOST,
    });

    if (result.deletedCount > 0) {
        await Post.incrementStat(postObjId, 'repostCount', -1);
        refreshPostFeatureSnapshots([postObjId]);
        return true;
    }

    return false;
}

export async function createComment(
    postId: string,
    userId: string,
    content: string,
    parentId?: string
): Promise<IComment> {
    const postObjId = new mongoose.Types.ObjectId(postId);
    const post = await Post.findById(postObjId);

    if (!post) {
        throw new Error('帖子不存在');
    }

    const comment = new Comment({
        userId,
        postId: postObjId,
        content,
        parentId: parentId ? new mongoose.Types.ObjectId(parentId) : undefined,
    });

    await comment.save();

    // 增加评论数
    await Post.incrementStat(postObjId, 'commentCount', 1);

    await recordRecommendationEvent({
        userId,
        eventType: 'reply',
        targetId: postObjId,
        targetCommentId: comment._id as mongoose.Types.ObjectId,
        targetAuthorId: post.authorId,
        actionText: String(content || '').slice(0, 280),
        productSurface: 'space_feed',
    });

    refreshPostFeatureSnapshots([postObjId]);

    return comment;
}

export async function getPostComments(
    postId: string,
    limit: number = 20,
    cursor?: Date
): Promise<IComment[]> {
    const postObjId = new mongoose.Types.ObjectId(postId);
    return Comment.getPostComments(postObjId, limit, cursor);
}

export async function getCommentsWithAuthors(
    postId: string,
    limit: number = 20,
    cursor?: Date
): Promise<{ comments: Array<any>; hasMore: boolean; nextCursor?: string }> {
    const postObjId = new mongoose.Types.ObjectId(postId);
    const comments = await Comment.getPostComments(postObjId, limit, cursor);

    const userIds = comments.map((c) => c.userId);
    const userMap = await getUserMap(userIds);

    const transformed = comments.map((c) => {
        const author = userMap.get(c.userId);
        return {
            id: c._id?.toString(),
            postId: c.postId?.toString(),
            content: c.content,
            author: author
                ? {
                    id: author.id,
                    username: author.username,
                    avatarUrl: author.avatarUrl,
                    isOnline: author.isOnline,
                }
                : { id: c.userId, username: 'Unknown' },
            likeCount: c.likeCount || 0,
            parentId: c.parentId?.toString(),
            replyToUserId: c.replyToUserId,
            createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
        };
    });

    return {
        comments: transformed,
        hasMore: comments.length >= limit,
        nextCursor: comments.length > 0
            ? comments[comments.length - 1].createdAt.toISOString()
            : undefined,
    };
}
