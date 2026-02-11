import { FeedCandidate } from '../types/FeedCandidate';

/**
 * x-algorithm uses "related IDs" to dedup seen/served across retweets, replies, and conversations.
 * In our Post model, the closest equivalents are:
 * - postId
 * - originalPostId (quote/repost)
 * - replyToPostId (reply parent)
 * - conversationId (thread root)
 */
export function getRelatedPostIds(candidate: FeedCandidate): string[] {
    const ids: Array<string | undefined> = [
        candidate.modelPostId,
        candidate.postId?.toString?.(),
        candidate.originalPostId?.toString?.(),
        candidate.replyToPostId?.toString?.(),
        candidate.conversationId?.toString?.(),
    ];

    // News-specific related identifiers (best-effort).
    // These are useful for dedup across multiple Post documents that represent the same external corpus item.
    if (candidate.isNews) {
        const ext = candidate.newsMetadata?.externalId;
        if (typeof ext === 'string' && ext.length > 0) {
            ids.push(ext);
        }
        const clusterId = candidate.newsMetadata?.clusterId;
        if (clusterId !== undefined && clusterId !== null) {
            ids.push(`news:cluster:${String(clusterId)}`);
        }
    }

    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
