/**
 * Search, trends, recommendations, and notification routes.
 */

import { Router, Request, Response } from 'express';
import { spaceService } from '../../services/spaceService';
import UserAction, { ActionType } from '../../models/UserAction';
import {
    log,
    transformPostToResponse,
    buildTrendInteractionKeywords,
} from './shared';

const router = Router();

// ---------------------------------------------------------------------------
// GET /search — keyword search
// ---------------------------------------------------------------------------

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

        const result = await spaceService.searchPostsPage(query.trim(), limit, safeCursor);
        const transformed = await Promise.all(result.posts.map(transformPostToResponse));
        return res.json({
            posts: transformed,
            totalCount: result.totalCount,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
            query: result.query,
        });
    } catch (error) {
        log.error({ err: error }, '搜索失败');
        return res.status(500).json({ error: '搜索失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /topics/:tag/posts — topic post list
// ---------------------------------------------------------------------------

router.get('/topics/:tag/posts', async (req: Request, res: Response) => {
    try {
        const tag = String(req.params.tag || '').trim();
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;
        const userId = (req as Request & { userId?: string }).userId;

        if (!tag) {
            return res.status(400).json({ error: 'tag is required' });
        }

        const result = await spaceService.getTopicPosts(tag, limit, safeCursor);
        if (userId && !safeCursor) {
            const topicTag = result.tag || tag;
            void UserAction.logActions([{
                userId,
                action: ActionType.CLICK,
                actionText: `#${topicTag} ${result.query}`,
                targetKeywords: buildTrendInteractionKeywords(topicTag, result.query),
                productSurface: 'space_trends',
                timestamp: new Date(),
            }]).catch(() => undefined);
        }
        const transformed = await Promise.all(result.posts.map(transformPostToResponse));
        return res.json({
            tag: result.tag,
            query: result.query,
            totalCount: result.totalCount,
            posts: transformed,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
        });
    } catch (error) {
        log.error({ err: error }, '获取话题动态失败');
        return res.status(500).json({ error: '获取话题动态失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /trends — trending tags
// ---------------------------------------------------------------------------

router.get('/trends', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 6;
        const sinceHours = parseInt(req.query.sinceHours as string);
        const trends = await spaceService.getTrendingTags(
            limit,
            Number.isFinite(sinceHours) && sinceHours > 0 ? sinceHours : undefined,
        );
        return res.json({ trends });
    } catch (error) {
        log.error({ err: error }, '获取热门话题失败');
        return res.status(500).json({ error: '获取热门话题失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /recommend/users — recommended users to follow
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '获取推荐关注失败');
        return res.status(500).json({ error: '获取推荐关注失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /notifications
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '获取通知失败');
        return res.status(500).json({ error: '获取通知失败' });
    }
});

export default router;
