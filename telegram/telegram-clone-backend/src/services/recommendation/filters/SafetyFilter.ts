/**
 * SafetyFilter - 安全过滤器
 * 占位实现：过滤 NSFW / 已知违规标记的内容
 * 可替换为调用 VF 服务的结果
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { HttpVFClient, VFClient } from '../clients/VFClient';

export class SafetyFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'SafetyFilter';
    private vfClient?: VFClient;

    constructor(vfClient?: VFClient) {
        if (vfClient) {
            this.vfClient = vfClient;
        } else if (process.env.VF_ENDPOINT) {
            this.vfClient = new HttpVFClient({ 
                endpoint: process.env.VF_ENDPOINT, 
                timeoutMs: 2000 
            });
        }
    }

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        // 优先调用 VF 服务
        if (this.vfClient) {
            try {
                const res = await this.vfClient.check(
                    candidates.map((c) => ({
                        postId: c.postId.toString(),
                        userId: query.userId,
                    }))
                );
                const map = new Map(res.map((r) => [r.postId, r]));
                for (const c of candidates) {
                    const item = map.get(c.postId.toString());
                    if (item && !item.safe) {
                        removed.push(c);
                    } else {
                        kept.push(c);
                    }
                }
                return { kept, removed };
            } catch (err) {
                console.error('[SafetyFilter] VF check failed, fallback to isNsfw', err);
            }
        }

        // 回退: 仅根据 isNsfw
        for (const c of candidates) {
            if (c.isNsfw) removed.push(c);
            else kept.push(c);
        }
        return { kept, removed };
    }
}
