/**
 * ImpressionLogger - 曝光日志记录器
 * 复刻 x-algorithm 的 side effect 机制
 * 异步记录帖子曝光，用于后续的 SeenPostFilter 和分析
 */

import { SideEffect } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import UserAction, { ActionType } from '../../../models/UserAction';
import { extractExperimentKeys } from '../utils/experimentKeys';

/**
 * 曝光去重缓存
 * 使用 LRU 策略避免内存无限增长
 */
class ImpressionCache {
    private cache: Map<string, number> = new Map();
    private maxSize = 10000;
    private ttlMs = 30 * 60 * 1000; // 30分钟过期

    /**
     * 生成缓存键
     */
    private getKey(userId: string, postId: string): string {
        return `${userId}:${postId}`;
    }

    /**
     * 检查是否最近已记录
     */
    hasRecentImpression(userId: string, postId: string): boolean {
        const key = this.getKey(userId, postId);
        const timestamp = this.cache.get(key);
        
        if (!timestamp) return false;
        
        // 检查是否过期
        if (Date.now() - timestamp > this.ttlMs) {
            this.cache.delete(key);
            return false;
        }
        
        return true;
    }

    /**
     * 记录曝光
     */
    recordImpression(userId: string, postId: string): void {
        const key = this.getKey(userId, postId);
        
        // LRU 清理: 当超过最大容量时删除最旧的条目
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }
        
        this.cache.set(key, Date.now());
    }

    /**
     * 批量过滤已记录的曝光
     */
    filterNewImpressions(userId: string, postIds: string[]): string[] {
        return postIds.filter(postId => !this.hasRecentImpression(userId, postId));
    }
}

// 全局曝光缓存实例
const impressionCache = new ImpressionCache();

export class ImpressionLogger implements SideEffect<FeedQuery, FeedCandidate> {
    readonly name = 'ImpressionLogger';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async run(query: FeedQuery, selectedCandidates: FeedCandidate[]): Promise<void> {
        if (selectedCandidates.length === 0) return;

        try {
            const experimentKeys = extractExperimentKeys(query);
            const rankByPostId = new Map<string, number>();
            selectedCandidates.forEach((candidate, idx) => {
                rankByPostId.set(candidate.postId.toString(), idx + 1);
            });

            // 过滤掉最近已记录的曝光，避免重复
            const postIds = selectedCandidates.map(c => c.postId.toString());
            const newPostIds = impressionCache.filterNewImpressions(query.userId, postIds);
            
            if (newPostIds.length === 0) {
                console.log(`[ImpressionLogger] All ${selectedCandidates.length} impressions already recorded, skipping`);
                return;
            }

            // 找出需要记录的候选者
            const newPostIdSet = new Set(newPostIds);
            const newCandidates = selectedCandidates.filter(
                c => newPostIdSet.has(c.postId.toString())
            );

            // 批量记录曝光
            const impressions = newCandidates.map((candidate) => ({
                userId: query.userId,
                action: ActionType.IMPRESSION,
                targetPostId: candidate.postId,
                targetAuthorId: candidate.authorId,
                requestId: query.requestId,
                rank: rankByPostId.get(candidate.postId.toString()),
                score: this.toFiniteNumber(candidate.score),
                weightedScore: this.toFiniteNumber(candidate.weightedScore),
                inNetwork: candidate.inNetwork === true,
                isNews: candidate.isNews === true,
                modelPostId: this.resolveModelPostId(candidate),
                recallSource: candidate.recallSource,
                experimentKeys,
                productSurface: 'space_feed',
                timestamp: new Date(),
            }));

            await UserAction.logActions(impressions);

            // 更新缓存
            for (const postId of newPostIds) {
                impressionCache.recordImpression(query.userId, postId);
            }

            console.log(
                `[ImpressionLogger] Logged ${newCandidates.length} new impressions for user ${query.userId} (${selectedCandidates.length - newCandidates.length} duplicates skipped)`
            );
        } catch (error) {
            console.error('[ImpressionLogger] Failed to log impressions:', error);
        }
    }

    private toFiniteNumber(value: number | undefined): number | undefined {
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }

    private resolveModelPostId(candidate: FeedCandidate): string {
        return candidate.modelPostId || candidate.newsMetadata?.externalId || candidate.postId.toString();
    }
}
