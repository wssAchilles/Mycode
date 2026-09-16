/**
 * Space domain pure helpers.
 * Extracted verbatim from spaceService — no behavior changes.
 */
import type { IPost } from '../../../models/Post';
import type { SpaceTrendPostInput, SpaceTrendResult } from '../../newsTrends';

export function mergeFeedTrendKeywords(
    current: string[] | undefined,
    next: Array<string | null | undefined>,
): string[] {
    const normalized: string[] = [];
    for (const value of [...(current || []), ...next]) {
        const text = String(value || '')
            .replace(/^#+/, '')
            .replace(/[_-]+/g, ' ')
            .trim()
            .toLowerCase();
        if (!text) continue;

        const parts = text.split(/\s+/).filter((part) => part.length >= 2);
        normalized.push(text);
        normalized.push(...parts);
    }

    return Array.from(new Set(
        normalized
            .map((value) => value.trim())
            .filter((value) => value.length >= 2 && value.length <= 48),
    )).slice(0, 32);
}

export function extractKeywords(content: string): string[] {
    // 简单实现: 提取 hashtags 和分词
    const hashtags = content.match(/#[\u4e00-\u9fa5\w]+/g) || [];
    return hashtags.map((tag) => tag.slice(1));
}

export function buildNewsSummary(text: string): string {
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 160) return cleaned;
    return `${cleaned.slice(0, 160)}...`;
}

export function extractNewsKeywords(text: string): string[] {
    const cleaned = (text || '').replace(/https?:\/\/\S+/g, ' ');
    const english = cleaned.match(/[a-zA-Z]{3,}/g) || [];
    const numbers = cleaned.match(/\b\d{2,}\b/g) || [];
    const chinese = cleaned.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const tokens = [...english, ...numbers, ...chinese]
        .map((t) => t.toLowerCase())
        .slice(0, 30);
    return Array.from(new Set(tokens));
}

export function computeSimilarity(
    interest: Map<string, number>,
    candidateKeywords: string[]
): number {
    if (interest.size === 0 || candidateKeywords.length === 0) return 0;
    let score = 0;
    let norm = 0;
    for (const val of interest.values()) norm += val;
    for (const kw of candidateKeywords) {
        if (interest.has(kw)) score += interest.get(kw) || 0;
    }
    return score / Math.max(norm, 1);
}

export function computeRecencyScore(createdAt: Date | string): number {
    const ts = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
    const hours = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
    return Math.exp(-hours / 12);
}

export function sourceWeight(source?: string): number {
    const key = (source || '').toLowerCase();
    if (key.includes('reuters')) return 1.0;
    if (key.includes('bbc')) return 0.9;
    if (key.includes('cnn')) return 0.85;
    return 0.7;
}

export function escapeRegexLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeTopicTag(tag: string): string {
    return String(tag || '').trim().replace(/^#+/, '').toLowerCase();
}

export function buildTopicTextSearchQueries(normalizedTag: string): string[] {
    return Array.from(new Set([
        `#${normalizedTag}`,
        normalizedTag,
        normalizedTag.replace(/[-_]+/g, ' '),
    ].map((query) => query.trim()).filter(Boolean)));
}

export function normalizeSearchLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 20;
    return Math.max(1, Math.min(Math.trunc(limit), 50));
}

export function buildTextSearchQuery(query: string, cursor?: Date): Record<string, unknown> {
    const searchQuery: Record<string, unknown> = {
        deletedAt: null,
        $text: { $search: query },
    };

    if (cursor) {
        searchQuery.createdAt = { $lt: cursor };
    }

    return searchQuery;
}

export function buildExactTextSearchQuery(query: string, cursor?: Date): Record<string, unknown> {
    const escaped = escapeRegexLiteral(query);
    const searchQuery: Record<string, unknown> = {
        deletedAt: null,
        $or: [
            { content: { $regex: escaped, $options: 'i' } },
            { 'newsMetadata.title': { $regex: escaped, $options: 'i' } },
        ],
    };

    if (cursor) {
        searchQuery.createdAt = { $lt: cursor };
    }

    return searchQuery;
}

export function dedupePostsById(posts: IPost[]): IPost[] {
    const seen = new Set<string>();
    const deduped: IPost[] = [];
    for (const post of posts) {
        const rawId = (post as unknown as { _id?: unknown; id?: unknown })._id
            ?? (post as unknown as { id?: unknown }).id;
        const key = rawId ? String(rawId) : `${post.authorId}:${post.createdAt}:${post.content}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(post);
    }
    return deduped;
}

export function dedupeTrendsByTag(trends: SpaceTrendResult[]): SpaceTrendResult[] {
    const byTag = new Map<string, SpaceTrendResult>();

    for (const trend of trends) {
        const key = normalizeTopicTag(trend.tag);
        if (!key) continue;

        const normalizedTrend: SpaceTrendResult = {
            ...trend,
            tag: key,
        };
        const existing = byTag.get(key);

        if (!existing) {
            byTag.set(key, normalizedTrend);
            continue;
        }

        const existingScore = existing.score ?? existing.heat ?? existing.count ?? 0;
        const nextScore = normalizedTrend.score ?? normalizedTrend.heat ?? normalizedTrend.count ?? 0;
        const winner = nextScore > existingScore ? normalizedTrend : existing;
        byTag.set(key, {
            ...winner,
            count: Math.max(existing.count, normalizedTrend.count),
            heat: Math.max(existing.heat, normalizedTrend.heat),
            canonicalKeywords: Array.from(new Set([
                ...(existing.canonicalKeywords || []),
                ...(normalizedTrend.canonicalKeywords || []),
            ])).slice(0, 8),
        });
    }

    return Array.from(byTag.values()).sort((left, right) =>
        (right.score ?? 0) - (left.score ?? 0)
        || right.heat - left.heat
        || right.count - left.count
        || left.tag.localeCompare(right.tag)
    );
}

export function isValidTrendToken(token: string): boolean {
    const t = token.trim().toLowerCase();
    if (!t) return false;
    if (t.length < 2 || t.length > 24) return false;
    if (/^\d+$/.test(t)) return false;
    if (t.includes('http') || t.includes('/') || t.includes(':')) return false;
    return !/^(the|and|for|with|from|that|this|have|has|were|was|are|but|not|you|your|they|them|their|into|than|over|after|before|about|today|yesterday|tomorrow|company|says|said|will|can|could|would|should|while|during|under|again|more|less|very|demo|cohort|note)$/.test(t);
}

export function extractTextTrendKeywords(text: string): string[] {
    const cleaned = (text || '')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
        .toLowerCase();
    const tokens = cleaned.match(/[a-zA-Z]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
    return Array.from(new Set(tokens.filter((token) => isValidTrendToken(token)))).slice(0, 12);
}

export function extractTrendKeywords(
    post: Pick<SpaceTrendPostInput, 'content' | 'keywords' | 'isNews' | 'newsMetadata'>
): string[] {
    const explicit = Array.isArray(post.keywords)
        ? post.keywords.map((keyword) => String(keyword || '').trim().toLowerCase()).filter(Boolean)
        : [];
    if (explicit.length > 0) return explicit;

    const sourceText = post.isNews
        ? `${post.newsMetadata?.title || ''}\n${post.newsMetadata?.summary || ''}\n${post.content || ''}`
        : post.content || '';
    return extractTextTrendKeywords(sourceText);
}

export function trendPostWeight(
    post: Pick<SpaceTrendPostInput, 'stats' | 'engagementScore' | 'isNews'>
): number {
    const stats = post.stats || {};
    const engagement =
        Number(post.engagementScore || 0) ||
        Number(stats.likeCount || 0) +
            Number(stats.commentCount || 0) * 2 +
            Number(stats.repostCount || 0) * 3;
    const engagementBoost = Math.min(4, Math.floor(Math.max(0, engagement) / 20));
    return Math.max(1, 1 + engagementBoost + (post.isNews ? 1 : 0));
}
