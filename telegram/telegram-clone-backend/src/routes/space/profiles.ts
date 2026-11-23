/**
 * Profile routes — user profiles, avatar/cover upload,
 * and user-specific post listings.
 */

import { Router, Request, Response } from 'express';
import { spaceService } from '../../services/spaceService';
import Contact, { ContactStatus } from '../../models/Contact';
import User from '../../models/User';
import UserSettings from '../../models/UserSettings';
import { SPACE_PUBLIC_UPLOAD_BASE } from '../../controllers/uploadController';
import { normalizeUploadedAvatarFile } from '../../services/media';
import {
    log,
    isValidUuid,
    saveSpaceUpload,
    spaceProfileUpdateSchema,
    transformPostToResponse,
    transformPostsToResponse,
    normalizeSpaceUploadUrl,
    createSingleUploadMiddleware,
} from './shared';

const router = Router();

// 校验封面 URL：仅允许 http/https 或合法的上传相对路径，拒绝 javascript:/data: 等危险协议
function isAllowedCoverUrl(rawUrl: unknown): rawUrl is string {
    if (typeof rawUrl !== 'string') return false;
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.length > 1000) return false;
    if (/[\u0000-\u001f\u007f\\]/.test(trimmed)) return false;

    if (trimmed.startsWith('/api/uploads/') || trimmed.startsWith(`${SPACE_PUBLIC_UPLOAD_BASE}/`)) {
        // 禁止路径穿越或协议相对 URL
        return !trimmed.startsWith('//') && !trimmed.includes('..');
    }

    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// GET /users/:id/posts — user's posts
// ---------------------------------------------------------------------------

router.get('/users/:id/posts', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;

        const posts = await spaceService.getUserPosts(id, limit, safeCursor);
        const transformed = await transformPostsToResponse(posts);
        const nextCursor = posts.length > 0
            ? posts[posts.length - 1].createdAt.toISOString()
            : undefined;
        return res.json({ posts: transformed, hasMore: posts.length >= limit, nextCursor });
    } catch (error) {
        log.error({ err: error }, '获取用户帖子失败');
        return res.status(500).json({ error: '获取用户帖子失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /users/:id/likes — user's liked posts
// ---------------------------------------------------------------------------

router.get('/users/:id/likes', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const viewerId = (req as Request & { userId?: string }).userId;
        const rawLimit = parseInt(req.query.limit as string, 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;
        if (!viewerId) return res.status(401).json({ error: '未授权' });
        if (!isValidUuid(id)) return res.status(400).json({ error: 'invalid_user_id' });

        // 校验目标用户存在并检查屏蔽/隐私约束
        const targetUser = await User.findByPk(id, { attributes: ['id'] });
        if (!targetUser) return res.status(404).json({ error: '用户不存在' });

        if (viewerId !== id) {
            const [blockedByTarget, targetSettings] = await Promise.all([
                Contact.findOne({
                    where: {
                        userId: id,
                        contactId: viewerId,
                        status: ContactStatus.BLOCKED,
                    },
                    attributes: ['id'],
                }),
                UserSettings.findOne({ userId: id }).select('privacySettings').lean(),
            ]);
            const showLikes = (targetSettings?.privacySettings as { showLikes?: boolean } | undefined)?.showLikes;
            if (blockedByTarget || showLikes === false) {
                return res.status(403).json({ error: '无权查看该用户的喜欢列表' });
            }
        }

        const result = await spaceService.getUserLikedPosts(id, viewerId, limit, safeCursor);
        const transformed = await transformPostsToResponse(result.posts);
        return res.json({ posts: transformed, hasMore: result.hasMore, nextCursor: result.nextCursor });
    } catch (error) {
        log.error({ err: error }, '获取用户点赞列表失败');
        return res.status(500).json({ error: '获取用户点赞列表失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /users/:id/profile — user profile
// ---------------------------------------------------------------------------

router.get('/users/:id/profile', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const viewerId = (req as Request & { userId?: string }).userId;

        const profile = await spaceService.getUserProfile(id, viewerId);
        if (!profile) return res.status(404).json({ error: '用户不存在' });

        const { pinnedPost, pinnedPosts, ...rest } = profile;
        const resolvedPinnedList = pinnedPosts && pinnedPosts.length > 0
            ? pinnedPosts
            : pinnedPost
                ? [pinnedPost]
                : [];
        const transformedPinnedPosts = await Promise.all(
            resolvedPinnedList.map((post) => transformPostToResponse(post))
        );

        return res.json({
            profile: {
                ...rest,
                coverUrl: normalizeSpaceUploadUrl(rest.coverUrl) ?? null,
                pinnedPost: transformedPinnedPosts[0] ?? null,
                pinnedPosts: transformedPinnedPosts,
            },
        });
    } catch (error) {
        log.error({ err: error }, '获取用户主页失败');
        return res.status(500).json({ error: '获取用户主页失败' });
    }
});

// ---------------------------------------------------------------------------
// PATCH /users/:id/profile — update space profile fields
// ---------------------------------------------------------------------------

router.patch('/users/:id/profile', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId !== id) return res.status(403).json({ error: '无权限修改他人资料' });

        const parsed = spaceProfileUpdateSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'invalid_profile_update', details: parsed.error.flatten() });
        }

        const updated = await spaceService.updateSpaceProfileFields(id, parsed.data);
        return res.json({ profile: updated });
    } catch (error) {
        log.error({ err: error }, '更新个人资料失败');
        return res.status(500).json({ error: '更新个人资料失败' });
    }
});

// ---------------------------------------------------------------------------
// PUT /users/:id/cover — update cover image
// ---------------------------------------------------------------------------

const handleCoverUpload = createSingleUploadMiddleware('cover', '封面文件上传失败');

router.put('/users/:id/cover', handleCoverUpload, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId !== id) return res.status(403).json({ error: '无权限修改他人封面' });

        const file = (req as Request & { file?: Express.Multer.File }).file;
        let coverUrl: unknown = typeof req.body?.coverUrl === 'string' ? req.body.coverUrl.trim() : null;
        if (file) {
            const stored = await saveSpaceUpload(file);
            coverUrl = stored.url;
        }
        if (!coverUrl) return res.status(400).json({ error: 'coverUrl 或 cover 文件不能为空' });
        if (!isAllowedCoverUrl(coverUrl)) {
            return res.status(400).json({ error: 'invalid_cover_url' });
        }

        const updatedCover = await spaceService.setUserCover(id, coverUrl);
        return res.json({ coverUrl: updatedCover });
    } catch (error) {
        log.error({ err: error }, '更新封面失败');
        return res.status(500).json({ error: '更新封面失败' });
    }
});

// ---------------------------------------------------------------------------
// PUT /users/:id/avatar — update avatar
// ---------------------------------------------------------------------------

const handleAvatarUpload = createSingleUploadMiddleware('avatar', '头像文件上传失败');

router.put('/users/:id/avatar', handleAvatarUpload, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as Request & { userId?: string }).userId;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId !== id) return res.status(403).json({ error: '无权限修改他人头像' });

        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file) return res.status(400).json({ error: 'avatar 文件不能为空' });

        const optimizedFile = await normalizeUploadedAvatarFile(file);
        const stored = await saveSpaceUpload(optimizedFile);
        const user = await User.findByPk(id);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        (user as any).avatarUrl = stored.url;
        await user.save();

        return res.json({ avatarUrl: stored.url });
    } catch (error) {
        log.error({ err: error }, '更新头像失败');
        return res.status(500).json({ error: '更新头像失败' });
    }
});

export default router;
