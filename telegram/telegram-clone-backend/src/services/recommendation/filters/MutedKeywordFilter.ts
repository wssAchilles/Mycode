/**
 * MutedKeywordFilter - 关键词屏蔽过滤器
 * 复刻 x-algorithm home-mixer/filters/muted_keyword_filter.rs
 * 过滤掉包含用户屏蔽关键词的帖子
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class MutedKeywordFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'MutedKeywordFilter';

    enable(query: FeedQuery): boolean {
        return (
            !!query.userFeatures &&
            query.userFeatures.mutedKeywords.length > 0
        );
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const mutedKeywords = query.userFeatures?.mutedKeywords || [];
        if (mutedKeywords.length === 0) {
            return { kept: candidates, removed: [] };
        }

        // 构建正则表达式 (不区分大小写)
        const patterns = mutedKeywords.map(
            (keyword) => new RegExp(this.escapeRegex(keyword), 'i')
        );

        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const candidate of candidates) {
            const text = candidate.content.toLowerCase();
            const hasMutedKeyword = patterns.some((pattern) => pattern.test(text));

            if (hasMutedKeyword) {
                removed.push(candidate);
            } else {
                kept.push(candidate);
            }
        }

        return { kept, removed };
    }

    /**
     * 转义正则表达式特殊字符
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
