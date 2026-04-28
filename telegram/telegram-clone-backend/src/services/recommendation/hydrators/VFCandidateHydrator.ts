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

const parseBool = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
    return fallback;
};

const VF_TIMEOUT_MS = Math.max(
    1,
    parseInt(String(process.env.VF_TIMEOUT_MS || '1200'), 10) || 1200,
);
const VF_SKIP_ML = parseBool(process.env.VF_SKIP_ML ?? 'true', true);
const VF_LOCAL_RULES_WHEN_SKIP_ML = parseBool(
    process.env.VF_LOCAL_RULES_WHEN_SKIP_ML ?? 'true',
    true,
);

const LOCAL_BLOCK_TERMS = [
    'nsfw',
    'spam',
    'scam',
    'self harm',
    'self-harm',
    'hate speech',
    'harassment',
];

function localRuleDecision(candidate: FeedCandidate) {
    const content = String(candidate.content || '').toLowerCase();
    const matchedTerm = LOCAL_BLOCK_TERMS.find((term) => content.includes(term));
    if (candidate.isNsfw || matchedTerm) {
        return {
            safe: false,
            reason: matchedTerm ? `local_rule:${matchedTerm.replace(/\s+/g, '_')}` : 'local_rule:nsfw',
            level: 'blocked' as const,
            score: 1,
            violations: [matchedTerm === 'scam' ? 'scam' : matchedTerm === 'spam' ? 'spam' : 'unknown'],
            requiresReview: true,
        };
    }

    return {
        safe: true,
        reason: 'local_rule_skip_ml',
        level: 'safe' as const,
        score: 0,
        violations: [],
        requiresReview: false,
    };
}

export class VFCandidateHydrator implements Hydrator<FeedQuery, FeedCandidate> {
    readonly name = 'VFCandidateHydrator';
    private vfClient?: VFClientExtended;
    private readonly useLocalRules: boolean;

    constructor(vfClient?: VFClientExtended) {
        this.useLocalRules = !vfClient && VF_SKIP_ML && VF_LOCAL_RULES_WHEN_SKIP_ML;
        if (vfClient) {
            this.vfClient = vfClient;
        } else if (!this.useLocalRules && process.env.VF_ENDPOINT) {
            this.vfClient = new HttpVFClient({
                endpoint: process.env.VF_ENDPOINT,
                timeoutMs: VF_TIMEOUT_MS,
            });
        }
    }

    enable(_query: FeedQuery): boolean {
        // The serving path defaults to local rule-only VF when ML is intentionally skipped.
        return this.useLocalRules || Boolean(this.vfClient);
    }

    async hydrate(query: FeedQuery, candidates: FeedCandidate[]): Promise<FeedCandidate[]> {
        if (candidates.length === 0) return candidates;
        if (this.useLocalRules) {
            return candidates.map((c) => ({
                ...c,
                vfResult: localRuleDecision(c),
            }));
        }
        if (!this.vfClient) return candidates;

        const res = await this.vfClient.checkExtended({
            items: candidates.map((c) => ({
                postId: c.postId.toString(),
                userId: query.userId,
                content: c.content,
            })),
            skipML: VF_SKIP_ML,
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
