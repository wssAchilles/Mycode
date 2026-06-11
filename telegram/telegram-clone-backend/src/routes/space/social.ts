/**
 * Social routes — follow/unfollow, block/unblock, mute/unmute.
 */

import { Router, Request, Response } from 'express';
import User from '../../models/User';
import Contact, { ContactStatus } from '../../models/Contact';
import {
    log,
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

        const targetUser = await User.findByPk(targetId, { attributes: ['id'] });
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
        return res.json({ success: true, muted: false });
    } catch (error) {
        log.error({ err: error }, '取消静音失败');
        return res.status(500).json({ error: '取消静音失败' });
    }
});

export default router;
