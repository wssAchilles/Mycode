/**
 * VFCandidateHydrator - post-selection hydrator
 * 对齐 x-algorithm：将 VF（可见性过滤）从 Filter 拆分为 Hydrator + Filter。
 *
 * 该 Hydrator 只负责批量调用 VF 并把结果挂到 candidate.vfResult；
 * 具体的 surface-aware policy 与 degrade 逻辑由 VFFilter 负责。
 */

import { Hydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { HttpVFClient, VFClientExtended } from '../clients/VFClient';

export class VFCandidateHydrator implements Hydrator<FeedQuery, FeedCandidate> {
    readonly name = 'VFCandidateHydrator';
    private vfClient?: VFClientExtended;

    constructor(vfClient?: VFClientExtended) {
        if (vfClient) {
            this.vfClient = vfClient;
        } else if (process.env.VF_ENDPOINT) {
            this.vfClient = new HttpVFClient({
                endpoint: process.env.VF_ENDPOINT,
                timeoutMs: 2000,
            });
        }
    }

    enable(_query: FeedQuery): boolean {
        // If VF is not configured, do not "fake" results; VFFilter will apply degrade policy.
        return Boolean(this.vfClient);
    }

    async hydrate(query: FeedQuery, candidates: FeedCandidate[]): Promise<FeedCandidate[]> {
        if (!this.vfClient) return candidates;
        if (candidates.length === 0) return candidates;

        const res = await this.vfClient.checkExtended({
            items: candidates.map((c) => ({
                postId: c.postId.toString(),
                userId: query.userId,
                content: c.content,
            })),
            skipML: false,
        });

        const map = new Map(res.map((r) => [r.postId, r]));
        return candidates.map((c) => {
            const item = map.get(c.postId.toString());
            if (!item) return c;
            return {
                ...c,
                vfResult: {
                    safe: Boolean(item.safe),
                    reason: item.reason,
                    level: item.level,
                    score: item.score,
                    violations: item.violations as any,
                    requiresReview: item.requiresReview,
                },
            };
        });
    }

    update(candidate: FeedCandidate, hydrated: Partial<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            vfResult: hydrated.vfResult ?? candidate.vfResult,
        };
    }
}

