/**
 * AuthorAffinityScorer - 作者亲密度评分器
 * 复刻 x-algorithm 的 author affinity 概念
 * 基于用户历史行为计算与作者的亲密度分数
 *
 * 语义（工业化对齐）：
 * - 仅在实验桶开启（默认开启）
 * - 调整 candidate.weightedScore（不直接写 candidate.score）
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { ActionType } from '../../../models/UserAction';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';

type AuthorAffinitySummary = {
    score: number;
    positiveScore: number;
    negativeScore: number;
    positiveActions: number;
    negativeActions: number;
};

export class AuthorAffinityScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'AuthorAffinityScorer';

    enable(query: FeedQuery): boolean {
        // 需要用户行为序列，且仅在实验桶开启
        return (
            getSpaceFeedExperimentFlag(query, 'enable_author_affinity_scorer', true) &&
            !!query.userActionSequence &&
            query.userActionSequence.length > 0
        );
    }

    async score(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        // 计算与每个作者的亲密度
        const authorAffinities = this.computeAuthorAffinities(query);

        return candidates.map((candidate) => {
            const affinity = authorAffinities.get(candidate.authorId) || emptyAffinity();
            const current = candidate.weightedScore ?? 0;
            const multiplier = this.affinityMultiplier(affinity.score);
            const adjusted = current * multiplier;

            return {
                candidate: {
                    ...candidate,
                    authorAffinityScore: affinity.score,
                    weightedScore: adjusted,
                },
                score: adjusted,
                scoreBreakdown: {
                    authorAffinityScore: affinity.score,
                    authorAffinityPositiveScore: affinity.positiveScore,
                    authorAffinityNegativeScore: affinity.negativeScore,
                    authorAffinityPositiveActions: affinity.positiveActions,
                    authorAffinityNegativeActions: affinity.negativeActions,
                    authorAffinityMultiplier: multiplier,
                },
            };
        });
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            authorAffinityScore: scored.candidate.authorAffinityScore,
            weightedScore: scored.candidate.weightedScore ?? candidate.weightedScore,
        };
    }

    /**
     * 计算与所有作者的亲密度
     */
    private computeAuthorAffinities(query: FeedQuery): Map<string, AuthorAffinitySummary> {
        const affinities = new Map<string, AuthorAffinitySummary>();
        const actions = query.userActionSequence || [];
        const now = Date.now();

        for (const action of actions) {
            if (!action.targetAuthorId) continue;

            const ageInDays = Math.max(
                0,
                (now - new Date(action.timestamp).getTime()) / (1000 * 60 * 60 * 24),
            );
            const recentBonus = ageInDays <= 2 ? 1.15 : ageInDays <= 7 ? 1.05 : 1;
            const current = affinities.get(action.targetAuthorId) || emptyAffinity();
            const contribution = this.actionContribution(String(action.action), action.dwellTimeMs, ageInDays, recentBonus);
            if (contribution.positive > 0) {
                current.positiveScore += contribution.positive;
                current.positiveActions += 1;
            }
            if (contribution.negative > 0) {
                current.negativeScore += contribution.negative;
                current.negativeActions += 1;
            }
            affinities.set(action.targetAuthorId, current);
        }

        for (const affinity of affinities.values()) {
            const repeatedPositiveBonus = affinity.positiveActions >= 3 ? 0.08 : affinity.positiveActions === 2 ? 0.04 : 0;
            const repeatedNegativeBonus = affinity.negativeActions >= 2 ? 0.06 : 0;
            const positiveScore = affinity.positiveActions === 0
                ? 0
                : clamp01(affinity.positiveScore / (8 + affinity.positiveActions * 0.4) + repeatedPositiveBonus);
            const negativeScore = affinity.negativeActions === 0
                ? 0
                : clamp01(affinity.negativeScore / (5.5 + affinity.negativeActions * 0.2) + repeatedNegativeBonus);
            let score = Math.max(-1, Math.min(1, positiveScore - negativeScore * 1.15));
            if (affinity.positiveActions <= 1 && score > 0.18) {
                score = 0.18;
            }
            if (affinity.negativeActions > 0 && affinity.positiveActions === 0) {
                score = Math.min(score, -0.22);
            }
            affinity.positiveScore = positiveScore;
            affinity.negativeScore = negativeScore;
            affinity.score = score;
        }

        return affinities;
    }

    private actionContribution(
        action: string,
        dwellTimeMs: number | undefined,
        ageInDays: number,
        recentBonus: number,
    ): { positive: number; negative: number } {
        switch (action) {
            case ActionType.REPLY:
                return { positive: 3.2 * Math.pow(0.95, ageInDays) * recentBonus, negative: 0 };
            case ActionType.REPOST:
                return { positive: 2.1 * Math.pow(0.94, ageInDays) * recentBonus, negative: 0 };
            case ActionType.QUOTE:
                return { positive: 2.6 * Math.pow(0.95, ageInDays) * recentBonus, negative: 0 };
            case ActionType.LIKE:
                return { positive: 1.0 * Math.pow(0.93, ageInDays) * recentBonus, negative: 0 };
            case ActionType.PROFILE_CLICK:
                return { positive: 1.4 * Math.pow(0.94, ageInDays) * recentBonus, negative: 0 };
            case ActionType.SHARE:
                return { positive: 2.0 * Math.pow(0.95, ageInDays) * recentBonus, negative: 0 };
            case ActionType.DWELL:
                return {
                    positive: (0.35 + Math.min((dwellTimeMs || 0) / 12_000, 1.2)) * Math.pow(0.92, ageInDays),
                    negative: 0,
                };
            case ActionType.CLICK:
                return { positive: 0.22 * Math.pow(0.9, ageInDays), negative: 0 };
            case ActionType.IMPRESSION:
            case ActionType.DELIVERY:
                return { positive: 0, negative: 0.12 * Math.pow(0.9, ageInDays) };
            case ActionType.DISMISS:
            case 'not_interested':
                return { positive: 0, negative: 2.8 * Math.pow(0.985, ageInDays) * recentBonus };
            case 'mute_author':
                return { positive: 0, negative: 4.5 * Math.pow(0.988, ageInDays) * recentBonus };
            case ActionType.BLOCK_AUTHOR:
                return { positive: 0, negative: 7.0 * Math.pow(0.99, ageInDays) * recentBonus };
            case ActionType.REPORT:
                return { positive: 0, negative: 6.2 * Math.pow(0.99, ageInDays) * recentBonus };
            default:
                return { positive: 0, negative: 0 };
        }
    }

    private affinityMultiplier(score: number): number {
        if (score >= 0.45) {
            return 1.08 + score * 0.34;
        }
        if (score > 0) {
            return 1.02 + score * 0.24;
        }
        if (score < 0) {
            return Math.max(0.35, 1 + score * 0.72);
        }
        return 1;
    }
}

function emptyAffinity(): AuthorAffinitySummary {
    return {
        score: 0,
        positiveScore: 0,
        negativeScore: 0,
        positiveActions: 0,
        negativeActions: 0,
    };
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
