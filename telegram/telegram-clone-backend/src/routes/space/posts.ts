/**
 * Post CRUD routes — create, read, delete, batch, pin/unpin.
 */

import { Router, Request, Response } from 'express';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { spaceService } from '../../services/spaceService';
import { createFeedCandidate, type FeedCandidate } from '../../services/recommendation';
import { transformFeedCandidateToResponse } from '../../services/recommendation/adapters/spaceFeedResponseAdapter';
import {
    log,
    spaceUpload,
    saveSpaceUpload,
    transformPostToResponse,
    buildFeedResponseAdapterOptions,
} from './shared';

const router = Router();

// ---------------------------------------------------------------------------
// POST /posts — create post
// ---------------------------------------------------------------------------

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
                    return { type, url: stored.url, thumbnailUrl: stored.thumbnailUrl || undefined };
                }),
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
        log.error({ err: error }, '创建帖子失败');
        return res.status(500).json({ error: '创建帖子失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /posts/batch — batch get posts (ML recommendation)
// ---------------------------------------------------------------------------

router.post('/posts/batch', async (req: Request, res: Response) => {
    try {
        const { postIds } = req.body;

        if (!Array.isArray(postIds)) {
            return res.status(400).json({ error: 'postIds must be an array' });
        }

        const posts = await spaceService.getPostsByIds(postIds);
        const candidates: FeedCandidate[] = posts.map((p) => createFeedCandidate(p.toObject()));
        const responseOptions = buildFeedResponseAdapterOptions();
        const transformedPosts = candidates.map((candidate) =>
            transformFeedCandidateToResponse(candidate, responseOptions),
        );

        return res.json({ posts: transformedPosts });
    } catch (error) {
        log.error({ err: error }, '批量获取帖子失败');
        return res.status(500).json({ error: '批量获取帖子失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /posts/:id — get single post
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '获取帖子失败');
        return res.status(500).json({ error: '获取帖子失败' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /posts/:id — delete post
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '删除帖子失败');
        return res.status(500).json({ error: '删除帖子失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /posts/:postId/pin — pin post
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '置顶失败');
        return res.status(500).json({ error: '置顶失败' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /posts/:postId/pin — unpin post
// ---------------------------------------------------------------------------

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
        log.error({ err: error }, '取消置顶失败');
        return res.status(500).json({ error: '取消置顶失败' });
    }
});

export default router;
