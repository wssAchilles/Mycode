/**
 * Space API 路由
 * 空间动态相关接口
 */

import { Router, Request, Response } from 'express';
import type { Express } from 'express';
import { spaceService } from '../services/spaceService';
import { spaceUpload, SPACE_PUBLIC_UPLOAD_BASE, saveSpaceUpload } from '../controllers/uploadController';
import User from '../models/User';
import Contact, { ContactStatus } from '../models/Contact';

const router = Router();

// Disable caching for dynamic Space APIs
router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

const normalizeSpaceUploadUrl = (value?: string | null) => {
    if (!value) return value || null;
    const normalizePath = (pathValue: string) => {
        if (pathValue.startsWith('/api/uploads/thumbnails/')) {
            const filename = pathValue.replace('/api/uploads/thumbnails/', '').replace(/^\/+/, '');
            return `${SPACE_PUBLIC_UPLOAD_BASE}/thumbnails/${filename}`;
        }
        if (pathValue.startsWith('/api/uploads/')) {
            const filename = pathValue.replace('/api/uploads/', '').replace(/^\/+/, '');
            return `${SPACE_PUBLIC_UPLOAD_BASE}/${filename}`;
        }
        return pathValue;
    };
    if (value.startsWith('/api/uploads/')) {
        return normalizePath(value);
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
        try {
            const parsed = new URL(value);
            return `${parsed.origin}${normalizePath(parsed.pathname)}`;
        } catch {
            return value;
        }
    }
    return value;
};

/**
 * 将 Post 模型转换为前端期望的 PostResponse (补齐作者信息)
 */
async function transformPostToResponse(post: any) {

    const isUuid = (value: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const author = post?.authorId && isUuid(post.authorId)
        ? await User.findByPk(post.authorId, {
            attributes: ['id', 'username', 'avatarUrl'],
        })
        : null;
    const isNews = post?.isNews || post?.authorId === 'news_bot_official';
    const fallbackAuthor = isNews
        ? {
            username: 'NewsBot',
            avatarUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/News_icon.svg',
        }
        : { username: 'Unknown', avatarUrl: null };

    const media = Array.isArray(post.media)
        ? post.media.map((m: any) => ({
            ...m,
            url: normalizeSpaceUploadUrl(m.url),
            thumbnailUrl: normalizeSpaceUploadUrl(m.thumbnailUrl),
        }))
        : [];

    return {
        _id: post._id?.toString(),
        id: post._id?.toString(),
        authorId: post.authorId,
        authorUsername: author?.username || fallbackAuthor.username,
        authorAvatarUrl: author?.avatarUrl || fallbackAuthor.avatarUrl,
        content: post.content,
        media,
        createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
        likeCount: post.stats?.likeCount ?? post.likeCount ?? 0,
        commentCount: post.stats?.commentCount ?? post.commentCount ?? 0,
        repostCount: post.stats?.repostCount ?? post.repostCount ?? 0,
        viewCount: post.stats?.viewCount ?? post.viewCount ?? 0,
        isLiked: post.isLikedByUser ?? post.isLiked ?? false,
        isReposted: post.isRepostedByUser ?? post.isReposted ?? false,
        isPinned: post.isPinned ?? false,
        isNews: post.isNews ?? false,
        newsMetadata: post.newsMetadata ?? undefined,
    };
}

/**
 * POST /api/space/posts - 发布帖子
 */
router.post('/posts', spaceUpload.array('media'), async (req: Request, res: Response) => {
    try {
        const { content, replyToPostId, quotePostId, quoteContent } = req.body;
        const files = (req as Request & { files?: Express.Multer.File[] }).files;
    const media = files
            ? await Promise.all(
                files.map(async (file) => {
                    const isVideo = file.mimetype.startsWith('video');
                    const isGif = file.mimetype.toLowerCase().includes('gif');
                    const type = isVideo ? 'video' : isGif ? 'gif' : 'image';
                    const stored = await saveSpaceUpload(file);
                    return {
                        type,
                        url: stored.url,
                        thumbnailUrl: stored.thumbnailUrl || undefined,
                    };
                })
            )
            : req.body.media;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const post = await spaceService.createPost({
            authorId: userId,
            content,
            media,
            replyToPostId,
            quotePostId,
            quoteContent,
        });

        const transformed = await transformPostToResponse(post);
        return res.status(201).json(transformed);
    } catch (error) {
        console.error('创建帖子失败:', error);
        return res.status(500).json({ error: '创建帖子失败' });
    }
});

/**
 * POST /api/space/posts/batch - 批量获取帖子 (用于 ML 推荐系统补全)
 */
router.post('/posts/batch', async (req: Request, res: Response) => {
    try {
        const { postIds } = req.body;

        if (!Array.isArray(postIds)) {
            return res.status(400).json({ error: 'postIds must be an array' });
        }

        const posts = await spaceService.getPostsByIds(postIds);
        const transformedPosts = posts.map(transformFeedCandidateToResponse);

        return res.json({ posts: transformedPosts });
    } catch (error) {
        console.error('批量获取帖子失败:', error);
        return res.status(500).json({ error: '批量获取帖子失败' });
    }
});

/**
 * POST /api/space/posts/batch-news - 批量导入新闻 (Crawler Webhook)
 */
router.post('/posts/batch-news', async (req: Request, res: Response) => {
    try {
        const { articles } = req.body;
        if (!Array.isArray(articles)) {
            return res.status(400).json({ error: 'articles must be an array' });
        }

        const count = await spaceService.createNewsPosts(articles);
        return res.json({ success: true, count });
    } catch (error) {
        console.error('导入新闻失败:', error);
        return res.status(500).json({ error: '导入新闻失败' });
    }
});


/**
 * GET /api/space/news/topics - 获取热门新闻话题
 */
router.get('/news/topics', async (req: Request, res: Response) => {
    try {
        const topics = await spaceService.getNewsClusters();
        return res.json({ topics });
    } catch (error) {
        console.error('获取新闻话题失败:', error);
        return res.status(500).json({ error: '获取新闻话题失败' });
    }
});

/**
 * GET /api/space/news/posts - 获取新闻列表
 */
router.get('/news/posts', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;
        const days = parseInt(req.query.days as string) || 1;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;

        const result = await spaceService.getNewsPosts(limit, safeCursor, days);
        const transformed = await Promise.all(result.posts.map(transformPostToResponse));

        return res.json({
            posts: transformed,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
        });
    } catch (error) {
        console.error('获取新闻列表失败:', error);
        return res.status(500).json({ error: '获取新闻列表失败' });
    }
});

/**
 * GET /api/space/news/cluster/:clusterId - 获取话题内新闻
 */
router.get('/news/cluster/:clusterId', async (req: Request, res: Response) => {
    try {
        const clusterId = parseInt(req.params.clusterId, 10);
        const limit = parseInt(req.query.limit as string) || 20;
        const posts = await spaceService.getNewsClusterPosts(clusterId, limit);
        const transformed = await Promise.all(posts.map(transformPostToResponse));
        return res.json({ posts: transformed });
    } catch (error) {
        console.error('获取话题新闻失败:', error);
        return res.status(500).json({ error: '获取话题新闻失败' });
    }
});

/**
 * GET /api/space/news/brief - 首页新闻简报
 */
router.get('/news/brief', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const limit = parseInt(req.query.limit as string) || 5;
        const sinceHours = parseInt(req.query.sinceHours as string) || 24;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const items = await spaceService.getNewsBrief(userId, limit, sinceHours);
        return res.json({ items });
    } catch (error) {
        console.error('获取新闻简报失败:', error);
        return res.status(500).json({ error: '获取新闻简报失败' });
    }
});

/**
 * 将 FeedCandidate 转换为前端期望的 PostResponse 格式
 */
function transformFeedCandidateToResponse(candidate: any) {
    return {
        _id: candidate.postId?.toString() || candidate._id?.toString(),
        id: candidate.postId?.toString() || candidate._id?.toString(),
        authorId: candidate.authorId,
        authorUsername: candidate.isNews ? 'NewsBot' : (candidate.authorUsername || 'Unknown'),
        authorAvatarUrl: candidate.isNews ? 'https://upload.wikimedia.org/wikipedia/commons/e/ef/News_icon.svg' : (candidate.authorAvatarUrl || null),
        content: candidate.content,
        media: candidate.media || [],
        createdAt: candidate.createdAt instanceof Date
            ? candidate.createdAt.toISOString()
            : candidate.createdAt,
        likeCount: candidate.likeCount || candidate.stats?.likeCount || 0,
        commentCount: candidate.commentCount || candidate.stats?.commentCount || 0,
        repostCount: candidate.repostCount || candidate.stats?.repostCount || 0,
        viewCount: candidate.viewCount || candidate.stats?.viewCount || 0,
        isLiked: candidate.isLikedByUser || false,
        isReposted: candidate.isRepostedByUser || false,
        isPinned: candidate.isPinned || false,
        // 推荐系统附加信息 (可选，用于调试)
        _recommendationScore: candidate.score,
        _inNetwork: candidate.inNetwork,
    };
}

/**
 * GET /api/space/feed - 获取推荐 Feed
 */
router.get('/feed', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;
        const includeSelf = req.query.includeSelf !== 'false';

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const feed = await spaceService.getFeed(userId, limit, safeCursor, includeSelf);

        // 转换为前端期望的格式
        const transformedPosts = feed.map(transformFeedCandidateToResponse);

        const lastCreatedAt = feed.length > 0
            ? feed[feed.length - 1].createdAt
            : undefined;
        const nextCursor = lastCreatedAt instanceof Date
            ? lastCreatedAt.toISOString()
            : typeof lastCreatedAt === 'string'
                ? new Date(lastCreatedAt).toISOString()
                : undefined;

        return res.json({
            posts: transformedPosts,
            hasMore: feed.length >= limit,
            nextCursor,
        });
    } catch (error) {
        console.error('获取 Feed 失败:', error);
        return res.status(500).json({ error: '获取 Feed 失败' });
    }
});

/**
 * GET /api/space/posts/:id - 获取帖子详情
 */
router.get('/posts/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        const post = await spaceService.getPost(id, userId);
        if (!post) {
            return res.status(404).json({ error: '帖子不存在' });
        }

        const transformed = await transformPostToResponse(post);
        return res.json(transformed);
    } catch (error) {
        console.error('获取帖子失败:', error);
        return res.status(500).json({ error: '获取帖子失败' });
    }
});

/**
 * DELETE /api/space/posts/:id - 删除帖子
 */
router.delete('/posts/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const success = await spaceService.deletePost(id, userId);
        if (!success) {
            return res.status(404).json({ error: '帖子不存在或无权删除' });
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('删除帖子失败:', error);
        return res.status(500).json({ error: '删除帖子失败' });
    }
});

/**
 * POST /api/space/posts/:id/like - 点赞
 */
router.post('/posts/:id/like', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const success = await spaceService.likePost(id, userId);
        return res.json({ success, liked: success });
    } catch (error) {
        console.error('点赞失败:', error);
        return res.status(500).json({ error: '点赞失败' });
    }
});

/**
 * DELETE /api/space/posts/:id/like - 取消点赞
 */
router.delete('/posts/:id/like', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const success = await spaceService.unlikePost(id, userId);
        return res.json({ success, liked: false });
    } catch (error) {
        console.error('取消点赞失败:', error);
        return res.status(500).json({ error: '取消点赞失败' });
    }
});

/**
 * POST /api/space/posts/:id/repost - 转发
 */
router.post('/posts/:id/repost', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const repostedPost = await spaceService.repostPost(id, userId);
        if (!repostedPost) {
            return res.status(400).json({ error: '转发失败或已转发' });
        }
        return res.json(transformFeedCandidateToResponse(repostedPost));
    } catch (error) {
        console.error('转发失败:', error);
        return res.status(500).json({ error: '转发失败' });
    }
});

/**
 * DELETE /api/space/posts/:id/repost - 取消转发
 */
router.delete('/posts/:id/repost', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const success = await spaceService.unrepostPost(id, userId);
        return res.json({ success, reposted: false });
    } catch (error) {
        console.error('取消转发失败:', error);
        return res.status(500).json({ error: '取消转发失败' });
    }
});

/**
 * GET /api/space/posts/:id/comments - 获取评论
 */
router.get('/posts/:id/comments', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;

        const result = await spaceService.getCommentsWithAuthors(id, limit, safeCursor);
        return res.json(result);
    } catch (error) {
        console.error('获取评论失败:', error);
        return res.status(500).json({ error: '获取评论失败' });
    }
});

/**
 * POST /api/space/posts/:id/comments - 发表评论
 */
router.post('/posts/:id/comments', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { content, parentId } = req.body;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        if (!content) {
            return res.status(400).json({ error: '评论内容不能为空' });
        }

        const comment = await spaceService.createComment(id, userId, content, parentId);
        const author = await User.findByPk(userId, {
            attributes: ['id', 'username', 'avatarUrl'],
        });

        return res.status(201).json({
            id: comment._id?.toString(),
            postId: comment.postId?.toString(),
            content: comment.content,
            author: author
                ? {
                    id: author.id,
                    username: author.username,
                    avatarUrl: author.avatarUrl,
                }
                : { id: userId, username: 'Unknown' },
            likeCount: comment.likeCount || 0,
            parentId: comment.parentId?.toString(),
            replyToUserId: comment.replyToUserId,
            createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
        });
    } catch (error) {
        console.error('发表评论失败:', error);
        return res.status(500).json({ error: '发表评论失败' });
    }
});

/**
 * GET /api/space/users/:id/posts - 获取用户帖子
 */
router.get('/users/:id/posts', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;

        const posts = await spaceService.getUserPosts(id, limit, safeCursor);
        const transformed = await Promise.all(posts.map(transformPostToResponse));
        const nextCursor = posts.length > 0
            ? posts[posts.length - 1].createdAt.toISOString()
            : undefined;
        return res.json({
            posts: transformed,
            hasMore: posts.length >= limit,
            nextCursor,
        });
    } catch (error) {
        console.error('获取用户帖子失败:', error);
        return res.status(500).json({ error: '获取用户帖子失败' });
    }
});

/**
 * GET /api/space/users/:id/likes - 获取用户点赞过的帖子
 */
router.get('/users/:id/likes', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const viewerId = (req as Request & { userId?: string }).userId;
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;

        if (!viewerId) {
            return res.status(401).json({ error: '未授权' });
        }

        const result = await spaceService.getUserLikedPosts(id, viewerId, limit, safeCursor);
        const transformed = await Promise.all(result.posts.map(transformPostToResponse));

        return res.json({
            posts: transformed,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
        });
    } catch (error) {
        console.error('获取用户点赞列表失败:', error);
        return res.status(500).json({ error: '获取用户点赞列表失败' });
    }
});

/**
 * GET /api/space/users/:id/profile - 获取用户空间主页信息
 */
router.get('/users/:id/profile', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const viewerId = (req as Request & { userId?: string }).userId;

        const profile = await spaceService.getUserProfile(id, viewerId);
        if (!profile) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const { pinnedPost, ...rest } = profile;
        const transformedPinned = pinnedPost ? await transformPostToResponse(pinnedPost) : null;

        return res.json({
            profile: {
                ...rest,
                coverUrl: normalizeSpaceUploadUrl(rest.coverUrl) ?? null,
                pinnedPost: transformedPinned,
            },
        });
    } catch (error) {
        console.error('获取用户主页失败:', error);
        return res.status(500).json({ error: '获取用户主页失败' });
    }
});

/**
 * PUT /api/space/users/:id/cover - 更新空间封面
 */
router.put('/users/:id/cover', spaceUpload.single('cover'), async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        if (userId !== id) {
            return res.status(403).json({ error: '无权限修改他人封面' });
        }

        const file = (req as Request & { file?: Express.Multer.File }).file;
        let coverUrl = req.body.coverUrl || null;
        if (file) {
            const stored = await saveSpaceUpload(file);
            coverUrl = stored.url;
        }

        if (!coverUrl) {
            return res.status(400).json({ error: 'coverUrl 或 cover 文件不能为空' });
        }

        const updatedCover = await spaceService.setUserCover(id, coverUrl);
        return res.json({ coverUrl: updatedCover });
    } catch (error) {
        console.error('更新封面失败:', error);
        return res.status(500).json({ error: '更新封面失败' });
    }
});

/**
 * POST /api/space/posts/:postId/pin - 置顶动态
 */
router.post('/posts/:postId/pin', async (req: Request, res: Response) => {
    try {
        const { postId } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const post = await spaceService.pinPost(postId, userId);
        if (!post) {
            return res.status(404).json({ error: '动态不存在或无权限' });
        }

        const transformed = await transformPostToResponse(post);
        return res.json({ post: transformed });
    } catch (error) {
        console.error('置顶失败:', error);
        return res.status(500).json({ error: '置顶失败' });
    }
});

/**
 * DELETE /api/space/posts/:postId/pin - 取消置顶
 */
router.delete('/posts/:postId/pin', async (req: Request, res: Response) => {
    try {
        const { postId } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const post = await spaceService.unpinPost(postId, userId);
        if (!post) {
            return res.status(404).json({ error: '动态不存在或无权限' });
        }

        const transformed = await transformPostToResponse(post);
        return res.json({ post: transformed });
    } catch (error) {
        console.error('取消置顶失败:', error);
        return res.status(500).json({ error: '取消置顶失败' });
    }
});

/**
 * GET /api/space/search - 关键词搜索 (服务端兜底)
 */
router.get('/search', async (req: Request, res: Response) => {
    try {
        const query = (req.query.query as string) || (req.query.q as string) || '';
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;

        if (!query.trim()) {
            return res.status(400).json({ error: 'query is required' });
        }

        const posts = await spaceService.searchPosts(query.trim(), limit, safeCursor);
        const transformed = await Promise.all(posts.map(transformPostToResponse));
        const nextCursor = posts.length > 0
            ? posts[posts.length - 1].createdAt.toISOString()
            : undefined;
        return res.json({
            posts: transformed,
            hasMore: posts.length >= limit,
            nextCursor,
        });
    } catch (error) {
        console.error('搜索失败:', error);
        return res.status(500).json({ error: '搜索失败' });
    }
});

/**
 * GET /api/space/trends - 获取热门话题
 */
router.get('/trends', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 6;
        const trends = await spaceService.getTrendingTags(limit);
        return res.json({ trends });
    } catch (error) {
        console.error('获取热门话题失败:', error);
        return res.status(500).json({ error: '获取热门话题失败' });
    }
});

/**
 * GET /api/space/recommend/users - 推荐关注用户
 */
router.get('/recommend/users', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const limit = parseInt(req.query.limit as string) || 4;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const users = await spaceService.getRecommendedUsers(userId, limit);
        return res.json({ users });
    } catch (error) {
        console.error('获取推荐关注失败:', error);
        return res.status(500).json({ error: '获取推荐关注失败' });
    }
});

/**
 * POST /api/space/users/:id/follow - 关注用户
 */
router.post('/users/:id/follow', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        if (userId === targetId) {
            return res.status(400).json({ error: '不能关注自己' });
        }

        const targetUser = await User.findByPk(targetId, { attributes: ['id'] });
        if (!targetUser) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const [contact] = await Contact.findOrCreate({
            where: { userId, contactId: targetId },
            defaults: { userId, contactId: targetId, status: ContactStatus.ACCEPTED },
        });

        if (contact.status !== ContactStatus.ACCEPTED) {
            contact.status = ContactStatus.ACCEPTED;
            await contact.save();
        }

        return res.json({ success: true, followed: true });
    } catch (error) {
        console.error('关注失败:', error);
        return res.status(500).json({ error: '关注失败' });
    }
});

/**
 * DELETE /api/space/users/:id/follow - 取消关注
 */
router.delete('/users/:id/follow', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        await Contact.destroy({
            where: { userId, contactId: targetId },
        });

        return res.json({ success: true, followed: false });
    } catch (error) {
        console.error('取消关注失败:', error);
        return res.status(500).json({ error: '取消关注失败' });
    }
});

/**
 * GET /api/space/notifications - 获取通知
 */
router.get('/notifications', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const result = await spaceService.getNotifications(userId, limit, safeCursor);
        return res.json(result);
    } catch (error) {
        console.error('获取通知失败:', error);
        return res.status(500).json({ error: '获取通知失败' });
    }
});

export default router;
