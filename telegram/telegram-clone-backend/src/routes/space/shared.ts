/**
 * Shared utilities, constants, schemas, and types for Space route modules.
 */

import { Router, Request, Response, NextFunction } from 'express';
import type { Express } from 'express';
import { spaceUpload, SPACE_PUBLIC_UPLOAD_BASE, saveSpaceUpload } from '../../controllers/uploadController';
import {
    transformFeedCandidateToResponse,
    type SpaceFeedResponseAdapterOptions,
} from '../../services/recommendation/adapters/spaceFeedResponseAdapter';
import User from '../../models/User';
import type { IPost, IPostMedia } from '../../models/Post';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import UserAction, { ActionType } from '../../models/UserAction';
import UserSignal, { SignalType, TargetType, ProductSurface } from '../../models/UserSignal';
import { spaceService } from '../../services/spaceService';
import { recordRecommendationEvent } from '../../services/recommendation/events';
import { createChildLogger } from '../../utils/logger';

export const log = createChildLogger('routes:space');

export const FEED_STATE_WINDOW = 200;

export const NEWS_BOT_AVATAR_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#3b82f6'/><stop offset='100%' stop-color='#22c55e'/></linearGradient></defs><rect width='96' height='96' rx='24' fill='#0b1220'/><rect x='12' y='12' width='72' height='72' rx='18' fill='url(#g)'/><path d='M29 36h38v6H29zm0 12h30v6H29zm0 12h22v6H29z' fill='white'/><circle cx='69' cy='60' r='7' fill='white'/></svg>";
export const NEWS_BOT_AVATAR_URL = `data:image/svg+xml;utf8,${encodeURIComponent(NEWS_BOT_AVATAR_SVG)}`;

// ---------------------------------------------------------------------------
// Zod helpers
// ---------------------------------------------------------------------------

export const zBoolish = z.preprocess((v) => {
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true') return true;
        if (s === 'false') return false;
    }
    return v;
}, z.boolean());

export const zTrimmedNullable = (max: number) =>
    z
        .preprocess((v) => {
            if (v === undefined) return undefined;
            if (v === null) return null;
            const s = String(v).trim();
            return s ? s : null;
        }, z.union([z.string().max(max), z.null()]))
        .optional();

export const spaceProfileUpdateSchema = z
    .object({
        displayName: zTrimmedNullable(50),
        bio: zTrimmedNullable(200),
        location: zTrimmedNullable(60),
        website: zTrimmedNullable(120),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'no_profile_fields' });

export const spaceFeedRequestSchema = z
    .object({
        limit: z
            .preprocess((v) => (typeof v === 'string' ? parseInt(v, 10) : v), z.number().int().min(1).max(50))
            .optional(),
        cursor: z
            .preprocess((v) => (v == null || v === '' ? undefined : String(v)), z.string())
            .optional(),
        request_id: z.string().min(1).max(128).optional(),
        includeSelf: zBoolish.optional(),
        in_network_only: zBoolish.optional(),
        seen_ids: z.array(z.string()).max(FEED_STATE_WINDOW).optional(),
        served_ids: z.array(z.string()).max(FEED_STATE_WINDOW).optional(),
        is_bottom_request: zBoolish.optional(),
        country_code: z.string().optional(),
        language_code: z.string().optional(),
        client_app_id: z
            .preprocess((v) => (typeof v === 'string' ? parseInt(v, 10) : v), z.number().int().min(0).max(1_000_000))
            .optional(),
    })
    .passthrough();

// ---------------------------------------------------------------------------
// URL normalizer
// ---------------------------------------------------------------------------

export const normalizeSpaceUploadUrl = (value?: string | null): string | null | undefined => {
    if (!value) return value || null;
    const normalizePath = (pathValue: string) => {
        if (pathValue.startsWith('/api/uploads/thumbnails/')) {
            const filename = pathValue.replace('/api/uploads/thumbnails/', '').replace(/^\/+/, '');
            return `${SPACE_PUBLIC_UPLOAD_BASE}/thumbnails/${filename}`;
        }
        if (pathValue.startsWith('/api/uploads/')) {
            const filename = pathValue.replace('/api/uploads/', '').replace(/^\/+/, '');
            return `${SPACE_PUBLIC_UPLOAD_BASE}/${filename}`;
        }
        return pathValue;
    };
    if (value.startsWith('/api/uploads/')) {
        return normalizePath(value);
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
        try {
            const parsed = new URL(value);
            return `${parsed.origin}${normalizePath(parsed.pathname)}`;
        } catch {
            return value;
        }
    }
    return value;
};

// ---------------------------------------------------------------------------
// Post transform
// ---------------------------------------------------------------------------

type PostResponseInput = {
    _id?: unknown;
    id?: string;
    originalPostId?: unknown;
    replyToPostId?: unknown;
    conversationId?: unknown;
    authorId?: string;
    content?: string;
    media?: IPostMedia[];
    createdAt?: Date | string;
    stats?: Partial<IPost['stats']>;
    isLikedByUser?: boolean;
    isRepostedByUser?: boolean;
    isPinned?: boolean;
    isNews?: boolean;
    newsMetadata?: IPost['newsMetadata'];
};

export async function transformPostToResponse(post: PostResponseInput) {
    const postId =
        typeof post.id === 'string' && post.id
            ? post.id
            : post._id != null
                ? String(post._id)
                : undefined;

    const isUuid = (value: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const author = post?.authorId && isUuid(post.authorId)
        ? await User.findByPk(post.authorId, {
            attributes: ['id', 'username', 'avatarUrl'],
        })
        : null;
    const isNews = post?.isNews || post?.authorId === 'news_bot_official';
    const fallbackAuthor = isNews
        ? { username: 'NewsBot', avatarUrl: NEWS_BOT_AVATAR_URL }
        : { username: 'Unknown', avatarUrl: null };

    const media = (post.media || []).map((m: IPostMedia) => ({
        ...m,
        url: normalizeSpaceUploadUrl(m.url),
        thumbnailUrl: normalizeSpaceUploadUrl(m.thumbnailUrl),
    }));

    return {
        _id: postId,
        id: postId,
        originalPostId: post.originalPostId != null ? String(post.originalPostId) : undefined,
        replyToPostId: post.replyToPostId != null ? String(post.replyToPostId) : undefined,
        conversationId: post.conversationId != null ? String(post.conversationId) : undefined,
        authorId: post.authorId,
        authorUsername: author?.username || fallbackAuthor.username,
        authorAvatarUrl: author?.avatarUrl || fallbackAuthor.avatarUrl,
        content: post.content,
        media,
        createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
        likeCount: post.stats?.likeCount ?? 0,
        commentCount: post.stats?.commentCount ?? 0,
        repostCount: post.stats?.repostCount ?? 0,
        viewCount: post.stats?.viewCount ?? 0,
        isLiked: post.isLikedByUser ?? false,
        isReposted: post.isRepostedByUser ?? false,
        isPinned: post.isPinned ?? false,
        isNews: post.isNews ?? false,
        newsMetadata: post.newsMetadata ?? undefined,
    };
}

// ---------------------------------------------------------------------------
// Feed response adapter helpers
// ---------------------------------------------------------------------------

function isEnvFlagEnabled(name: string): boolean {
    return ['true', '1', 'yes'].includes(String(process.env[name] || '').toLowerCase());
}

export function isRecommendationDebugResponseEnabled(): boolean {
    return isEnvFlagEnabled('RECSYS_DEBUG_RESPONSE');
}

export function buildFeedResponseAdapterOptions(): SpaceFeedResponseAdapterOptions {
    const exposeRecommendationDebug = isRecommendationDebugResponseEnabled();
    return {
        newsBotAvatarUrl: NEWS_BOT_AVATAR_URL,
        normalizeMediaUrl: normalizeSpaceUploadUrl,
        exposeScoreBreakdown: isEnvFlagEnabled('RECSYS_DEBUG_SCORE_BREAKDOWN'),
        exposeRecommendationDebug,
        exposeExplainSignals: exposeRecommendationDebug || isEnvFlagEnabled('RECSYS_EXPOSE_EXPLAIN_SIGNALS'),
    };
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

export function extractPostKeywords(post: any): string[] {
    if (!post) return [];
    const keywords: string[] = [];
    if (Array.isArray(post.keywords)) {
        keywords.push(...post.keywords);
    }
    if (post.newsMetadata?.title) {
        keywords.push(...post.newsMetadata.title.split(/\s+/).slice(0, 5));
    }
    return keywords.filter((k: string) => k && k.length >= 2).slice(0, 12);
}

export function buildTrendInteractionKeywords(tag: string, query: string): string[] {
    const values = [tag, query]
        .flatMap((value) => String(value || '').replace(/^#+/, '').split(/[^a-zA-Z0-9_-]+/))
        .map((value) => value.replace(/^#+/, '').trim().toLowerCase())
        .filter((value) => value.length >= 2 && value.length <= 48);
    return Array.from(new Set(values)).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Upload middleware helpers
// ---------------------------------------------------------------------------

export function createSingleUploadMiddleware(fieldName: string, fallbackMessage: string) {
    return (req: Request, res: Response, next: NextFunction) => {
        spaceUpload.single(fieldName)(req, res, (err: any) => {
            if (err) {
                const message = err?.message || fallbackMessage;
                return res.status(400).json({ error: message });
            }
            next();
        });
    };
}

// ---------------------------------------------------------------------------
// Fire-and-forget action/signal helpers
// ---------------------------------------------------------------------------

/** Log a post interaction action (like/repost/reply) with keyword extraction. */
export function logPostAction(userId: string, postId: string, action: ActionType) {
    spaceService.getPost(postId).then((post) => {
        const targetKeywords = extractPostKeywords(post);
        recordRecommendationEvent({
            userId,
            eventType: actionToRecommendationEvent(action),
            targetId: postId,
            targetAuthorId: post?.authorId,
            targetKeywords,
            productSurface: ProductSurface.SPACE_FEED,
        }).catch(() => {});
    }).catch(() => {
        recordRecommendationEvent({
            userId,
            eventType: actionToRecommendationEvent(action),
            targetId: postId,
            productSurface: ProductSurface.SPACE_FEED,
        }).catch(() => {});
    });
}

function actionToRecommendationEvent(action: ActionType) {
    switch (action) {
        case ActionType.LIKE:
            return 'like';
        case ActionType.REPLY:
            return 'reply';
        case ActionType.REPOST:
            return 'repost';
        case ActionType.QUOTE:
            return 'quote';
        case ActionType.CLICK:
            return 'click';
        case ActionType.DWELL:
            return 'dwell';
        default:
            return 'click';
    }
}

/** Log a simple UserAction entry (fire-and-forget). */
export function logAction(entry: Parameters<typeof UserAction.logActions>[0][0]) {
    UserAction.logActions([entry]).catch(() => {});
}

/** Log a simple UserSignal entry (fire-and-forget). */
export function logSignal(params: {
    userId: string;
    signalType: SignalType;
    targetId: string;
    targetType: TargetType;
    productSurface?: ProductSurface;
}) {
    UserSignal.logSignal({
        ...params,
        productSurface: params.productSurface ?? ProductSurface.HOME_FEED,
    }).catch(() => {});
}

// Re-export for sub-modules that need direct access
export { spaceUpload, saveSpaceUpload, ActionType, SignalType, TargetType, ProductSurface };
