/**
 * Space API 路由
 * 空间动态相关接口
 */

import { Router, Request, Response } from 'express';
import { spaceService } from '../services/spaceService';

const router = Router();

/**
 * POST /api/space/posts - 发布帖子
 */
router.post('/posts', async (req: Request, res: Response) => {
    try {
        const { content, media, replyToPostId, quotePostId, quoteContent } = req.body;
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
        return res.json({ posts: feed });
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

        const success = await spaceService.repostPost(id, userId);
        return res.json({ success, reposted: success });
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
