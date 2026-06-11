/**
 * Interaction routes — like/unlike, repost/unrepost, not-interested, hide,
 * report, and comments.
 */

import { Router, Request, Response } from 'express';
import { spaceService } from '../../services/spaceService';
import User from '../../models/User';
import {
    log,
    transformPostToResponse,
    extractPostKeywords,
    logPostAction,
    logAction,
    logSignal,
    ActionType,
    SignalType,
    TargetType,
    ProductSurface,
} from './shared';

const router = Router();

// ---------------------------------------------------------------------------
// POST /posts/:id/like
// ---------------------------------------------------------------------------

router.post('/posts/:id/like', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const success = await spaceService.likePost(id, userId);
        if (success) {
            logPostAction(userId, id, ActionType.LIKE);
        logSignal({ userId, signalType: SignalType.FAVORITE, targetId: id, targetType: TargetType.POST });
        }
        return res.json({ success, liked: success });
    } catch (error) {
        log.error({ err: error }, '点赞失败');
        return res.status(500).json({ error: '点赞失败' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /posts/:id/like
// ---------------------------------------------------------------------------

router.delete('/posts/:id/like', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const success = await spaceService.unlikePost(id, userId);
        if (success) {
            logSignal({
                userId,
                signalType: SignalType.UNFAVORITE,
                targetId: id,
                targetType: TargetType.POST,
                metadata: { negativeWeight: -0.5 },
            });
        }
        return res.json({ success, liked: false });
    } catch (error) {
        log.error({ err: error }, '取消点赞失败');
        return res.status(500).json({ error: '取消点赞失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /posts/:id/repost
// ---------------------------------------------------------------------------

router.post('/posts/:id/repost', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const repostedPost = await spaceService.repostPost(id, userId);
        if (!repostedPost) return res.status(400).json({ error: '转发失败或已转发' });

        logPostAction(userId, id, ActionType.REPOST);
        logSignal({ userId, signalType: SignalType.RETWEET, targetId: id, targetType: TargetType.POST });

        const transformed = await transformPostToResponse(repostedPost);
        return res.json(transformed);
    } catch (error) {
        log.error({ err: error }, '转发失败');
        return res.status(500).json({ error: '转发失败' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /posts/:id/repost
// ---------------------------------------------------------------------------

router.delete('/posts/:id/repost', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const success = await spaceService.unrepostPost(id, userId);
        if (success) {
            logSignal({
                userId,
                signalType: SignalType.UNRETWEET,
                targetId: id,
                targetType: TargetType.POST,
                metadata: { negativeWeight: -1 },
            });
        }
        return res.json({ success, reposted: false });
    } catch (error) {
        log.error({ err: error }, '取消转发失败');
        return res.status(500).json({ error: '取消转发失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /posts/:postId/not-interested
// ---------------------------------------------------------------------------

router.post('/posts/:postId/not-interested', async (req: Request, res: Response) => {
    try {
        const { postId } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const post = await spaceService.getPost(postId, userId);
        logAction({
            userId,
            action: ActionType.DISMISS,
            targetPostId: postId as any,
            targetAuthorId: post?.authorId,
            targetKeywords: extractPostKeywords(post),
            productSurface: 'home_feed',
            timestamp: new Date(),
        });
        logSignal({
            userId,
            signalType: SignalType.DISMISS_POST,
            targetId: postId,
            targetType: TargetType.POST,
            targetAuthorId: post?.authorId,
            metadata: {
                reason: 'not_interested',
                targetKeywords: extractPostKeywords(post),
                negativeWeight: -2,
            },
        });

        return res.status(201).json({ success: true });
    } catch (error) {
        log.error({ err: error }, '记录不感兴趣失败');
        return res.status(500).json({ error: '操作失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /posts/:postId/hide
// ---------------------------------------------------------------------------

router.post('/posts/:postId/hide', async (req: Request, res: Response) => {
    try {
        const { postId } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const post = await spaceService.getPost(postId, userId);
        logAction({
            userId,
            action: ActionType.HIDE,
            targetPostId: postId as any,
            targetAuthorId: post?.authorId,
            targetKeywords: extractPostKeywords(post),
            productSurface: 'home_feed',
            timestamp: new Date(),
        });
        logSignal({
            userId,
            signalType: SignalType.HIDE_POST,
            targetId: postId,
            targetType: TargetType.POST,
            targetAuthorId: post?.authorId,
            metadata: {
                reason: 'hide_post',
                targetKeywords: extractPostKeywords(post),
                negativeWeight: -4,
            },
        });

        return res.status(201).json({ success: true });
    } catch (error) {
        log.error({ err: error }, '记录隐藏失败');
        return res.status(500).json({ error: '操作失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /posts/:postId/report
// ---------------------------------------------------------------------------

router.post('/posts/:postId/report', async (req: Request, res: Response) => {
    try {
        const { postId } = req.params;
        const { reason } = req.body;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const validReasons = ['spam', 'harassment', 'misinformation', 'violence', 'other'];
        if (!reason || !validReasons.includes(reason)) {
            return res.status(400).json({ error: '无效的举报理由' });
        }

        const post = await spaceService.getPost(postId, userId);
        logAction({
            userId,
            action: ActionType.REPORT,
            targetPostId: postId as any,
            targetAuthorId: post?.authorId,
            actionText: reason,
            productSurface: 'home_feed',
            timestamp: new Date(),
        });
        logSignal({
            userId,
            signalType: SignalType.REPORT,
            targetId: postId,
            targetType: TargetType.POST,
            targetAuthorId: post?.authorId,
            metadata: {
                reason,
                targetKeywords: extractPostKeywords(post),
                negativeWeight: -8,
            },
        });

        return res.status(201).json({ success: true });
    } catch (error) {
        log.error({ err: error }, '举报失败');
        return res.status(500).json({ error: '操作失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /posts/:id/comments
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '获取评论失败');
        return res.status(500).json({ error: '获取评论失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /posts/:id/comments
// ---------------------------------------------------------------------------

router.post('/posts/:id/comments', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { content, parentId } = req.body;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (!content) return res.status(400).json({ error: '评论内容不能为空' });

        const comment = await spaceService.createComment(id, userId, content, parentId);

        logPostAction(userId, id, ActionType.REPLY);
        logSignal({ userId, signalType: SignalType.REPLY, targetId: id, targetType: TargetType.POST });

        const author = await User.findByPk(userId, { attributes: ['id', 'username', 'avatarUrl'] });

        return res.status(201).json({
            id: comment._id?.toString(),
            postId: comment.postId?.toString(),
            content: comment.content,
            author: author
                ? { id: author.id, username: author.username, avatarUrl: author.avatarUrl }
                : { id: userId, username: 'Unknown' },
            likeCount: comment.likeCount || 0,
            parentId: comment.parentId?.toString(),
            replyToUserId: comment.replyToUserId,
            createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
        });
    } catch (error) {
        log.error({ err: error }, '发表评论失败');
        return res.status(500).json({ error: '发表评论失败' });
    }
});

export default router;
