/**
 * AuthorDiversityScorer - 作者多样性评分器
 * 像素级复刻 x-algorithm home-mixer/scorers/author_diversity_scorer.rs
 * 对同一“供给单元”的连续帖子进行降权，保证 Feed 多样性。
 *
 * 注意：
 * - 社交帖（in-network / 普通帖子）：以 authorId 为供给单元
 * - 新闻帖（OON / NewsBot）：authorId 常量会导致全部内容被误判为同一作者，从而过度降权
 *   因此新闻帖改为以来源域名（sourceUrl/url 的 hostname）或 clusterId/source 作为供给单元
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { URL } from 'url';

/**
 * 多样性参数
 * 复刻 author_diversity_scorer.rs
 */
const PARAMS = {
    DECAY_FACTOR: 0.8,  // 衰减因子 (每多一篇同作者帖子，分数乘以此因子)
    FLOOR: 0.3,         // 最低衰减倍数 (不会低于原分数的 30%)
};

export class AuthorDiversityScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'AuthorDiversityScorer';
    private decayFactor: number;
    private floor: number;

    constructor(decayFactor: number = PARAMS.DECAY_FACTOR, floor: number = PARAMS.FLOOR) {
        this.decayFactor = decayFactor;
        this.floor = floor;
    }

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async score(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        // 复刻 author_diversity_scorer.rs 的逻辑:
        // 1. 先按现有分数排序
        // 2. 遍历并记录每个作者出现的次数
        // 3. 对同一作者的后续帖子应用衰减

        // 按分数排序的索引
        const ordered = candidates
            .map((c, index) => ({ index, candidate: c }))
            .sort((a, b) => (b.candidate.score || 0) - (a.candidate.score || 0));

        const keyCounts = new Map<string, number>();
        const scoredResults: ScoredCandidate<FeedCandidate>[] = new Array(candidates.length);

        for (const { index, candidate } of ordered) {
            const diversityKey = this.getDiversityKey(candidate);
            const position = keyCounts.get(diversityKey) || 0;
            keyCounts.set(diversityKey, position + 1);

            const multiplier = this.getMultiplier(position);
            const originalScore = candidate.score || 0;
            const adjustedScore = originalScore * multiplier;

            scoredResults[index] = {
                candidate: {
                    ...candidate,
                    score: adjustedScore,
                },
                score: adjustedScore,
                scoreBreakdown: {
                    originalScore,
                    diversityMultiplier: multiplier,
                    adjustedScore,
                },
            };
        }

        return scoredResults;
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            score: scored.score,
        };
    }

    /**
     * 计算衰减乘数
     * 复刻 AuthorDiversityScorer::multiplier()
     * 公式: (1 - floor) * decay^position + floor
     */
    private getMultiplier(position: number): number {
        return (1 - this.floor) * Math.pow(this.decayFactor, position) + this.floor;
    }

    private getDiversityKey(candidate: FeedCandidate): string {
        if (candidate.isNews) {
            const meta = candidate.newsMetadata || {};
            const url = meta.sourceUrl || meta.url || '';

            // Only treat http(s) URLs as a "real" domain. `mind://{externalId}` is not a supplier domain.
            if (url) {
                try {
                    const parsed = new URL(url);
                    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                        return `news:domain:${parsed.hostname}`;
                    }
                } catch {
                    // ignore parse errors
                }
            }

            if (meta.clusterId !== undefined && meta.clusterId !== null) {
                return `news:cluster:${String(meta.clusterId)}`;
            }
            if (meta.source) {
                return `news:source:${String(meta.source)}`;
            }
            return `news:author:${candidate.authorId}`;
        }

        return `author:${candidate.authorId}`;
    }
}
