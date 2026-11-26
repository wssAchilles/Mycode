/**
 * Social routes — follow/unfollow, block/unblock, mute/unmute.
 */

import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import User from '../../models/User';
import Contact, { ContactStatus } from '../../models/Contact';
import SpaceProfile from '../../models/SpaceProfile';
import { recsysStreamPublisher } from '../../services/recommendation/realtime';
import { broadcastSocialNotification } from '../../services/realtimeEvents';
import {
    log,
    isValidUuid,
    logSignal,
    SignalType,
    TargetType,
} from './shared';

const router = Router();

// ---------------------------------------------------------------------------
// POST /users/:id/follow
// ---------------------------------------------------------------------------

router.post('/users/:id/follow', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId === targetId) return res.status(400).json({ error: '不能关注自己' });

        const [targetUser, actorUser] = await Promise.all([
            User.findByPk(targetId, { attributes: ['id'] }),
            User.findByPk(userId, { attributes: ['id', 'username', 'avatarUrl'] }),
        ]);
        if (!targetUser) return res.status(404).json({ error: '用户不存在' });

        const [contact] = await Contact.findOrCreate({
            where: { userId, contactId: targetId },
            defaults: { userId, contactId: targetId, status: ContactStatus.ACCEPTED },
        });
        if (contact.status !== ContactStatus.ACCEPTED) {
            contact.status = ContactStatus.ACCEPTED;
            await contact.save();
        }

        logSignal({ userId, signalType: SignalType.FOLLOW, targetId, targetType: TargetType.USER });
        recsysStreamPublisher.publishGraphEdgeDelta({ sourceUserId: userId, targetUserId: targetId, edgeOp: 'follow' });
        broadcastSocialNotification({
            recipientId: targetId,
            actor: actorUser
                ? { id: actorUser.id, username: actorUser.username, avatarUrl: actorUser.avatarUrl }
                : { id: userId, username: '未知用户' },
            action: 'follow',
        });
        return res.json({ success: true, followed: true });
    } catch (error) {
        log.error({ err: error }, '关注失败');
        return res.status(500).json({ error: '关注失败' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /users/:id/follow
// ---------------------------------------------------------------------------

router.delete('/users/:id/follow', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!userId) return res.status(401).json({ error: '未授权' });

        await Contact.destroy({ where: { userId, contactId: targetId } });
        logSignal({
            userId,
            signalType: SignalType.UNFOLLOW,
            targetId,
            targetType: TargetType.USER,
            metadata: { negativeWeight: -3 },
        });
        recsysStreamPublisher.publishGraphEdgeDelta({ sourceUserId: userId, targetUserId: targetId, edgeOp: 'unfollow' });
        return res.json({ success: true, followed: false });
    } catch (error) {
        log.error({ err: error }, '取消关注失败');
        return res.status(500).json({ error: '取消关注失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /users/:id/block
// ---------------------------------------------------------------------------

router.post('/users/:id/block', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId === targetId) return res.status(400).json({ error: '不能拉黑自己' });

        const [contact] = await Contact.findOrCreate({
            where: { userId, contactId: targetId },
            defaults: { userId, contactId: targetId, status: ContactStatus.BLOCKED },
        });
        if (contact.status !== ContactStatus.BLOCKED) {
            contact.status = ContactStatus.BLOCKED;
            await contact.save();
        }

        logSignal({
            userId,
            signalType: SignalType.BLOCK,
            targetId,
            targetType: TargetType.USER,
            metadata: { negativeWeight: -10 },
        });
        recsysStreamPublisher.publishGraphEdgeDelta({ sourceUserId: userId, targetUserId: targetId, edgeOp: 'block' });
        return res.json({ success: true, blocked: true });
    } catch (error) {
        log.error({ err: error }, '拉黑失败');
        return res.status(500).json({ error: '拉黑失败' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /users/:id/block
// ---------------------------------------------------------------------------

router.delete('/users/:id/block', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!userId) return res.status(401).json({ error: '未授权' });

        await Contact.destroy({ where: { userId, contactId: targetId } });
        logSignal({ userId, signalType: SignalType.UNBLOCK, targetId, targetType: TargetType.USER });
        recsysStreamPublisher.publishGraphEdgeDelta({ sourceUserId: userId, targetUserId: targetId, edgeOp: 'unblock' });
        return res.json({ success: true, blocked: false });
    } catch (error) {
        log.error({ err: error }, '取消拉黑失败');
        return res.status(500).json({ error: '取消拉黑失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /users/:id/mute
// ---------------------------------------------------------------------------

router.post('/users/:id/mute', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId === targetId) return res.status(400).json({ error: '不能静音自己' });

        const UserSettings = (await import('../../models/UserSettings')).default;
        await UserSettings.addMutedUser(userId, targetId);
        logSignal({
            userId,
            signalType: SignalType.MUTE,
            targetId,
            targetType: TargetType.USER,
            metadata: { negativeWeight: -5 },
        });
        recsysStreamPublisher.publishGraphEdgeDelta({ sourceUserId: userId, targetUserId: targetId, edgeOp: 'mute' });
        return res.json({ success: true, muted: true });
    } catch (error) {
        log.error({ err: error }, '静音失败');
        return res.status(500).json({ error: '静音失败' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /users/:id/mute
// ---------------------------------------------------------------------------

router.delete('/users/:id/mute', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!userId) return res.status(401).json({ error: '未授权' });

        const UserSettings = (await import('../../models/UserSettings')).default;
        await UserSettings.removeMutedUser(userId, targetId);
        logSignal({ userId, signalType: SignalType.UNMUTE, targetId, targetType: TargetType.USER });
        recsysStreamPublisher.publishGraphEdgeDelta({ sourceUserId: userId, targetUserId: targetId, edgeOp: 'unmute' });
        return res.json({ success: true, muted: false });
    } catch (error) {
        log.error({ err: error }, '取消静音失败');
        return res.status(500).json({ error: '取消静音失败' });
    }
});

/**
 * 批量装配关注关系用户列表卡片数据
 */
async function hydrateRelationUsers(
    targetUserIds: string[],
    viewerId?: string,
): Promise<Array<{
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    isOnline?: boolean;
    isFollowing: boolean;
}>> {
    if (targetUserIds.length === 0) return [];
    const [users, profiles, viewerFollows] = await Promise.all([
        User.findAll({
            where: { id: { [Op.in]: targetUserIds } },
            attributes: ['id', 'username', 'avatarUrl', 'isOnline'],
        }),
        SpaceProfile.find({ userId: { $in: targetUserIds } })
            .select('userId displayName bio')
            .lean(),
        viewerId
            ? Contact.findAll({
                where: {
                    userId: viewerId,
                    contactId: { [Op.in]: targetUserIds },
                    status: ContactStatus.ACCEPTED,
                },
                attributes: ['contactId'],
            })
            : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const followedSet = new Set(viewerFollows.map((c) => c.contactId));

    return targetUserIds
        .map((id) => {
            const u = userMap.get(id);
            if (!u) return null;
            const p = profileMap.get(id);
            return {
                id: u.id,
                username: u.username,
                displayName: p?.displayName ?? null,
                avatarUrl: u.avatarUrl ?? null,
                bio: p?.bio ?? null,
                isOnline: Boolean(u.isOnline),
                isFollowing: followedSet.has(u.id),
            };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
}

// ---------------------------------------------------------------------------
// GET /users/:id/followers — list followers
// ---------------------------------------------------------------------------

router.get('/users/:id/followers', async (req: Request, res: Response) => {
    try {
        const viewerId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!isValidUuid(targetId)) {
            return res.status(400).json({ error: 'invalid_user_id' });
        }

        const rawLimit = parseInt(req.query.limit as string, 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 20;
        const rawOffset = parseInt(req.query.offset as string, 10);
        const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

        const { count, rows } = await Contact.findAndCountAll({
            where: { contactId: targetId, status: ContactStatus.ACCEPTED },
            attributes: ['userId'],
            order: [['updatedAt', 'DESC']],
            limit,
            offset,
        });

        const ids = rows.map((row) => row.userId);
        const users = await hydrateRelationUsers(ids, viewerId);
        return res.json({
            users,
            totalCount: count,
            hasMore: offset + rows.length < count,
        });
    } catch (error) {
        log.error({ err: error }, '获取粉丝列表失败');
        return res.status(500).json({ error: '获取粉丝列表失败' });
    }
});

// ---------------------------------------------------------------------------
// GET /users/:id/following — list following users
// ---------------------------------------------------------------------------

router.get('/users/:id/following', async (req: Request, res: Response) => {
    try {
        const viewerId = (req as Request & { userId?: string }).userId;
        const targetId = req.params.id;
        if (!isValidUuid(targetId)) {
            return res.status(400).json({ error: 'invalid_user_id' });
        }

        const rawLimit = parseInt(req.query.limit as string, 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 20;
        const rawOffset = parseInt(req.query.offset as string, 10);
        const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

        const { count, rows } = await Contact.findAndCountAll({
            where: { userId: targetId, status: ContactStatus.ACCEPTED },
            attributes: ['contactId'],
            order: [['updatedAt', 'DESC']],
            limit,
            offset,
        });

        const ids = rows.map((row) => row.contactId);
        const users = await hydrateRelationUsers(ids, viewerId);
        return res.json({
            users,
            totalCount: count,
            hasMore: offset + rows.length < count,
        });
    } catch (error) {
        log.error({ err: error }, '获取关注列表失败');
        return res.status(500).json({ error: '获取关注列表失败' });
    }
});

export default router;
