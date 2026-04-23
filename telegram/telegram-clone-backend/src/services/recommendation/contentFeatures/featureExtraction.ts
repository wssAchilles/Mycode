import type { IPost, IPostStats } from '../../../models/Post';
import type {
    PostEngagementBucket,
    PostFeatureClusterScore,
    PostFeatureKeywordScore,
    PostFreshnessBucket,
} from '../../../models/PostFeatureSnapshot';

export function tokenizeContent(value?: string | null): string[] {
    if (!value) return [];
    return String(value)
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter(Boolean);
}

export function buildKeywordScores(post: Pick<IPost, 'content' | 'keywords'>): PostFeatureKeywordScore[] {
    const explicitKeywords = Array.isArray(post.keywords) ? post.keywords : [];
    const tokens = explicitKeywords.length > 0 ? explicitKeywords : tokenizeContent(post.content).slice(0, 12);
    const counts = new Map<string, number>();

    for (const token of tokens) {
        const normalized = String(token || '').trim().toLowerCase();
        if (!normalized) continue;
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }

    const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0) || 1;
    return Array.from(counts.entries())
        .map(([keyword, count]) => ({
            keyword,
            weight: count / total,
        }))
        .sort((left, right) => right.weight - left.weight)
        .slice(0, 12);
}

export function mergeClusterScores(
    parts: Array<Array<{ clusterId: number; score: number }>>,
    limit: number = 8,
): PostFeatureClusterScore[] {
    const merged = new Map<number, number>();
    for (const part of parts) {
        for (const item of part) {
            if (!Number.isFinite(item.clusterId) || !Number.isFinite(item.score) || item.score <= 0) {
                continue;
            }
            merged.set(item.clusterId, (merged.get(item.clusterId) || 0) + item.score);
        }
    }

    const max = Math.max(...Array.from(merged.values()), 1);
    return Array.from(merged.entries())
        .map(([clusterId, score]) => ({
            clusterId,
            score: score / max,
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
}

export function computeEngagementScore(stats?: Partial<IPostStats>, engagementScore?: number): number {
    if (typeof engagementScore === 'number' && Number.isFinite(engagementScore) && engagementScore > 0) {
        return Math.min(engagementScore / 100, 1);
    }

    const engagements =
        (stats?.likeCount || 0) +
        (stats?.commentCount || 0) * 2 +
        (stats?.repostCount || 0) * 3 +
        (stats?.quoteCount || 0) * 2;

    return Math.min(engagements / 100, 1);
}

export function toEngagementBucket(score: number): PostEngagementBucket {
    if (score >= 0.7) return 'viral';
    if (score >= 0.35) return 'high';
    if (score >= 0.15) return 'medium';
    return 'low';
}

export function toFreshnessBucket(createdAt: Date): PostFreshnessBucket {
    const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / (1000 * 60 * 60));
    if (ageHours <= 24) return 'hours_24';
    if (ageHours <= 24 * 7) return 'days_7';
    if (ageHours <= 24 * 30) return 'days_30';
    if (ageHours <= 24 * 90) return 'days_90';
    return 'stale';
}
