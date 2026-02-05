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
import User from '../models/User';
import Contact, { ContactStatus } from '../models/Contact';
import SpaceProfile from '../models/SpaceProfile';

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
     * 批量获取用户信息 (用于作者/通知/评论)
     */
    private async getUserMap(userIds: string[]): Promise<Map<string, { id: string; username: string; avatarUrl?: string | null; isOnline?: boolean | null }>> {
        const isUuid = (value: string) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        const uniqueIds = Array.from(new Set(userIds.filter((id) => id && isUuid(id))));
        if (uniqueIds.length === 0) return new Map();

        const users = await User.findAll({
            where: { id: uniqueIds },
            attributes: ['id', 'username', 'avatarUrl', 'isOnline'],
        });

        const map = new Map<string, { id: string; username: string; avatarUrl?: string | null; isOnline?: boolean | null }>();
        users.forEach((u) => {
            map.set(u.id, {
                id: u.id,
                username: u.username,
                avatarUrl: u.avatarUrl,
                isOnline: u.isOnline,
            });
        });
        return map;
    }

    /**
     * 获取当前用户已关注列表 (Space 使用 Contact.accepted 作为关注)
     */
    private async getFollowedSet(userId: string): Promise<Set<string>> {
        try {
            const contacts = await Contact.findAll({
                where: { userId, status: ContactStatus.ACCEPTED },
                attributes: ['contactId'],
            });
            return new Set(contacts.map((c: { contactId: string }) => c.contactId));
        } catch (error) {
            console.error('[SpaceService] Failed to load followed users:', error);
            return new Set();
        }
    }
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
     * 批量创建新闻帖子 (Crawler Hook)
     */
    async createNewsPosts(articles: any[]): Promise<number> {
        let count = 0;
        const NEWS_BOT_ID = 'news_bot_official';

        for (const article of articles) {
            if (!article?.url) continue;

            const title = article.title || '新闻速递';
            const rawContent = article.content || `${title}\n\n${article.summary || ''}`;
            const summary = this.buildNewsSummary(article.summary || rawContent);
            const keywords = this.extractNewsKeywords(`${title}\n${summary}`);
            const createdAt = article.published ? new Date(article.published) : new Date();

            const postData: Partial<IPost> = {
                authorId: NEWS_BOT_ID,
                content: rawContent,
                keywords,
                isNews: true,
                newsMetadata: {
                    title,
                    source: article.source || 'news',
                    url: article.url,
                    clusterId: article.cluster_id,
                    summary,
                },
                media: article.top_image ? [{ type: MediaType.IMAGE, url: article.top_image }] : [],
                createdAt,
            };

            const result = await Post.updateOne(
                { 'newsMetadata.url': article.url },
                { $setOnInsert: postData },
                { upsert: true }
            );

            if ((result as any).upsertedCount > 0) {
                count++;
            }
        }
        return count;
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
     * 获取热门新闻话题聚合
     */
    async getNewsClusters(limit: number = 5): Promise<any[]> {
        // 聚合最近 24 小时的新闻
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        return Post.aggregate([
            {
                $match: {
                    isNews: true,
                    createdAt: { $gte: since },
                    deletedAt: null
                }
            },
            {
                $group: {
                    _id: "$newsMetadata.clusterId",
                    count: { $sum: 1 },
                    representativePost: { $first: "$$ROOT" }, // 取最新的一条作为代表
                    avgScore: { $avg: "$engagementScore" } // 假设有分数
                }
            },
            { $sort: { count: -1 } }, // 按热度排序
            { $limit: limit },
            {
                $project: {
                    clusterId: "$_id",
                    postId: "$representativePost._id",
                    count: 1,
                    title: { $ifNull: ["$representativePost.newsMetadata.title", "$representativePost.content"] },
                    summary: "$representativePost.newsMetadata.summary",
                    source: "$representativePost.newsMetadata.source",
                    coverUrl: {
                        $ifNull: [
                            { $arrayElemAt: ["$representativePost.media.url", 0] },
                            null,
                        ],
                    },
                    latestAt: "$representativePost.createdAt"
                }
            }
        ]);
    }



    /**
     * 批量获取帖子 (保持输入 ID 顺序)
     */
    async getPostsByIds(postIds: string[]): Promise<IPost[]> {
        if (!postIds || postIds.length === 0) return [];

        const objectIds = postIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        const posts = await Post.find({
            _id: { $in: objectIds },
            deletedAt: null,
        });

        // 内存中重新排序 (MongoDB $in 不保证顺序)
        const postMap = new Map();
        posts.forEach((p: any) => {
            const idStr = p._id ? p._id.toString() : p.id;
            if (idStr) postMap.set(idStr.toString(), p);
        });

        return postIds
            .map((id) => postMap.get(id))
            .filter((p): p is IPost => !!p);
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
    async getFeed(
        userId: string,
        limit: number = 20,
        cursor?: Date,
        includeSelf: boolean = false
    ) {
        const mixer = getSpaceFeedMixer({ debug: true });
        const feed = await mixer.getFeed(userId, limit, cursor);

        if (!includeSelf) return feed;

        const selfLimit = Math.min(5, limit);
        const [selfPosts, userMap] = await Promise.all([
            this.getUserPosts(userId, selfLimit, cursor),
            this.getUserMap([userId]),
        ]);

        if (selfPosts.length === 0) return feed;

        const user = userMap.get(userId);
        const selfCandidates = selfPosts.map((post) => ({
            ...(post.toObject ? post.toObject() : post),
            authorUsername: user?.username || 'Unknown',
            authorAvatarUrl: user?.avatarUrl || null,
            isLikedByUser: false,
            isRepostedByUser: false,
        }));

        const toTime = (value: any) => {
            if (!value) return 0;
            if (value instanceof Date) return value.getTime();
            const parsed = new Date(value).getTime();
            return Number.isNaN(parsed) ? 0 : parsed;
        };

        const merged = [...selfCandidates, ...feed].sort((a: any, b: any) => {
            return toTime(b.createdAt) - toTime(a.createdAt);
        });

        const seen = new Set<string>();
        const result: any[] = [];

        for (const item of merged) {
            const id = item.postId?.toString?.() || item._id?.toString?.() || item.id;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            result.push(item);
            if (result.length >= limit) break;
        }

        return result;
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
     * 获取新闻帖子（按时间倒序）
     */
    async getNewsPosts(
        limit: number = 20,
        cursor?: Date,
        days: number = 1
    ): Promise<{ posts: IPost[]; hasMore: boolean; nextCursor?: string }> {
        const since = new Date();
        since.setDate(since.getDate() - Math.max(days, 1));

        const query: Record<string, unknown> = {
            isNews: true,
            deletedAt: null,
            createdAt: { $gte: since },
        };

        if (cursor) {
            query.createdAt = { $gte: since, $lt: cursor };
        }

        const posts = await Post.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const nextCursor = posts.length > 0
            ? new Date(posts[posts.length - 1].createdAt).toISOString()
            : undefined;

        return {
            posts: posts as unknown as IPost[],
            hasMore: posts.length >= limit,
            nextCursor,
        };
    }

    /**
     * 获取新闻简报（Home 顶部模块）
     */
    async getNewsBrief(
        userId: string,
        limit: number = 5,
        sinceHours: number = 24
    ): Promise<any[]> {
        const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
        const poolSize = Math.max(limit * 6, 30);

        const candidates = await Post.find({
            isNews: true,
            deletedAt: null,
            createdAt: { $gte: since },
        })
            .sort({ createdAt: -1 })
            .limit(poolSize)
            .lean();

        if (candidates.length === 0) return [];

        const interest = await this.buildUserInterestKeywords(userId, 200);

        const scored = candidates.map((post: any) => {
            const keywords = (post.keywords as string[])?.length
                ? (post.keywords as string[])
                : this.extractNewsKeywords(`${post.newsMetadata?.title || ''}\n${post.newsMetadata?.summary || post.content || ''}`);
            const similarity = this.computeSimilarity(interest, keywords);
            const recency = this.computeRecencyScore(post.createdAt);
            const sourceBoost = this.sourceWeight(post.newsMetadata?.source);
            const score = similarity * 0.5 + recency * 0.4 + sourceBoost * 0.1;
            return { post, score };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ post }) => ({
                postId: post._id?.toString(),
                title: post.newsMetadata?.title || (post.content || '').split('\n')[0] || '新闻速递',
                summary: post.newsMetadata?.summary || this.buildNewsSummary(post.content || ''),
                source: post.newsMetadata?.source || 'news',
                url: post.newsMetadata?.url,
                coverUrl: post.media?.[0]?.url,
                clusterId: post.newsMetadata?.clusterId,
                createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
            }));
    }

    /**
     * 获取用户点赞过的帖子列表
     */
    async getUserLikedPosts(
        targetUserId: string,
        viewerId?: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<{ posts: any[]; hasMore: boolean; nextCursor?: string }> {
        const likeQuery: Record<string, unknown> = { userId: targetUserId };
        if (cursor) {
            likeQuery.createdAt = { $lt: cursor };
        }

        const likes = await Like.find(likeQuery)
            .sort({ createdAt: -1 })
            .select('postId createdAt')
            .limit(limit)
            .lean();

        const nextCursor = likes.length > 0
            ? new Date(likes[likes.length - 1].createdAt).toISOString()
            : undefined;

        const postIds = likes
            .map((like: { postId?: mongoose.Types.ObjectId }) => like.postId)
            .filter((id: mongoose.Types.ObjectId | undefined): id is mongoose.Types.ObjectId => !!id);

        if (postIds.length === 0) {
            return { posts: [], hasMore: likes.length >= limit, nextCursor };
        }

        const idStrings = postIds.map((id) => id.toString());
        const posts = await this.getPostsByIds(idStrings);

        const objectIds = postIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
        const [likedSet, repostedSet] = viewerId
            ? await Promise.all([
                Like.getLikedPostIds(viewerId, objectIds),
                Repost.getRepostedPostIds(viewerId, objectIds),
            ])
            : [new Set<string>(), new Set<string>()];

        const enriched = posts.map((post) => {
            const raw = post.toObject ? post.toObject() : post;
            const id = raw._id?.toString() || raw.id;
            return {
                ...raw,
                isLikedByUser: viewerId ? likedSet.has(id) : false,
                isRepostedByUser: viewerId ? repostedSet.has(id) : false,
            };
        });

        return {
            posts: enriched,
            hasMore: likes.length >= limit,
            nextCursor,
        };
    }

    /**
     * 获取用户空间主页信息
     */
    async getUserProfile(
        targetUserId: string,
        viewerId?: string
    ): Promise<{
        id: string;
        username: string;
        avatarUrl?: string | null;
        isOnline?: boolean | null;
        lastSeen?: Date | null;
        createdAt?: Date | null;
        coverUrl?: string | null;
        stats: {
            posts: number;
            followers: number;
            following: number;
        };
        isFollowed: boolean;
        pinnedPost?: IPost | null;
    } | null> {
        const user = await User.findByPk(targetUserId, {
            attributes: ['id', 'username', 'avatarUrl', 'isOnline', 'lastSeen', 'createdAt'],
        });

        if (!user) return null;

        const [postsCount, followersCount, followingCount, followRecord, profileDoc, pinnedPost] = await Promise.all([
            Post.countDocuments({ authorId: targetUserId, deletedAt: null }),
            Contact.count({ where: { contactId: targetUserId, status: ContactStatus.ACCEPTED } }),
            Contact.count({ where: { userId: targetUserId, status: ContactStatus.ACCEPTED } }),
            viewerId
                ? Contact.findOne({
                    where: {
                        userId: viewerId,
                        contactId: targetUserId,
                        status: ContactStatus.ACCEPTED,
                    },
                })
                : Promise.resolve(null),
            SpaceProfile.findOne({ userId: targetUserId }).lean(),
            Post.findOne({ authorId: targetUserId, isPinned: true, deletedAt: null }),
        ]);

        return {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl ?? null,
            isOnline: user.isOnline ?? null,
            lastSeen: user.lastSeen ?? null,
            createdAt: user.createdAt ?? null,
            coverUrl: profileDoc?.coverUrl ?? null,
            stats: {
                posts: postsCount,
                followers: followersCount,
                following: followingCount,
            },
            isFollowed: !!followRecord,
            pinnedPost,
        };
    }

    /**
     * 更新用户空间封面
     */
    async setUserCover(userId: string, coverUrl: string | null): Promise<string | null> {
        const updated = await SpaceProfile.findOneAndUpdate(
            { userId },
            { coverUrl },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return updated?.coverUrl ?? null;
    }

    /**
     * 置顶动态
     */
    async pinPost(postId: string, userId: string): Promise<IPost | null> {
        if (!mongoose.Types.ObjectId.isValid(postId)) return null;
        const postObjectId = new mongoose.Types.ObjectId(postId);

        const post = await Post.findOne({ _id: postObjectId, authorId: userId, deletedAt: null });
        if (!post) return null;

        await Post.updateMany({ authorId: userId, isPinned: true }, { $set: { isPinned: false } });
        post.isPinned = true;
        await post.save();

        return post;
    }

    /**
     * 取消置顶动态
     */
    async unpinPost(postId: string, userId: string): Promise<IPost | null> {
        if (!mongoose.Types.ObjectId.isValid(postId)) return null;
        const postObjectId = new mongoose.Types.ObjectId(postId);

        const post = await Post.findOne({ _id: postObjectId, authorId: userId, deletedAt: null });
        if (!post) return null;

        post.isPinned = false;
        await post.save();

        return post;
    }

    /**
     * 搜索帖子 (关键词兜底)
     */
    async searchPosts(
        query: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<IPost[]> {
        const searchQuery: Record<string, unknown> = {
            deletedAt: null,
            $text: { $search: query },
        };

        if (cursor) {
            searchQuery.createdAt = { $lt: cursor };
        }

        return Post.find(searchQuery, { score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
            .limit(limit);
    }

    /**
     * 获取话题下的新闻帖子
     */
    async getNewsClusterPosts(clusterId: number, limit: number = 20): Promise<IPost[]> {
        return Post.find({
            'newsMetadata.clusterId': clusterId,
            isNews: true,
            deletedAt: null
        })
            .sort({ createdAt: -1 })
            .limit(limit);
    }

    /**
     * 清理过期新闻 (7天前)
     */
    async cleanupOldNews(): Promise<number> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const result = await Post.deleteMany({
            isNews: true,
            createdAt: { $lt: sevenDaysAgo }
        });

        console.log(`[Cleanup] Deleted ${result.deletedCount} old news posts.`);
        return result.deletedCount;
    }

    /**
     * 获取热门话题 (基于 hashtags)
     */
    async getTrendingTags(limit: number = 6, sinceHours: number = 24): Promise<Array<{ tag: string; count: number; heat: number }>> {
        const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

        const results = await Post.aggregate([
            {
                $match: {
                    deletedAt: null,
                    createdAt: { $gte: since },
                    keywords: { $exists: true, $ne: [] },
                    isNews: { $ne: true },
                },
            },
            { $unwind: '$keywords' },
            {
                $group: {
                    _id: '$keywords',
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
            { $limit: limit },
        ]);

        const max = results[0]?.count || 1;
        return results.map((r: { _id: string; count: number }) => ({
            tag: r._id,
            count: r.count,
            heat: Math.round((r.count / max) * 100),
        }));
    }

    /**
     * 推荐关注 (基于近期活跃作者)
     */
    async getRecommendedUsers(userId: string, limit: number = 4): Promise<Array<{
        id: string;
        username: string;
        avatarUrl?: string | null;
        isOnline?: boolean | null;
        reason?: string;
        isFollowed: boolean;
        recentPosts: number;
        engagementScore: number;
    }>> {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const followedSet = await this.getFollowedSet(userId);

        const authorStats = await Post.aggregate([
            {
                $match: {
                    deletedAt: null,
                    createdAt: { $gte: since },
                    authorId: { $ne: userId },
                },
            },
            {
                $group: {
                    _id: '$authorId',
                    recentPosts: { $sum: 1 },
                    engagementScore: {
                        $sum: {
                            $add: [
                                '$stats.likeCount',
                                { $multiply: ['$stats.commentCount', 2] },
                                { $multiply: ['$stats.repostCount', 3] },
                            ],
                        },
                    },
                },
            },
            { $sort: { engagementScore: -1, recentPosts: -1 } },
            { $limit: limit * 4 },
        ]);

        const candidateIds = authorStats
            .map((a: { _id: string }) => a._id)
            .filter((id: string) => id && !followedSet.has(id));

        if (candidateIds.length === 0) return [];

        const userMap = await this.getUserMap(candidateIds);
        const statsMap = new Map<string, { recentPosts: number; engagementScore: number }>();
        authorStats.forEach((s: { _id: string; recentPosts: number; engagementScore: number }) => {
            statsMap.set(s._id, { recentPosts: s.recentPosts, engagementScore: s.engagementScore });
        });

        const results: Array<{
            id: string;
            username: string;
            avatarUrl?: string | null;
            isOnline?: boolean | null;
            reason?: string;
            isFollowed: boolean;
            recentPosts: number;
            engagementScore: number;
        }> = [];

        for (const id of candidateIds) {
            const user = userMap.get(id);
            if (!user) continue;
            const stats = statsMap.get(id) || { recentPosts: 0, engagementScore: 0 };
            results.push({
                id,
                username: user.username,
                avatarUrl: user.avatarUrl,
                isOnline: user.isOnline,
                reason: stats.recentPosts >= 3 ? '近期活跃' : '可能感兴趣',
                isFollowed: followedSet.has(id),
                recentPosts: stats.recentPosts,
                engagementScore: stats.engagementScore,
            });
            if (results.length >= limit) break;
        }

        return results;
    }

    /**
     * 获取通知 (基于用户互动行为)
     */
    async getNotifications(
        userId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<{ items: Array<any>; hasMore: boolean; nextCursor?: string }> {
        const query: Record<string, unknown> = {
            targetAuthorId: userId,
            userId: { $ne: userId },
            action: { $in: [ActionType.LIKE, ActionType.REPLY, ActionType.REPOST, ActionType.QUOTE] },
        };
        if (cursor) {
            query.timestamp = { $lt: cursor };
        }

        const actions = await UserAction.find(query)
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();

        const actorIds = Array.from(new Set(actions.map((a: any) => a.userId)));
        const postIds = Array.from(new Set(actions.map((a: any) => a.targetPostId).filter(Boolean)));

        const [userMap, posts] = await Promise.all([
            this.getUserMap(actorIds),
            postIds.length > 0
                ? Post.find({ _id: { $in: postIds }, deletedAt: null })
                    .select('content')
                    .lean()
                : Promise.resolve([]),
        ]);

        const postMap = new Map<string, { content: string }>();
        (posts as any[]).forEach((p) => {
            if (p._id) postMap.set(p._id.toString(), { content: p.content });
        });

        const items = actions.map((a: any) => {
            const actor = userMap.get(a.userId);
            const post = a.targetPostId ? postMap.get(a.targetPostId.toString()) : null;
            const snippet = post?.content ? post.content.slice(0, 80) : '';
            return {
                id: a._id?.toString(),
                type: a.action,
                actor: actor
                    ? {
                        id: actor.id,
                        username: actor.username,
                        avatarUrl: actor.avatarUrl,
                        isOnline: actor.isOnline,
                    }
                    : { id: a.userId, username: 'Unknown' },
                postId: a.targetPostId?.toString(),
                postSnippet: snippet,
                createdAt: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp,
            };
        });

        return {
            items,
            hasMore: actions.length >= limit,
            nextCursor: actions.length > 0
                ? (actions[actions.length - 1].timestamp as Date).toISOString()
                : undefined,
        };
    }

    /**
     * 获取评论 + 作者信息
     */
    async getCommentsWithAuthors(
        postId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<{ comments: Array<any>; hasMore: boolean; nextCursor?: string }> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        const comments = await Comment.getPostComments(postObjId, limit, cursor);

        const userIds = comments.map((c) => c.userId);
        const userMap = await this.getUserMap(userIds);

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

    /**
     * 提取关键词 (简单实现)
     */
    private extractKeywords(content: string): string[] {
        // 简单实现: 提取 hashtags 和分词
        const hashtags = content.match(/#[\u4e00-\u9fa5\w]+/g) || [];
        return hashtags.map((tag) => tag.slice(1));
    }

    private buildNewsSummary(text: string): string {
        const cleaned = (text || '').replace(/\s+/g, ' ').trim();
        if (cleaned.length <= 160) return cleaned;
        return `${cleaned.slice(0, 160)}...`;
    }

    private extractNewsKeywords(text: string): string[] {
        const cleaned = (text || '').replace(/https?:\/\/\S+/g, ' ');
        const english = cleaned.match(/[a-zA-Z]{3,}/g) || [];
        const numbers = cleaned.match(/\b\d{2,}\b/g) || [];
        const chinese = cleaned.match(/[\u4e00-\u9fff]{2,}/g) || [];
        const tokens = [...english, ...numbers, ...chinese]
            .map((t) => t.toLowerCase())
            .slice(0, 30);
        return Array.from(new Set(tokens));
    }

    private computeSimilarity(
        interest: Map<string, number>,
        candidateKeywords: string[]
    ): number {
        if (interest.size === 0 || candidateKeywords.length === 0) return 0;
        let score = 0;
        let norm = 0;
        for (const val of interest.values()) norm += val;
        for (const kw of candidateKeywords) {
            if (interest.has(kw)) score += interest.get(kw) || 0;
        }
        return score / Math.max(norm, 1);
    }

    private computeRecencyScore(createdAt: Date | string): number {
        const ts = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
        const hours = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
        return Math.exp(-hours / 12);
    }

    private sourceWeight(source?: string): number {
        const key = (source || '').toLowerCase();
        if (key.includes('reuters')) return 1.0;
        if (key.includes('bbc')) return 0.9;
        if (key.includes('cnn')) return 0.85;
        return 0.7;
    }

    private async buildUserInterestKeywords(userId: string, limit: number = 200): Promise<Map<string, number>> {
        const since = new Date();
        since.setDate(since.getDate() - 30);

        const actions = await UserAction.find({
            userId,
            timestamp: { $gte: since },
            action: { $in: [ActionType.LIKE, ActionType.REPLY, ActionType.REPOST, ActionType.CLICK, ActionType.DWELL] },
            targetPostId: { $exists: true, $ne: null },
        })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();

        const postIds = actions
            .map((a: any) => a.targetPostId)
            .filter(Boolean);

        if (postIds.length === 0) return new Map();

        const posts = await Post.find({ _id: { $in: postIds }, deletedAt: null })
            .select('keywords content')
            .lean();

        const postMap = new Map(posts.map((p: any) => [p._id.toString(), p]));
        const weights = new Map<string, number>();

        const actionWeight = (action: string, dwellTime?: number) => {
            if (action === ActionType.LIKE) return 3;
            if (action === ActionType.REPOST || action === ActionType.REPLY) return 2.5;
            if (action === ActionType.CLICK) return 1.5;
            if (action === ActionType.DWELL) return 1 + Math.min((dwellTime || 0) / 10000, 1);
            return 1;
        };

        for (const action of actions) {
            const post = postMap.get(action.targetPostId?.toString?.() || '');
            if (!post) continue;
            const kws = (post.keywords as string[])?.length
                ? (post.keywords as string[])
                : this.extractNewsKeywords(post.content || '');
            const weight = actionWeight(action.action, action.dwellTimeMs);
            for (const kw of kws) {
                weights.set(kw, (weights.get(kw) || 0) + weight);
            }
        }

        return weights;
    }
}

// 导出单例
export const spaceService = new SpaceService();
