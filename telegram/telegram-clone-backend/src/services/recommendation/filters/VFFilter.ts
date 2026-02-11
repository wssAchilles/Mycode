/**
 * VFFilter - post-selection filter
 * Reads candidate.vfResult and applies surface-aware allow rules.
 *
 * Degrade policy (industrial default):
 * - If VF decision is missing/unavailable: allow in-network only, drop OON.
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

export class VFFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'VFFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(query: FeedQuery, candidates: FeedCandidate[]): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

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

        for (const c of candidates) {
            if (c.isNsfw) {
                removed.push(c);
                continue;
            }

            const vf = c.vfResult;
            if (!vf) {
                // Missing VF decision => degrade to in-network only.
                if (c.inNetwork === true) kept.push(c);
                else removed.push(c);
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
                    removed.push(c);
                    continue;
                }
            }

            kept.push(c);
        }

        return { kept, removed };
    }
}

