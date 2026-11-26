/**
 * Search, trends, recommendations, and notification routes.
 */

import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { spaceService } from '../../services/spaceService';
import UserAction, { ActionType } from '../../models/UserAction';
import User from '../../models/User';
import SpaceProfile from '../../models/SpaceProfile';
import Contact, { ContactStatus } from '../../models/Contact';
import {
    log,
    transformPostsToResponse,
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
        const transformed = await transformPostsToResponse(result.posts);
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
// GET /users/search — search Space users by username or displayName
// ---------------------------------------------------------------------------

router.get('/users/search', async (req: Request, res: Response) => {
    try {
        const viewerId = (req as Request & { userId?: string }).userId;
        const query = String(req.query.query || req.query.q || '').trim();
        const rawLimit = parseInt(req.query.limit as string, 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 30)) : 12;

        if (!query) {
            return res.json({ users: [] });
        }

        const safePattern = query.replace(/[%_\\]/g, '\\$&');
        const profileMatches = await SpaceProfile.find({
            displayName: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
        })
            .select('userId displayName bio')
            .limit(limit)
            .lean();
        const profileIds = profileMatches.map((p) => p.userId).filter(Boolean);

        const users = await User.findAll({
            where: {
                [Op.or]: [
                    { username: { [Op.iLike]: `%${safePattern}%` } },
                    ...(profileIds.length > 0 ? [{ id: { [Op.in]: profileIds } }] : []),
                ],
            },
            attributes: ['id', 'username', 'avatarUrl', 'isOnline'],
            limit,
        });

        const foundIds = users.map((u) => u.id);
        const [profiles, followedRows] = await Promise.all([
            foundIds.length > 0
                ? SpaceProfile.find({ userId: { $in: foundIds } }).select('userId displayName bio').lean()
                : Promise.resolve([]),
            viewerId && foundIds.length > 0
                ? Contact.findAll({
                    where: {
                        userId: viewerId,
                        contactId: { [Op.in]: foundIds },
                        status: ContactStatus.ACCEPTED,
                    },
                    attributes: ['contactId'],
                })
                : Promise.resolve([]),
        ]);

        const profileMap = new Map(profiles.map((p) => [p.userId, p]));
        const followedSet = new Set(followedRows.map((row) => row.contactId));

        return res.json({
            users: users.map((u) => {
                const prof = profileMap.get(u.id);
                return {
                    id: u.id,
                    username: u.username,
                    displayName: prof?.displayName ?? null,
                    avatarUrl: u.avatarUrl ?? null,
                    bio: prof?.bio ?? null,
                    isOnline: Boolean(u.isOnline),
                    isFollowing: followedSet.has(u.id),
                };
            }),
        });
    } catch (error) {
        log.error({ err: error }, '搜索用户失败');
        return res.status(500).json({ error: '搜索用户失败' });
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
        const transformed = await transformPostsToResponse(result.posts);
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
        const excludeRaw = typeof req.query.excludeIds === 'string' ? req.query.excludeIds : '';
        const excludeIds = excludeRaw
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
            .slice(0, 50);

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const users = await spaceService.getRecommendedUsers(userId, limit, excludeIds);
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
