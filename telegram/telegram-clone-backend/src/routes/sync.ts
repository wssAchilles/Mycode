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
const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const MIN_SYNC_TIMEOUT_MS = 200;
const MAX_SYNC_TIMEOUT_MS = 60_000;
const SYNC_PROTOCOL_VERSION = 2;
const SYNC_WATERMARK_FIELD = 'updateId';
type SyncUpdatesWakeSource = 'immediate' | 'event' | 'poll' | 'initial' | 'timeout';

function setSyncConsistencyHeaders(res: Response) {
    res.set('X-Sync-Protocol-Version', String(SYNC_PROTOCOL_VERSION));
    res.set('X-Sync-Watermark-Field', SYNC_WATERMARK_FIELD);
    res.set('Cache-Control', 'no-store');
}

function setSyncPtsHeaders(
    res: Response,
    payload: {
        serverPts?: number | null;
        statePts?: number | null;
        fromPts?: number | null;
        clientPts?: number | null;
        ackPts?: number | null;
    },
) {
    if (Number.isFinite(payload.serverPts)) {
        res.set('X-Sync-Server-Pts', String(Math.max(0, Math.floor(payload.serverPts as number))));
    } else {
        res.removeHeader('X-Sync-Server-Pts');
    }
    if (Number.isFinite(payload.statePts)) {
        res.set('X-Sync-State-Pts', String(Math.max(0, Math.floor(payload.statePts as number))));
    } else {
        res.removeHeader('X-Sync-State-Pts');
    }
    if (Number.isFinite(payload.fromPts)) {
        res.set('X-Sync-From-Pts', String(Math.max(0, Math.floor(payload.fromPts as number))));
    } else {
        res.removeHeader('X-Sync-From-Pts');
    }
    if (Number.isFinite(payload.clientPts)) {
        res.set('X-Sync-Client-Pts', String(Math.max(0, Math.floor(payload.clientPts as number))));
    } else {
        res.removeHeader('X-Sync-Client-Pts');
    }
    if (Number.isFinite(payload.ackPts)) {
        res.set('X-Sync-Ack-Pts', String(Math.max(0, Math.floor(payload.ackPts as number))));
    } else {
        res.removeHeader('X-Sync-Ack-Pts');
    }

    const lagBaseRaw =
        payload.serverPts ??
        payload.statePts;
    const lagTargetRaw =
        payload.ackPts ??
        payload.clientPts ??
        payload.fromPts ??
        payload.statePts;

    if (Number.isFinite(lagBaseRaw) && Number.isFinite(lagTargetRaw)) {
        const lagPts = Math.max(
            0,
            Math.floor((lagBaseRaw as number) - (lagTargetRaw as number)),
        );
        res.set('X-Sync-Lag-Pts', String(lagPts));
    } else {
        res.removeHeader('X-Sync-Lag-Pts');
    }
}

function setSyncWakeHeaders(
    res: Response,
    wakeSource: SyncUpdatesWakeSource,
    eventSource?: 'local' | 'pubsub',
) {
    res.set('X-Sync-Wake-Source', wakeSource);
    if (eventSource) {
        res.set('X-Sync-Wake-Event-Source', eventSource);
    } else {
        res.removeHeader('X-Sync-Wake-Event-Source');
    }
}

function observeSyncWakeSource(
    wakeSource: SyncUpdatesWakeSource,
    eventSource?: 'local' | 'pubsub',
) {
    chatRuntimeMetrics.increment(`sync.updates.wakeSource.${wakeSource}`);
    if (wakeSource === 'event' && eventSource) {
        chatRuntimeMetrics.increment(`sync.updates.wakeEventSource.${eventSource}`);
    }
}

function parseSyncLimit(raw: unknown): number {
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SYNC_LIMIT;
    return Math.min(n, MAX_SYNC_LIMIT);
}

function parseSyncTimeout(raw: unknown): number {
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SYNC_TIMEOUT_MS;
    return Math.min(Math.max(n, MIN_SYNC_TIMEOUT_MS), MAX_SYNC_TIMEOUT_MS);
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
        const [updateId, ackPts] = await Promise.all([
            updateService.getUpdateId(userId),
            updateService.getAckPts(userId),
        ]);
        setSyncPtsHeaders(res, {
            serverPts: updateId,
            statePts: updateId,
            ackPts,
        });
        chatRuntimeMetrics.observeValue('sync.state.latestPts', updateId);
        chatRuntimeMetrics.observeValue('sync.state.ackPts', ackPts);
        chatRuntimeMetrics.observeValue('sync.state.lagPts', Math.max(0, updateId - ackPts));
        chatRuntimeMetrics.observeDuration('sync.state.latencyMs', Date.now() - startedAt);
        chatRuntimeMetrics.increment('sync.state.success');

        return sendSuccess(res, {
            pts: updateId,
            updateId,
            ackPts,
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
            setSyncPtsHeaders(res, {
                fromPts: pts,
                serverPts,
                statePts: serverPts,
            });
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
        setSyncPtsHeaders(res, {
            fromPts: payload.fromPts,
            serverPts: payload.serverPts,
            statePts: payload.state?.pts,
        });
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
        const pts = parsePts((req.body as any)?.pts);

        if (pts === null) {
            chatRuntimeMetrics.increment('sync.ack.badRequest');
            chatRuntimeMetrics.observeDuration('sync.ack.latencyMs', Date.now() - startedAt);
            return errors.badRequest(res, '缺少 pts 参数');
        }
        const serverPts = await updateService.getUpdateId(userId);
        const acceptedPts = Math.min(pts, serverPts);
        const ackPts = await updateService.saveAckPts(userId, acceptedPts);
        const clamped = acceptedPts < pts;
        res.set('X-Sync-Ack-Clamped', clamped ? 'true' : 'false');
        setSyncPtsHeaders(res, {
            clientPts: pts,
            ackPts,
            serverPts,
            statePts: ackPts,
        });
        const lagPts = Math.max(0, serverPts - ackPts);
        if (clamped) {
            chatRuntimeMetrics.increment('sync.ack.clamped');
            chatRuntimeMetrics.observeValue('sync.ack.requestedPts', pts);
            chatRuntimeMetrics.observeValue('sync.ack.acceptedPts', acceptedPts);
        }
        chatRuntimeMetrics.observeValue('sync.ack.pts', ackPts);
        chatRuntimeMetrics.observeValue('sync.ack.serverPts', serverPts);
        chatRuntimeMetrics.observeValue('sync.ack.lagPts', lagPts);
        chatRuntimeMetrics.observeDuration('sync.ack.latencyMs', Date.now() - startedAt);
        chatRuntimeMetrics.increment('sync.ack.success');

        return sendSuccess(res, {
            acknowledged: true,
            pts: ackPts,
            requestedPts: pts,
            acceptedPts,
            clamped,
            serverPts,
            lagPts,
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
        const timeout = parseSyncTimeout(req.query.timeout);
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
            setSyncPtsHeaders(res, {
                fromPts: clientPts,
                serverPts: payload.serverPts,
                statePts: payload.state?.pts,
                clientPts,
            });
            setSyncWakeHeaders(res, 'immediate');
            observeSyncWakeSource('immediate');
            chatRuntimeMetrics.increment('sync.updates.immediate');
            chatRuntimeMetrics.observeValue('sync.updates.maxPull', maxPull);
            chatRuntimeMetrics.observeValue('sync.updates.updates', payload.updates.length);
            chatRuntimeMetrics.observeValue('sync.updates.messages', payload.messages.length);
            chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
            chatRuntimeMetrics.increment('sync.updates.success');
            return sendSuccess(res, { ...payload, wakeSource: 'immediate' });
        }

        // Event-driven wait: wake early when this user receives a new update.
        chatRuntimeMetrics.increment('sync.updates.wait');
        const waitResult = await updateService.waitForUpdate(userId, clientPts, timeout);
        const waitedPts = waitResult.updateId;
        const wakeSource = waitResult.wakeSource;
        setSyncWakeHeaders(res, wakeSource, waitResult.eventSource);
        observeSyncWakeSource(wakeSource, waitResult.eventSource);
        const newPts = waitedPts !== null
            ? Math.max(clientPts, waitedPts)
            : await updateService.getUpdateId(userId);
        if (waitedPts !== null) {
            chatRuntimeMetrics.increment('sync.updates.waitWoken');
        } else {
            chatRuntimeMetrics.increment('sync.updates.waitTimeout');
        }
        chatRuntimeMetrics.observeValue('sync.updates.newPts', newPts);

        if (newPts > clientPts) {
            const maxPull = Math.min(newPts - clientPts, limit);
            const { updates, lastUpdateId } = await updateService.getUpdates(userId, clientPts, maxPull);
            const payload = await buildSyncPayload(clientPts, newPts, updates, lastUpdateId, maxPull);
            setSyncPtsHeaders(res, {
                fromPts: clientPts,
                serverPts: payload.serverPts,
                statePts: payload.state?.pts,
                clientPts,
            });
            chatRuntimeMetrics.increment('sync.updates.delayed');
            chatRuntimeMetrics.observeValue('sync.updates.maxPull', maxPull);
            chatRuntimeMetrics.observeValue('sync.updates.updates', payload.updates.length);
            chatRuntimeMetrics.observeValue('sync.updates.messages', payload.messages.length);
            chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
            chatRuntimeMetrics.increment('sync.updates.success');
            return sendSuccess(res, { ...payload, wakeSource });
        }

        chatRuntimeMetrics.increment('sync.updates.empty');
        chatRuntimeMetrics.observeDuration('sync.updates.latencyMs', Date.now() - startedAt);
        chatRuntimeMetrics.increment('sync.updates.success');
        setSyncPtsHeaders(res, {
            fromPts: clientPts,
            serverPts: newPts,
            statePts: newPts,
            clientPts,
        });
        return sendSuccess(res, {
            updates: [],
            messages: [],
            state: buildSyncState(newPts),
            isLatest: true,
            fromPts: clientPts,
            serverPts: newPts,
            protocolVersion: SYNC_PROTOCOL_VERSION,
            watermarkField: SYNC_WATERMARK_FIELD,
            wakeSource,
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
