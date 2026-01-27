/**
 * Space API 路由
 * 空间动态相关接口
 */

import { Router, Request, Response } from 'express';
import type { Express } from 'express';
import { spaceService } from '../services/spaceService';
import { upload } from '../controllers/uploadController';

const router = Router();

/**
 * POST /api/space/posts - 发布帖子
 */
router.post('/posts', upload.array('media'), async (req: Request, res: Response) => {
    try {
        const { content, replyToPostId, quotePostId, quoteContent } = req.body;
        const files = (req as Request & { files?: Express.Multer.File[] }).files;
        const media =
            files?.map((file) => {
                const isVideo = file.mimetype.startsWith('video');
                const isGif = file.mimetype.toLowerCase().includes('gif');
                const type = isVideo ? 'video' : isGif ? 'gif' : 'image';
                return {
                    type,
                    url: `/api/uploads/${file.filename}`,
                    thumbnailUrl: !isVideo ? `/api/uploads/thumbnails/thumb_${file.filename}` : undefined,
                };
            }) || req.body.media;
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

        return res.status(201).json(post);
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
        const cursor = req.query.cursor
            ? new Date(req.query.cursor as string)
            : undefined;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const feed = await spaceService.getFeed(userId, limit, cursor);

        // 转换为前端期望的格式
        const transformedPosts = feed.map(transformFeedCandidateToResponse);

        return res.json({ posts: transformedPosts });
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

        return res.json(post);
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
        const cursor = req.query.cursor
            ? new Date(req.query.cursor as string)
            : undefined;

        const comments = await spaceService.getPostComments(id, limit, cursor);
        return res.json({ comments });
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
        return res.status(201).json(comment);
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
        const cursor = req.query.cursor
            ? new Date(req.query.cursor as string)
            : undefined;

        const posts = await spaceService.getUserPosts(id, limit, cursor);
        return res.json({ posts });
    } catch (error) {
        console.error('获取用户帖子失败:', error);
        return res.status(500).json({ error: '获取用户帖子失败' });
    }
});

export default router;
