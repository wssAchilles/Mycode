/**
 * Space API 路由
 * 空间动态相关接口
 */

import { Router, Request, Response, NextFunction } from 'express';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { spaceService } from '../services/spaceService';
import { spaceUpload, SPACE_PUBLIC_UPLOAD_BASE, saveSpaceUpload } from '../controllers/uploadController';
import { getRelatedPostIds } from '../services/recommendation/utils/relatedPostIds';
import { createFeedCandidate, type FeedCandidate } from '../services/recommendation';
import User from '../models/User';
import Contact, { ContactStatus } from '../models/Contact';
import type { IPost, IPostMedia } from '../models/Post';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const FEED_STATE_WINDOW = 200;
const NEWS_BOT_AVATAR_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#3b82f6'/><stop offset='100%' stop-color='#22c55e'/></linearGradient></defs><rect width='96' height='96' rx='24' fill='#0b1220'/><rect x='12' y='12' width='72' height='72' rx='18' fill='url(#g)'/><path d='M29 36h38v6H29zm0 12h30v6H29zm0 12h22v6H29z' fill='white'/><circle cx='69' cy='60' r='7' fill='white'/></svg>";
const NEWS_BOT_AVATAR_URL = `data:image/svg+xml;utf8,${encodeURIComponent(NEWS_BOT_AVATAR_SVG)}`;

const zBoolish = z.preprocess((v) => {
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true') return true;
        if (s === 'false') return false;
    }
    return v;
}, z.boolean());

const zTrimmedNullable = (max: number) =>
    z
        .preprocess((v) => {
            if (v === undefined) return undefined;
            if (v === null) return null;
            const s = String(v).trim();
            return s ? s : null;
        }, z.union([z.string().max(max), z.null()]))
        .optional();

const spaceProfileUpdateSchema = z
    .object({
        displayName: zTrimmedNullable(50),
        bio: zTrimmedNullable(200),
        location: zTrimmedNullable(60),
        website: zTrimmedNullable(120),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'no_profile_fields' });

const spaceFeedRequestSchema = z
    .object({
        limit: z
            .preprocess((v) => (typeof v === 'string' ? parseInt(v, 10) : v), z.number().int().min(1).max(50))
            .optional(),
        cursor: z
            .preprocess((v) => (v == null || v === '' ? undefined : String(v)), z.string())
            .optional(),
        request_id: z.string().min(1).max(128).optional(),
        includeSelf: zBoolish.optional(),
        in_network_only: zBoolish.optional(),
        seen_ids: z.array(z.string()).max(FEED_STATE_WINDOW).optional(),
        served_ids: z.array(z.string()).max(FEED_STATE_WINDOW).optional(),
        is_bottom_request: zBoolish.optional(),
        country_code: z.string().optional(),
        language_code: z.string().optional(),
        client_app_id: z
            .preprocess((v) => (typeof v === 'string' ? parseInt(v, 10) : v), z.number().int().min(0).max(1_000_000))
            .optional(),
    })
    .passthrough();

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
type PostResponseInput = {
    _id?: unknown;
    id?: string;
    originalPostId?: unknown;
    replyToPostId?: unknown;
    conversationId?: unknown;
    authorId?: string;
    content?: string;
    media?: IPostMedia[];
    createdAt?: Date | string;
    stats?: Partial<IPost['stats']>;
    isLikedByUser?: boolean;
    isRepostedByUser?: boolean;
    isPinned?: boolean;
    isNews?: boolean;
    newsMetadata?: IPost['newsMetadata'];
};

async function transformPostToResponse(post: PostResponseInput) {
    const postId =
        typeof post.id === 'string' && post.id
            ? post.id
            : post._id != null
                ? String(post._id)
                : undefined;

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
            avatarUrl: NEWS_BOT_AVATAR_URL,
        }
        : { username: 'Unknown', avatarUrl: null };

    const media = (post.media || []).map((m: IPostMedia) => ({
        ...m,
        url: normalizeSpaceUploadUrl(m.url),
        thumbnailUrl: normalizeSpaceUploadUrl(m.thumbnailUrl),
    }));

    return {
        _id: postId,
        id: postId,
        originalPostId: post.originalPostId != null ? String(post.originalPostId) : undefined,
        replyToPostId: post.replyToPostId != null ? String(post.replyToPostId) : undefined,
        conversationId: post.conversationId != null ? String(post.conversationId) : undefined,
        authorId: post.authorId,
        authorUsername: author?.username || fallbackAuthor.username,
        authorAvatarUrl: author?.avatarUrl || fallbackAuthor.avatarUrl,
        content: post.content,
        media,
        createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
        likeCount: post.stats?.likeCount ?? 0,
        commentCount: post.stats?.commentCount ?? 0,
        repostCount: post.stats?.repostCount ?? 0,
        viewCount: post.stats?.viewCount ?? 0,
        isLiked: post.isLikedByUser ?? false,
        isReposted: post.isRepostedByUser ?? false,
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
        const candidates: FeedCandidate[] = posts.map((p) => createFeedCandidate(p.toObject()));
        const transformedPosts = candidates.map(transformFeedCandidateToResponse);

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
function transformFeedCandidateToResponse(candidate: FeedCandidate) {
    const isNews = Boolean(candidate.isNews);
    const exposeScoreBreakdown =
        String(process.env.RECSYS_DEBUG_SCORE_BREAKDOWN || '').toLowerCase() === 'true';

    return {
        _id: candidate.postId.toString(),
        id: candidate.postId.toString(),
        originalPostId: candidate.originalPostId?.toString(),
        replyToPostId: candidate.replyToPostId?.toString(),
        conversationId: candidate.conversationId?.toString(),
        authorId: candidate.authorId,
        authorUsername: isNews ? 'NewsBot' : (candidate.authorUsername || 'Unknown'),
        authorAvatarUrl: isNews ? NEWS_BOT_AVATAR_URL : (candidate.authorAvatarUrl || null),
        content: candidate.content,
        media: candidate.media || [],
        createdAt: candidate.createdAt.toISOString(),
        likeCount: candidate.likeCount ?? 0,
        commentCount: candidate.commentCount ?? 0,
        repostCount: candidate.repostCount ?? 0,
        viewCount: candidate.viewCount ?? 0,
        isLiked: candidate.isLikedByUser || false,
        isReposted: candidate.isRepostedByUser || false,
        isPinned: candidate.isPinned || false,
        isNews,
        newsMetadata: candidate.newsMetadata ?? undefined,
        // 推荐系统附加信息 (可选，用于调试)
        _recommendationScore: candidate.score,
        _inNetwork: candidate.inNetwork,
        _recallSource: candidate.recallSource,
        ...(exposeScoreBreakdown
            ? {
                _scoreBreakdown: candidate._scoreBreakdown,
                _pipelineScore: candidate._pipelineScore,
            }
            : {}),
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
        const inNetworkOnly = String(req.query.in_network_only || '').trim().toLowerCase() === 'true';

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const feed = await spaceService.getFeed(userId, limit, safeCursor, includeSelf, { inNetworkOnly });

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
 * POST /api/space/feed - 获取推荐 Feed（工业级：支持客户端携带 seen_ids/served_ids）
 *
 * Request body:
 * {
 *   "limit": 20,
 *   "cursor": "2026-02-06T00:00:00.000Z",
 *   "includeSelf": true,
 *   "seen_ids": ["..."],
 *   "served_ids": ["..."],
 *   "is_bottom_request": true
 * }
 */
router.post('/feed', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const parsed = spaceFeedRequestSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'invalid_feed_request',
                details: parsed.error.flatten(),
            });
        }

        const limit = parsed.data.limit ?? 20;
        const cursorRaw = parsed.data.cursor;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;
        const includeSelf = parsed.data.includeSelf ?? true;
        const inNetworkOnly = parsed.data.in_network_only ?? false;
        const requestId = parsed.data.request_id ?? uuidv4();

        const seenIds = (parsed.data.seen_ids ?? []).map(String).filter(Boolean).slice(-FEED_STATE_WINDOW);
        const servedIds = (parsed.data.served_ids ?? []).map(String).filter(Boolean).slice(-FEED_STATE_WINDOW);
        const isBottomRequest = parsed.data.is_bottom_request ?? Boolean(safeCursor);
        const countryCode = parsed.data.country_code;
        const languageCode = parsed.data.language_code;
        const clientAppId = parsed.data.client_app_id;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const feed = await spaceService.getFeed(
            userId,
            limit,
            safeCursor,
            includeSelf,
            { requestId, seenIds, servedIds, isBottomRequest, countryCode, languageCode, clientAppId, inNetworkOnly }
        );

        const transformedPosts = feed.map(transformFeedCandidateToResponse);
        // Industrial-grade: use "related IDs" so the client can dedup across retweets/replies/conversations.
        const idsDelta: string[] = [];
        const servedSeen = new Set<string>();
        for (const c of feed) {
            const related = getRelatedPostIds(c);
            for (const id of related) {
                const s = String(id);
                if (!s || servedSeen.has(s)) continue;
                servedSeen.add(s);
                idsDelta.push(s);
            }
        }

        const lastCreatedAt = feed.length > 0
            ? feed[feed.length - 1].createdAt
            : undefined;
        const nextCursor = lastCreatedAt instanceof Date
            ? lastCreatedAt.toISOString()
            : typeof lastCreatedAt === 'string'
                ? new Date(lastCreatedAt).toISOString()
                : undefined;

        return res.json({
            request_id: requestId,
            posts: transformedPosts,
            hasMore: feed.length >= limit,
            nextCursor,
            served_ids_delta: idsDelta,
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
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'invalid_post_id' });
        }
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
        const transformed = await transformPostToResponse(repostedPost);
        return res.json(transformed);
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
const handleCoverUpload = (req: Request, res: Response, next: NextFunction) => {
    // Wrap multer to return JSON errors (otherwise Express may return an HTML 500)
    spaceUpload.single('cover')(req, res, (err: any) => {
        if (err) {
            const message = err?.message || '封面文件上传失败';
            return res.status(400).json({ error: message });
        }
        next();
    });
};

router.put('/users/:id/cover', handleCoverUpload, async (req: Request, res: Response) => {
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
 * PATCH /api/space/users/:id/profile - 更新 Space 个性化资料（displayName/bio/location/website）
 */
router.patch('/users/:id/profile', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }
        if (userId !== id) {
            return res.status(403).json({ error: '无权限修改他人资料' });
        }

        const parsed = spaceProfileUpdateSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'invalid_profile_update',
                details: parsed.error.flatten(),
            });
        }

        const updated = await spaceService.updateSpaceProfileFields(id, parsed.data);
        return res.json({ profile: updated });
    } catch (error) {
        console.error('更新个人资料失败:', error);
        return res.status(500).json({ error: '更新个人资料失败' });
    }
});

/**
 * PUT /api/space/users/:id/avatar - 更新头像
 */
const handleAvatarUpload = (req: Request, res: Response, next: NextFunction) => {
    spaceUpload.single('avatar')(req, res, (err: any) => {
        if (err) {
            const message = err?.message || '头像文件上传失败';
            return res.status(400).json({ error: message });
        }
        next();
    });
};

router.put('/users/:id/avatar', handleAvatarUpload, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }
        if (userId !== id) {
            return res.status(403).json({ error: '无权限修改他人头像' });
        }

        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file) {
            return res.status(400).json({ error: 'avatar 文件不能为空' });
        }

        const stored = await saveSpaceUpload(file);
        const avatarUrl = stored.url;

        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        (user as any).avatarUrl = avatarUrl;
        await user.save();

        return res.json({ avatarUrl });
    } catch (error) {
        console.error('更新头像失败:', error);
        return res.status(500).json({ error: '更新头像失败' });
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
