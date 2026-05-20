/**
 * News routes — batch import, topics, posts, clusters, and brief.
 */

import { Router, Request, Response } from 'express';
import { spaceService } from '../../services/spaceService';
import { log, transformPostToResponse } from './shared';

const router = Router();

// ---------------------------------------------------------------------------
// POST /posts/batch-news — bulk import news (crawler webhook)
// ---------------------------------------------------------------------------

router.post('/posts/batch-news', async (req: Request, res: Response) => {
    try {
        const { articles } = req.body;
        if (!Array.isArray(articles)) {
            return res.status(400).json({ error: 'articles must be an array' });
        }

        const count = await spaceService.createNewsPosts(articles);
        return res.json({ success: true, count });
    } catch (error) {
        log.error({ err: error }, '导入新闻失败');
        return res.status(500).json({ error: '导入新闻失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /news/topics — hot news topics
// ---------------------------------------------------------------------------

router.get('/news/topics', async (req: Request, res: Response) => {
    try {
        const topics = await spaceService.getNewsClusters();
        return res.json({ topics });
    } catch (error) {
        log.error({ err: error }, '获取新闻话题失败');
        return res.status(500).json({ error: '获取新闻话题失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /news/posts — news list
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '获取新闻列表失败');
        return res.status(500).json({ error: '获取新闻列表失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /news/cluster/:clusterId — posts within a topic cluster
// ---------------------------------------------------------------------------

router.get('/news/cluster/:clusterId', async (req: Request, res: Response) => {
    try {
        const clusterId = parseInt(req.params.clusterId, 10);
        const limit = parseInt(req.query.limit as string) || 20;
        const posts = await spaceService.getNewsClusterPosts(clusterId, limit);
        const transformed = await Promise.all(posts.map(transformPostToResponse));
        return res.json({ posts: transformed });
    } catch (error) {
        log.error({ err: error }, '获取话题新闻失败');
        return res.status(500).json({ error: '获取话题新闻失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /news/brief — homepage news brief
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '获取新闻简报失败');
        return res.status(500).json({ error: '获取新闻简报失败' });
    }
});

export default router;
