import type { FeedCandidate } from '../types/FeedCandidate';
import { getRelatedPostIds } from '../utils/relatedPostIds';
import type { SpaceFeedDebugInfo } from './debugInfo';
import type { RustFeedServingMeta } from './rustFeedRuntime';

export interface SpaceFeedPageResult {
    candidates: FeedCandidate[];
    hasMore: boolean;
    nextCursor?: string;
    servedIdsDelta: string[];
    rustServing?: RustFeedServingMeta;
    debug?: SpaceFeedDebugInfo;
}

export function buildSpaceFeedPageResult(
    candidates: FeedCandidate[],
    limit: number,
    pageMeta?: Partial<Omit<SpaceFeedPageResult, 'candidates' | 'servedIdsDelta'>>,
): SpaceFeedPageResult {
    const servedIdsDelta: string[] = [];
    const servedSeen = new Set<string>();

    for (const candidate of candidates) {
        for (const id of [
            ...getRelatedPostIds(candidate),
            ...getServedContextTokens(candidate),
        ]) {
            const value = String(id || '').trim();
            if (!value || servedSeen.has(value)) continue;
            servedSeen.add(value);
            servedIdsDelta.push(value);
        }
    }

    const lastCreatedAt = candidates.length > 0
        ? candidates[candidates.length - 1].createdAt
        : undefined;
    const derivedNextCursor = lastCreatedAt instanceof Date
        ? lastCreatedAt.toISOString()
        : typeof lastCreatedAt === 'string'
            ? new Date(lastCreatedAt).toISOString()
            : undefined;

    return {
        candidates,
        hasMore: pageMeta?.hasMore ?? candidates.length >= limit,
        nextCursor: pageMeta?.nextCursor ?? derivedNextCursor,
        servedIdsDelta,
        rustServing: pageMeta?.rustServing,
        debug: pageMeta?.debug,
    };
}

function getServedContextTokens(candidate: FeedCandidate): string[] {
    const tokens: string[] = [];
    const authorId = String(candidate.authorId || '').trim();
    if (authorId) {
        tokens.push(`author:${normalizeServedContextKey(authorId)}`);
    }

    const source = String(candidate.recallSource || candidate.retrievalLane || '').trim();
    if (source) {
        tokens.push(`source:${normalizeServedContextKey(source)}`);
    }

    const topic = getServedTopicContext(candidate);
    if (topic) {
        tokens.push(`topic:${topic}`);
    }

    return tokens;
}

function getServedTopicContext(candidate: FeedCandidate): string | undefined {
    const clusterId = candidate.newsMetadata?.clusterId;
    if (clusterId !== undefined && clusterId !== null) {
        return `news_cluster:${String(clusterId)}`;
    }
    const conversationId = String(candidate.conversationId || '').trim();
    if (conversationId) {
        return `conversation:${normalizeServedContextKey(conversationId)}`;
    }
    const interestPoolKind = String(candidate.interestPoolKind || '').trim();
    if (interestPoolKind) {
        return `interest_pool:${normalizeServedContextKey(interestPoolKind)}`;
    }
    if (candidate.isNews) return 'format:news';
    if (candidate.hasVideo) return 'format:video';
    if (candidate.hasImage) return 'format:image';
    if (candidate.isReply) return 'format:reply';
    if (candidate.isRepost) return 'format:repost';
    return 'format:text';
}

function normalizeServedContextKey(value: string): string {
    return value.trim().toLowerCase();
}
