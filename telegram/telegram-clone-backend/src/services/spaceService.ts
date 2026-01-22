/**
 * Space 服务层
 * 处理空间动态的业务逻辑
 */

import mongoose from 'mongoose';
import Post, { IPost, MediaType } from '../models/Post';
import Like from '../models/Like';
import Repost, { RepostType } from '../models/Repost';
import Comment, { IComment } from '../models/Comment';
import UserAction, { ActionType } from '../models/UserAction';
import { getSpaceFeedMixer } from './recommendation';

/**
 * 创建帖子参数
 */
export interface CreatePostParams {
    authorId: string;
    content: string;
    media?: { type: 'image' | 'video' | 'gif'; url: string }[];
    replyToPostId?: string;
    quotePostId?: string;
    quoteContent?: string;
}

/**
 * Space 服务类
 */
class SpaceService {
    /**
     * 创建帖子
     */
    async createPost(params: CreatePostParams): Promise<IPost> {
        const { authorId, content, media, replyToPostId, quotePostId, quoteContent } = params;

        // 提取关键词 (用于 MutedKeywordFilter)
        const keywords = this.extractKeywords(content);

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

        return post;
    }

    /**
     * 获取帖子详情
     */
    async getPost(postId: string, userId?: string): Promise<IPost | null> {
        const post = await Post.findOne({
            _id: postId,
            deletedAt: null,
        });

        if (!post) return null;

        // 记录浏览行为
        if (userId) {
            await UserAction.logActions([
                {
                    userId,
                    action: ActionType.CLICK,
                    targetPostId: post._id as mongoose.Types.ObjectId,
                    targetAuthorId: post.authorId,
                },
            ]);

            // 增加浏览数
            await Post.incrementStat(post._id as mongoose.Types.ObjectId, 'viewCount', 1);
        }

        return post;
    }

    /**
     * 删除帖子
     */
    async deletePost(postId: string, userId: string): Promise<boolean> {
        const post = await Post.findOne({
            _id: postId,
            authorId: userId,
            deletedAt: null,
        });

        if (!post) return false;

        post.deletedAt = new Date();
        await post.save();
        return true;
    }

    /**
     * 点赞帖子
     */
    async likePost(postId: string, userId: string): Promise<boolean> {
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

            // 记录行为
            await UserAction.logActions([
                {
                    userId,
                    action: ActionType.LIKE,
                    targetPostId: postObjId,
                    targetAuthorId: post.authorId,
                },
            ]);

            return true;
        } catch (error: unknown) {
            // 重复点赞
            if ((error as { code?: number }).code === 11000) {
                return false;
            }
            throw error;
        }
    }

    /**
     * 取消点赞
     */
    async unlikePost(postId: string, userId: string): Promise<boolean> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        const result = await Like.deleteOne({ userId, postId: postObjId });

        if (result.deletedCount > 0) {
            await Post.incrementStat(postObjId, 'likeCount', -1);
            return true;
        }

        return false;
    }

    /**
     * 转发帖子
     */
    async repostPost(postId: string, userId: string): Promise<IPost | null> {
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

            // 记录行为
            await UserAction.logActions([
                {
                    userId,
                    action: ActionType.REPOST,
                    targetPostId: postObjId,
                    targetAuthorId: post.authorId,
                },
            ]);

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

    /**
     * 取消转发
     */
    async unrepostPost(postId: string, userId: string): Promise<boolean> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        const result = await Repost.deleteOne({
            userId,
            postId: postObjId,
            type: RepostType.REPOST,
        });

        if (result.deletedCount > 0) {
            await Post.incrementStat(postObjId, 'repostCount', -1);
            return true;
        }

        return false;
    }

    /**
     * 发表评论
     */
    async createComment(
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

        // 记录行为
        await UserAction.logActions([
            {
                userId,
                action: ActionType.REPLY,
                targetPostId: postObjId,
                targetAuthorId: post.authorId,
            },
        ]);

        return comment;
    }

    /**
     * 获取帖子评论
     */
    async getPostComments(
        postId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<IComment[]> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        return Comment.getPostComments(postObjId, limit, cursor);
    }

    /**
     * 获取推荐 Feed
     * 使用 SpaceFeedMixer 调用推荐管道
     */
    async getFeed(userId: string, limit: number = 20, cursor?: Date) {
        const mixer = getSpaceFeedMixer({ debug: true });
        return mixer.getFeed(userId, limit, cursor);
    }

    /**
     * 获取用户的帖子列表
     */
    async getUserPosts(
        authorId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<IPost[]> {
        const query: Record<string, unknown> = {
            authorId,
            deletedAt: null,
        };

        if (cursor) {
            query.createdAt = { $lt: cursor };
        }

        return Post.find(query).sort({ createdAt: -1 }).limit(limit);
    }

    /**
     * 提取关键词 (简单实现)
     */
    private extractKeywords(content: string): string[] {
        // 简单实现: 提取 hashtags 和分词
        const hashtags = content.match(/#[\u4e00-\u9fa5\w]+/g) || [];
        return hashtags.map((tag) => tag.slice(1));
    }
}

// 导出单例
export const spaceService = new SpaceService();
