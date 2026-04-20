/**
 * VFFilter - post-selection filter
 * Reads candidate.vfResult and applies surface-aware allow rules.
 *
 * Degrade policy (industrial default):
 * - If VF decision is missing/unavailable: allow in-network only, drop OON.
 * - If that would empty the feed, allow trusted primary recall sources instead of self-post rescue.
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { getSpaceFeedExperimentConfig } from '../utils/experimentFlags';

const parseBool = (v: unknown, fallback: boolean): boolean => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true') return true;
        if (s === 'false') return false;
    }
    return fallback;
};

const TRUSTED_EMPTY_SELECTION_RECALL_SOURCES = new Set([
    'GraphKernelSource',
    'GraphSource',
    'PopularSource',
    'ColdStartSource',
    'NewsAnnSource',
]);

function isTrustedEmptySelectionFallbackCandidate(query: FeedQuery, candidate: FeedCandidate): boolean {
    return !query.inNetworkOnly
        && TRUSTED_EMPTY_SELECTION_RECALL_SOURCES.has(String(candidate.recallSource || ''));
}

export class VFFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'VFFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(query: FeedQuery, candidates: FeedCandidate[]): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];
        const trustedEmptySelectionFallback: FeedCandidate[] = [];

        const followedCount = query.userFeatures?.followedUserIds?.length || 0;
        const isColdStart = followedCount === 0;

        // Industrial degrade escape hatch:
        // If VF is missing/unavailable, allow a very small "trusted corpus" in cold start so the feed is not empty.
        // Default: allow NEWS only (still blocks generic OON).
        const allowNewsColdStartDefault = parseBool(process.env.VF_DEGRADE_ALLOW_NEWS_COLD_START ?? 'true', true);
        const allowNewsColdStart = parseBool(
            getSpaceFeedExperimentConfig(query, 'vf_degrade_allow_news_cold_start', allowNewsColdStartDefault),
            allowNewsColdStartDefault
        );

        const inNetworkDefault = parseBool(process.env.VF_IN_NETWORK_ALLOW_LOW_RISK ?? 'true', true);
        const oonDefault = parseBool(process.env.VF_OON_ALLOW_LOW_RISK ?? 'false', false);
        const vfInNetworkAllowLowRisk = parseBool(
            getSpaceFeedExperimentConfig(query, 'vf_in_network_allow_low_risk', inNetworkDefault),
            inNetworkDefault
        );
        const vfOonAllowLowRisk = parseBool(
            getSpaceFeedExperimentConfig(query, 'vf_oon_allow_low_risk', oonDefault),
            oonDefault
        );
        const allowTrustedEmptySelectionFallbackDefault = parseBool(
            process.env.VF_DEGRADE_ALLOW_TRUSTED_EMPTY_SELECTION_RECALL ?? 'true',
            true
        );
        const allowTrustedEmptySelectionFallback = parseBool(
            getSpaceFeedExperimentConfig(
                query,
                'vf_degrade_allow_trusted_empty_selection_recall',
                allowTrustedEmptySelectionFallbackDefault
            ),
            allowTrustedEmptySelectionFallbackDefault
        );

        for (const c of candidates) {
            if (c.isNsfw) {
                removed.push(c);
                continue;
            }

            const vf = c.vfResult;
            if (!vf) {
                // Missing VF decision => degrade to in-network only.
                if (c.inNetwork === true) {
                    kept.push(c);
                } else if (isColdStart && allowNewsColdStart && c.isNews) {
                    // Cold start: allow NEWS as a trusted fallback corpus even if VF is down.
                    kept.push(c);
                } else {
                    if (
                        allowTrustedEmptySelectionFallback
                        && isTrustedEmptySelectionFallbackCandidate(query, c)
                    ) {
                        trustedEmptySelectionFallback.push(c);
                    }
                    removed.push(c);
                }
                continue;
            }

            if (!vf.safe) {
                removed.push(c);
                continue;
            }

            const level = typeof vf.level === 'string' ? vf.level : '';
            if (level === 'low_risk') {
                const allowLowRisk = c.inNetwork === true ? vfInNetworkAllowLowRisk : vfOonAllowLowRisk;
                if (!allowLowRisk) {
                    if (
                        vf.safe
                        && allowTrustedEmptySelectionFallback
                        && isTrustedEmptySelectionFallbackCandidate(query, c)
                    ) {
                        trustedEmptySelectionFallback.push(c);
                    }
                    removed.push(c);
                    continue;
                }
            }

            kept.push(c);
        }

        if (kept.length === 0 && trustedEmptySelectionFallback.length > 0) {
            const fallbackIds = new Set(trustedEmptySelectionFallback.map((c) => c.postId.toString()));
            return {
                kept: trustedEmptySelectionFallback,
                removed: removed.filter((c) => !fallbackIds.has(c.postId.toString())),
            };
        }

        return { kept, removed };
    }
}
