/**
 * Sync Routes - 消息同步 API
 * 实现 getDifference 等消息同步接口
 */
import { Router, Request, Response, NextFunction } from 'express';
import { updateService } from '../services/updateService';
import Message from '../models/Message';
import { sendSuccess, errors } from '../utils/apiResponse';
import { authenticateToken } from '../middleware/authMiddleware';
import { chatRuntimeMetrics } from '../services/chatRuntimeMetrics';

const router = Router();

// 所有同步路由需要认证
router.use(authenticateToken);

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_LIMIT = 200;
const SYNC_PROTOCOL_VERSION = 2;
const SYNC_WATERMARK_FIELD = 'updateId';

function setSyncConsistencyHeaders(res: Response) {
    res.set('X-Sync-Protocol-Version', String(SYNC_PROTOCOL_VERSION));
    res.set('X-Sync-Watermark-Field', SYNC_WATERMARK_FIELD);
    res.set('Cache-Control', 'no-store');
}

function parseSyncLimit(raw: unknown): number {
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SYNC_LIMIT;
    return Math.min(n, MAX_SYNC_LIMIT);
}

function parsePts(raw: unknown): number | null {
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
}

function normalizeLastUpdateId(fromPts: number, serverPts: number, updates: any[], lastUpdateId: number): number {
    let next = Number.isFinite(lastUpdateId) ? lastUpdateId : fromPts;
    if (updates.length) {
        const maxUpdateId = updates.reduce((acc: number, u: any) => {
            const id = Number(u?.updateId);
            return Number.isFinite(id) ? Math.max(acc, id) : acc;
        }, fromPts);
        next = Math.max(next, maxUpdateId);
    }
    next = Math.max(next, fromPts);
    next = Math.min(next, serverPts);
    return next;
}

function sanitizeUpdates(updates: any[], fromPts: number, limit: number): any[] {
    if (!Array.isArray(updates) || updates.length === 0) return [];

    const seen = new Set<number>();
    const out: any[] = [];

    for (const item of updates) {
        const updateId = Number(item?.updateId);
        if (!Number.isFinite(updateId)) continue;
        if (updateId <= fromPts) continue;
        if (seen.has(updateId)) continue;
        seen.add(updateId);
        out.push(item);
    }

    out.sort((a, b) => Number(a.updateId) - Number(b.updateId));
    if (out.length <= limit) return out;
    return out.slice(0, limit);
}

async function loadMessagesForUpdates(updates: any[]): Promise<any[]> {
    const messageIds: string[] = [];
    const seen = new Set<string>();
    for (const u of updates) {
        const id = u?.messageId ? String(u.messageId) : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        messageIds.push(id);
    }
    if (!messageIds.length) return [];
    const docs = await Message.find({ _id: { $in: messageIds } }).lean();
    const byId = new Map(docs.map((doc: any) => [String(doc?._id || ''), doc]));
    return messageIds.map((id) => byId.get(id)).filter(Boolean);
}

function buildSyncState(pts: number) {
    return {
        pts,
        updateId: pts,
        date: Math.floor(Date.now() / 1000),
        protocolVersion: SYNC_PROTOCOL_VERSION,
        watermarkField: SYNC_WATERMARK_FIELD,
    };
}

async function buildSyncPayload(
    fromPts: number,
    serverPts: number,
    rawUpdates: any[],
    lastUpdateId: number,
    limit: number,
) {
    const updates = sanitizeUpdates(rawUpdates, fromPts, limit);
    const normalizedLastUpdateId = normalizeLastUpdateId(fromPts, serverPts, updates, lastUpdateId);
    const messages = await loadMessagesForUpdates(updates);

    return {
        updates,
        messages,
        state: buildSyncState(normalizedLastUpdateId),
        isLatest: normalizedLastUpdateId >= serverPts,
        fromPts,
        serverPts,
        protocolVersion: SYNC_PROTOCOL_VERSION,
        watermarkField: SYNC_WATERMARK_FIELD,
    };
}

/**
 * GET /api/sync/state
 * 获取当前用户的同步状态
 */
router.get('/state', async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    chatRuntimeMetrics.increment('sync.state.requests');
    try {
        setSyncConsistencyHeaders(res);
        const userId = (req as any).user.id;
        const updateId = await updateService.getUpdateId(userId);
        chatRuntimeMetrics.observeValue('sync.state.latestPts', updateId);
        chatRuntimeMetrics.observeDuration('sync.state.latencyMs', Date.now() - startedAt);
        chatRuntimeMetrics.increment('sync.state.success');

        return sendSuccess(res, {
            pts: updateId,
            updateId,
            date: Math.floor(Date.now() / 1000),
            protocolVersion: SYNC_PROTOCOL_VERSION,
            watermarkField: SYNC_WATERMARK_FIELD,
        });
    } catch (err) {
        chatRuntimeMetrics.increment('sync.state.errors');
        chatRuntimeMetrics.observeDuration('sync.state.latencyMs', Date.now() - startedAt);
        next(err);
    }
});

/**
 * POST /api/sync/difference
 * 获取缺失的消息 (Gap Recovery)
 */
router.post('/difference', async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    chatRuntimeMetrics.increment('sync.difference.requests');
    try {
        setSyncConsistencyHeaders(res);
        const userId = (req as any).user.id;
        const pts = parsePts((req.body as any)?.pts);
        const limit = parseSyncLimit((req.body as any)?.limit);
        chatRuntimeMetrics.observeValue('sync.difference.limit', limit);

        if (pts === null) {
            chatRuntimeMetrics.increment('sync.difference.badRequest');
            chatRuntimeMetrics.observeDuration('sync.difference.latencyMs', Date.now() - startedAt);
            return errors.badRequest(res, '缺少 pts 参数');
        }

        // 获取服务端当前 updateId
        const serverPts = await updateService.getUpdateId(userId);
        const lag = Math.max(0, serverPts - pts);
        chatRuntimeMetrics.observeValue('sync.difference.serverPts', serverPts);
        chatRuntimeMetrics.observeValue('sync.difference.clientPts', pts);
        chatRuntimeMetrics.observeValue('sync.difference.lagPts', lag);

        if (pts >= serverPts) {
            // 客户端已是最新状态
            chatRuntimeMetrics.increment('sync.difference.latest');
            chatRuntimeMetrics.observeDuration('sync.difference.latencyMs', Date.now() - startedAt);
            return sendSuccess(res, {
                updates: [],
                messages: [],
                state: buildSyncState(serverPts),
                isLatest: true,
                fromPts: pts,
                serverPts,
                protocolVersion: SYNC_PROTOCOL_VERSION,
                watermarkField: SYNC_WATERMARK_FIELD,
            });
        }

        const { updates, lastUpdateId } = await updateService.getUpdates(userId, pts, limit);
        const payload = await buildSyncPayload(pts, serverPts, updates, lastUpdateId, limit);
        chatRuntimeMetrics.increment(payload.isLatest ? 'sync.difference.latest' : 'sync.difference.delta');
        chatRuntimeMetrics.observeValue('sync.difference.updates', payload.updates.length);
        chatRuntimeMetrics.observeValue('sync.difference.messages', payload.messages.length);
        chatRuntimeMetrics.observeDuration('sync.difference.latencyMs', Date.now() - startedAt);
        chatRuntimeMetrics.increment('sync.difference.success');
        return sendSuccess(res, payload);
    } catch (err) {
        chatRuntimeMetrics.increment('sync.difference.errors');
        chatRuntimeMetrics.observeDuration('sync.difference.latencyMs', Date.now() - startedAt);
        next(err);
    }
});

/**
 * POST /api/sync/ack
 * 确认收到消息 (更新客户端 PTS)
 */
router.post('/ack', async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    chatRuntimeMetrics.increment('sync.ack.requests');
    try {
        setSyncConsistencyHeaders(res);
        const userId = (req as any).user.id;
        const { pts } = req.body;
        void userId;

        if (typeof pts !== 'number') {
            chatRuntimeMetrics.increment('sync.ack.badRequest');
            chatRuntimeMetrics.observeDuration('sync.ack.latencyMs', Date.now() - startedAt);
            return errors.badRequest(res, '缺少 pts 参数');
        }
        chatRuntimeMetrics.observeValue('sync.ack.pts', pts);
        chatRuntimeMetrics.observeDuration('sync.ack.latencyMs', Date.now() - startedAt);
        chatRuntimeMetrics.increment('sync.ack.success');

        // 记录客户端确认的 PTS (可用于离线消息推送优化)
        // 这里可以存储到 Redis 或数据库中
        // await redis.set(`ack:${userId}`, pts);

        return sendSuccess(res, {
            acknowledged: true,
            pts,
            protocolVersion: SYNC_PROTOCOL_VERSION,
            watermarkField: SYNC_WATERMARK_FIELD,
        });
    } catch (err) {
        chatRuntimeMetrics.increment('sync.ack.errors');
        chatRuntimeMetrics.observeDuration('sync.ack.latencyMs', Date.now() - startedAt);
        next(err);
    }
});

/**
 * GET /api/sync/updates
 * 长轮询获取更新 (备用方案，WebSocket 不可用时使用)
 */
router.get('/updates', async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    chatRuntimeMetrics.increment('sync.updates.requests');
    try {
        setSyncConsistencyHeaders(res);
        const userId = (req as any).user.id;
        const parsedPts = parsePts(req.query.pts);
        if (parsedPts === null) {
            chatRuntimeMetrics.increment('sync.updates.badRequest');
            chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
            return errors.badRequest(res, 'pts 参数非法');
        }
        const clientPts = parsedPts;
        const timeout = Math.min(parseInt(req.query.timeout as string, 10) || 30000, 60000);
        const limit = parseSyncLimit(req.query.limit);
        chatRuntimeMetrics.observeValue('sync.updates.limit', limit);
        chatRuntimeMetrics.observeValue('sync.updates.clientPts', clientPts);
        chatRuntimeMetrics.observeValue('sync.updates.timeoutMs', timeout);

        const serverPts = await updateService.getUpdateId(userId);
        chatRuntimeMetrics.observeValue('sync.updates.serverPts', serverPts);
        chatRuntimeMetrics.observeValue('sync.updates.lagPts', Math.max(0, serverPts - clientPts));

        // 如果有新消息，立即返回
        if (serverPts > clientPts) {
            const maxPull = Math.min(serverPts - clientPts, limit);
            const { updates, lastUpdateId } = await updateService.getUpdates(userId, clientPts, maxPull);
            const payload = await buildSyncPayload(clientPts, serverPts, updates, lastUpdateId, maxPull);
            chatRuntimeMetrics.increment('sync.updates.immediate');
            chatRuntimeMetrics.observeValue('sync.updates.maxPull', maxPull);
            chatRuntimeMetrics.observeValue('sync.updates.updates', payload.updates.length);
            chatRuntimeMetrics.observeValue('sync.updates.messages', payload.messages.length);
            chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
            chatRuntimeMetrics.increment('sync.updates.success');
            return sendSuccess(res, payload);
        }

        // 否则等待新消息 (简化实现，生产环境应使用更高效的机制)
        // 这里使用简单的延迟返回，但仍会在等待结束后再次检查并返回差分，避免丢更新
        await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 5000)));

        const newPts = await updateService.getUpdateId(userId);
        chatRuntimeMetrics.observeValue('sync.updates.newPts', newPts);

        if (newPts > clientPts) {
            const maxPull = Math.min(newPts - clientPts, limit);
            const { updates, lastUpdateId } = await updateService.getUpdates(userId, clientPts, maxPull);
            const payload = await buildSyncPayload(clientPts, newPts, updates, lastUpdateId, maxPull);
            chatRuntimeMetrics.increment('sync.updates.delayed');
            chatRuntimeMetrics.observeValue('sync.updates.maxPull', maxPull);
            chatRuntimeMetrics.observeValue('sync.updates.updates', payload.updates.length);
            chatRuntimeMetrics.observeValue('sync.updates.messages', payload.messages.length);
            chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
            chatRuntimeMetrics.increment('sync.updates.success');
            return sendSuccess(res, payload);
        }

        chatRuntimeMetrics.increment('sync.updates.empty');
        chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
        chatRuntimeMetrics.increment('sync.updates.success');
        return sendSuccess(res, {
            updates: [],
            messages: [],
            state: buildSyncState(newPts),
            isLatest: true,
            fromPts: clientPts,
            serverPts: newPts,
            protocolVersion: SYNC_PROTOCOL_VERSION,
            watermarkField: SYNC_WATERMARK_FIELD,
        });
    } catch (err) {
        chatRuntimeMetrics.increment('sync.updates.errors');
        chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
        next(err);
    }
});

/**
 * GET /api/sync/supergroups
 * P2: 获取用户已加入的大群更新状态
 * 客户端传入每个大群的本地 seq，服务端返回有更新的群组
 */
router.get('/supergroups', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        // 客户端传入格式: ?states=groupId1:seq1,groupId2:seq2
        const statesParam = (req.query.states as string) || '';

        // 解析客户端状态
        const clientStates: Record<string, number> = {};
        if (statesParam) {
            statesParam.split(',').forEach((pair) => {
                const [groupId, seqStr] = pair.split(':');
                if (groupId && seqStr) {
                    clientStates[groupId] = parseInt(seqStr, 10) || 0;
                }
            });
        }

        // 动态导入避免循环依赖
        const GroupMember = (await import('../models/GroupMember')).default;
        const Group = (await import('../models/Group')).default;
        const GroupState = (await import('../models/GroupState')).default;
        const { Op } = await import('sequelize');

        // 1. 获取用户加入的所有大群 (memberCount > 500)
        const LARGE_GROUP_THRESHOLD = parseInt(process.env.GROUP_FANOUT_THRESHOLD || '500', 10);

        const memberships = await GroupMember.findAll({
            where: {
                userId,
                isActive: true,
            },
            attributes: ['groupId'],
        });

        const groupIds = memberships.map((m: any) => m.groupId);
        if (groupIds.length === 0) {
            return sendSuccess(res, { updates: [], totalGroups: 0 });
        }

        // 2. 过滤出大群
        const largeGroups = await Group.findAll({
            where: {
                id: { [Op.in]: groupIds },
                memberCount: { [Op.gt]: LARGE_GROUP_THRESHOLD },
                isActive: true,
            },
            attributes: ['id', 'name', 'memberCount'],
        });

        const largeGroupIds = largeGroups.map((g: any) => g.id);
        if (largeGroupIds.length === 0) {
            return sendSuccess(res, { updates: [], totalGroups: 0 });
        }

        // 3. 获取这些大群的 GroupState
        const groupStates = await GroupState.find({
            _id: { $in: largeGroupIds },
        }).lean();

        // 4. 对比客户端 seq，找出有更新的群组
        const updates: { groupId: string; groupName: string; serverSeq: number; clientSeq: number; hasNew: boolean }[] = [];

        for (const state of groupStates) {
            const groupId = state._id;
            const serverSeq = state.lastSeq;
            const clientSeq = clientStates[groupId] || 0;
            const group = largeGroups.find((g: any) => g.id === groupId);

            if (serverSeq > clientSeq) {
                updates.push({
                    groupId,
                    groupName: group?.name || '',
                    serverSeq,
                    clientSeq,
                    hasNew: true,
                });
            }
        }

        return sendSuccess(res, {
            updates,
            totalGroups: largeGroupIds.length,
            threshold: LARGE_GROUP_THRESHOLD,
        });
    } catch (err) {
        next(err);
    }
});

export default router;
