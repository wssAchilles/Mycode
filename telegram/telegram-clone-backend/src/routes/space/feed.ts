/**
 * Feed routes — GET and POST feed with recommendation mixing.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { spaceService } from '../../services/spaceService';
import { transformFeedCandidateToResponse } from '../../services/recommendation/adapters/spaceFeedResponseAdapter';
import {
    log,
    spaceFeedRequestSchema,
    buildFeedResponseAdapterOptions,
    isRecommendationDebugResponseEnabled,
} from './shared';

const router = Router();

// ---------------------------------------------------------------------------
// GET /feed — simple feed fetch
// ---------------------------------------------------------------------------

router.get('/feed', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const limit = parseInt(req.query.limit as string) || 20;
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;
        const includeSelf = req.query.includeSelf !== 'false';
        const inNetworkOnly = String(req.query.in_network_only || '').trim().toLowerCase() === 'true';

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const result = await spaceService.getFeedPage(userId, limit, safeCursor, includeSelf, { inNetworkOnly });

        const responseOptions = buildFeedResponseAdapterOptions();
        const transformedPosts = result.candidates.map((candidate) =>
            transformFeedCandidateToResponse(candidate, responseOptions),
        );
        const responsePayload: Record<string, unknown> = {
            posts: transformedPosts,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
        };
        if (isRecommendationDebugResponseEnabled() && result.debug) {
            responsePayload.debug = result.debug;
        }

        return res.json(responsePayload);
    } catch (error) {
        log.error({ err: error }, '获取 Feed 失败');
        return res.status(500).json({ error: '获取 Feed 失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /feed — advanced feed with seen_ids/served_ids
// ---------------------------------------------------------------------------

router.post('/feed', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const parsed = spaceFeedRequestSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'invalid_feed_request',
                details: parsed.error.flatten(),
            });
        }

        const limit = parsed.data.limit ?? 20;
        const cursorRaw = parsed.data.cursor;
        const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
        const safeCursor = cursor && !isNaN(cursor.getTime()) ? cursor : undefined;
        const includeSelf = parsed.data.includeSelf ?? true;
        const inNetworkOnly = parsed.data.in_network_only ?? false;
        const requestId = parsed.data.request_id ?? uuidv4();

        const seenIds = (parsed.data.seen_ids ?? []).map(String).filter(Boolean).slice(-200);
        const servedIds = (parsed.data.served_ids ?? []).map(String).filter(Boolean).slice(-200);
        const isBottomRequest = parsed.data.is_bottom_request ?? Boolean(safeCursor);
        const countryCode = parsed.data.country_code;
        const languageCode = parsed.data.language_code;
        const clientAppId = parsed.data.client_app_id;

        if (!userId) {
            return res.status(401).json({ error: '未授权' });
        }

        const result = await spaceService.getFeedPage(
            userId,
            limit,
            safeCursor,
            includeSelf,
            { requestId, seenIds, servedIds, isBottomRequest, countryCode, languageCode, clientAppId, inNetworkOnly },
        );

        const responseOptions = buildFeedResponseAdapterOptions();
        const transformedPosts = result.candidates.map((candidate) =>
            transformFeedCandidateToResponse(candidate, responseOptions),
        );
        const responsePayload: Record<string, unknown> = {
            request_id: requestId,
            posts: transformedPosts,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
            served_ids_delta: result.servedIdsDelta,
        };
        if (isRecommendationDebugResponseEnabled() && result.debug) {
            responsePayload.debug = result.debug;
        }

        return res.json(responsePayload);
    } catch (error) {
        log.error({ err: error }, '获取 Feed 失败');
        return res.status(500).json({ error: '获取 Feed 失败' });
    }
});

export default router;
