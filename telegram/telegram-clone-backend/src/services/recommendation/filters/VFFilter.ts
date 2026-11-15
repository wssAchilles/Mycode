/**
 * VFFilter - 精选后可见性安全过滤器
 * 读取 candidate.vfResult 并按网络关系严格执行 Fail-Closed 安全规则：
 * - 若 VF 决策缺失：仅放行关注网络内候选（及冷启动受信任新闻语料），拒绝其余域外候选；
 * - 严禁因精选结果不足而把未过审或不安全候选作为绕过后门放回。
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

        const followedCount = query.userFeatures?.followedUserIds?.length || 0;
        const isColdStart = followedCount === 0;

        // 仅允许冷启动用户在 VF 服务缺失时放行新闻语料，避免完全白屏
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

        for (const c of candidates) {
            if (c.isNsfw) {
                removed.push(c);
                continue;
            }

            const vf = c.vfResult;
            if (!vf) {
                // VF 审核结果缺失时执行 Fail-Closed 降级：仅保留已关注网络内或冷启动新闻候选
                if (c.inNetwork === true) {
                    kept.push(c);
                } else if (isColdStart && allowNewsColdStart && c.isNews) {
                    kept.push(c);
                } else {
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
                    removed.push(c);
                    continue;
                }
            }

            kept.push(c);
        }

        return { kept, removed };
    }
}
