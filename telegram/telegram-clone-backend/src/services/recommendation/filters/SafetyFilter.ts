/**
 * SafetyFilter - 安全过滤器
 * 占位实现：过滤 NSFW / 已知违规标记的内容
 * 可替换为调用 VF 服务的结果
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { HttpVFClient, VFClientExtended } from '../clients/VFClient';

// Safety policy (align with ml-services defaults):
// - in-network: allow SAFE + LOW_RISK by default
// - OON: only allow SAFE by default
const VF_IN_NETWORK_ALLOW_LOW_RISK =
    String(process.env.VF_IN_NETWORK_ALLOW_LOW_RISK ?? 'true').toLowerCase() === 'true';
const VF_OON_ALLOW_LOW_RISK =
    String(process.env.VF_OON_ALLOW_LOW_RISK ?? 'false').toLowerCase() === 'true';

export class SafetyFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'SafetyFilter';
    private vfClient?: VFClientExtended;

    constructor(vfClient?: VFClientExtended) {
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
                const res = await this.vfClient.checkExtended({
                    items: candidates.map((c) => ({
                        postId: c.postId.toString(),
                        userId: query.userId,
                        content: c.content,
                    })),
                    skipML: false,
                });
                const map = new Map(res.map((r) => [r.postId, r]));
                for (const c of candidates) {
                    const item = map.get(c.postId.toString());
                    if (!item) {
                        // If VF didn't return a decision, be conservative for OON.
                        if (c.inNetwork === true) kept.push(c);
                        else removed.push(c);
                        continue;
                    }

                    if (!item.safe) {
                        removed.push(c);
                        continue;
                    }

                    // Surface-aware allowlist for LOW_RISK (align with x-algorithm safety levels)
                    if (item.level === 'low_risk') {
                        const isInNetwork = c.inNetwork === true;
                        const allowLowRisk = isInNetwork ? VF_IN_NETWORK_ALLOW_LOW_RISK : VF_OON_ALLOW_LOW_RISK;
                        if (!allowLowRisk) {
                            removed.push(c);
                            continue;
                        }
                    }

                    kept.push(c);
                }
                return { kept, removed };
            } catch (err) {
                console.error('[SafetyFilter] VF unavailable, applying degrade policy (in-network only)', err);

                // Degrade policy: VF failure => only allow in-network candidates (plus local NSFW rule)
                if (!query.inNetworkOnly) {
                    for (const c of candidates) {
                        const isInNetwork = c.inNetwork === true;
                        const isNsfw = Boolean(c.isNsfw);
                        if (isInNetwork && !isNsfw) kept.push(c);
                        else removed.push(c);
                    }
                    return { kept, removed };
                }
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
