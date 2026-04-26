import { ScoredCandidate, Scorer } from '../framework';
import { FeedCandidate } from '../types/FeedCandidate';
import { FeedQuery } from '../types/FeedQuery';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';
import { getSourceMixingMultiplier } from '../utils/sourceMixing';

export class ScoreCalibrationScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'ScoreCalibrationScorer';

    enable(query: FeedQuery): boolean {
        return getSpaceFeedExperimentFlag(query, 'enable_score_calibration_scorer', true);
    }

    async score(
        query: FeedQuery,
        candidates: FeedCandidate[],
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        return candidates.map((candidate) => {
            const current = candidate.weightedScore ?? 0;
            const sourceMultiplier = this.getSourceMultiplier(query, candidate);
            const qualityMultiplier = this.getQualityMultiplier(query);
            const freshnessMultiplier = this.getFreshnessMultiplier(candidate);
            const engagementMultiplier = this.getEngagementMultiplier(candidate);
            const evidenceMultiplier = this.getEvidenceMultiplier(candidate);
            const earlySuppression = this.getEarlySuppression(query, candidate);
            const negativeFeedback = this.getNegativeFeedback(query, candidate);
            const userStateMultiplier = this.getUserStateMultiplier(query);
            const adjusted =
                current *
                sourceMultiplier *
                qualityMultiplier *
                freshnessMultiplier *
                engagementMultiplier *
                evidenceMultiplier *
                earlySuppression.multiplier *
                negativeFeedback.multiplier *
                userStateMultiplier;

            return {
                candidate: {
                    ...candidate,
                    weightedScore: adjusted,
                },
                score: adjusted,
                scoreBreakdown: {
                    calibrationSourceMultiplier: sourceMultiplier,
                    calibrationEmbeddingQualityMultiplier: qualityMultiplier,
                    calibrationFreshnessMultiplier: freshnessMultiplier,
                    calibrationEngagementMultiplier: engagementMultiplier,
                    calibrationEvidenceMultiplier: evidenceMultiplier,
                    earlySuppressionStrength: earlySuppression.strength,
                    earlySuppressionMultiplier: earlySuppression.multiplier,
                    negativeFeedbackStrength: negativeFeedback.strength,
                    negativeFeedbackMultiplier: negativeFeedback.multiplier,
                    calibrationUserStateMultiplier: userStateMultiplier,
                },
            };
        });
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            weightedScore: scored.candidate.weightedScore ?? candidate.weightedScore,
        };
    }

    private getSourceMultiplier(query: FeedQuery, candidate: FeedCandidate): number {
        const sourceName = candidate.recallSource || '';
        const policyMultiplier = getSourceMixingMultiplier(query, sourceName);
        if (policyMultiplier > 0) {
            return policyMultiplier;
        }

        if (candidate.inNetwork === true || sourceName === 'FollowingSource') {
            return 1.0;
        }
        if (sourceName === 'GraphSource' || sourceName === 'GraphKernelSource') {
            return 0.92;
        }
        if (sourceName === 'TwoTowerSource' || sourceName === 'EmbeddingAuthorSource' || sourceName === 'NewsAnnSource') {
            return 0.88;
        }
        if (sourceName === 'PopularSource' || sourceName === 'ColdStartSource') {
            return 0.82;
        }
        return 0.8;
    }

    private getQualityMultiplier(query: FeedQuery): number {
        if (!query.embeddingContext) {
            return 0.97;
        }
        if (!query.embeddingContext.usable) {
            return 0.95;
        }
        const quality = Math.max(0, Math.min(query.embeddingContext.qualityScore || 0, 1));
        return 0.96 + quality * 0.08;
    }

    private getFreshnessMultiplier(candidate: FeedCandidate): number {
        const ageHours = Math.max(
            0,
            (Date.now() - new Date(candidate.createdAt).getTime()) / (60 * 60 * 1000),
        );
        if (ageHours <= 24) return 1.04;
        if (ageHours <= 72) return 1.02;
        if (ageHours <= 24 * 7) return 1;
        if (ageHours <= 24 * 30) return 0.97;
        return 0.94;
    }

    private getEngagementMultiplier(candidate: FeedCandidate): number {
        const engagements =
            (candidate.likeCount || 0) +
            (candidate.commentCount || 0) * 2 +
            (candidate.repostCount || 0) * 3;
        if (engagements >= 60) return 1.05;
        if (engagements >= 20) return 1.02;
        if (engagements >= 5) return 1;
        return 0.97;
    }

    private getEvidenceMultiplier(candidate: FeedCandidate): number {
        const breakdown = candidate._scoreBreakdown || {};
        const secondaryCount = breakdown.retrievalSecondarySourceCount || 0;
        const multiSourceBonus = breakdown.retrievalMultiSourceBonus || 0;
        const crossLaneBonus = breakdown.retrievalCrossLaneBonus || 0;
        const evidenceConfidence = breakdown.retrievalEvidenceConfidence || 0;
        return 1
            + Math.min(multiSourceBonus, 0.1)
            + Math.min(crossLaneBonus, 0.06)
            + Math.min(secondaryCount * 0.008, 0.04)
            + Math.min(evidenceConfidence * 0.02, 0.02);
    }

    private getEarlySuppression(
        query: FeedQuery,
        candidate: FeedCandidate,
    ): { strength: number; multiplier: number } {
        let strength = 0;

        if (query.userFeatures?.blockedUserIds?.includes(candidate.authorId)) {
            strength = Math.max(strength, 1);
        }

        const content = `${candidate.content || ''} ${candidate.authorUsername || ''}`.toLowerCase();
        for (const keyword of query.userFeatures?.mutedKeywords || []) {
            const normalized = String(keyword || '').trim().toLowerCase();
            if (normalized && content.includes(normalized)) {
                strength = Math.max(strength, 0.52);
            }
        }

        if (candidate.vfResult?.safe === false) {
            strength = Math.max(strength, 0.9);
        } else if (candidate.isNsfw) {
            strength = Math.max(strength, 0.46);
        }

        const boundedStrength = Math.max(0, Math.min(strength, 1));
        return {
            strength: boundedStrength,
            multiplier: Math.max(0.08, Math.min(1 - boundedStrength * 0.86, 1)),
        };
    }

    private getNegativeFeedback(
        query: FeedQuery,
        candidate: FeedCandidate,
    ): { strength: number; multiplier: number } {
        const actions = query.userActionSequence || [];
        let strength = 0;
        for (const action of actions) {
            const base = this.negativeActionWeight(String(action.action || ''));
            if (base <= 0) {
                continue;
            }

            const postTarget = this.actionTargetString(action.targetPostId)
                || this.actionTargetString((action as any).modelPostId);
            const postMatch =
                postTarget === candidate.postId.toString()
                || (!!candidate.modelPostId && postTarget === candidate.modelPostId);
            const authorMatch = action.targetAuthorId === candidate.authorId;
            if (!postMatch && !authorMatch) {
                continue;
            }

            const ageDays = Math.max(
                0,
                (Date.now() - new Date(action.timestamp).getTime()) / (24 * 60 * 60 * 1000),
            );
            const recency = Math.pow(0.97, Math.min(ageDays, 30));
            strength += base * recency * (postMatch ? 1 : 0.56);
        }

        const boundedStrength = Math.max(0, Math.min(strength, 1));
        return {
            strength: boundedStrength,
            multiplier: Math.max(0.52, Math.min(1 - boundedStrength * 0.45, 1)),
        };
    }

    private negativeActionWeight(action: string): number {
        switch (action) {
            case 'dismiss':
                return 0.32;
            case 'not_interested':
                return 0.45;
            case 'mute_author':
                return 0.62;
            case 'block_author':
                return 0.84;
            case 'report':
                return 0.78;
            default:
                return 0;
        }
    }

    private actionTargetString(value: unknown): string | undefined {
        if (!value) {
            return undefined;
        }
        return String(value);
    }

    private getUserStateMultiplier(query: FeedQuery): number {
        switch (query.userStateContext?.state) {
            case 'cold_start':
                return 0.97;
            case 'sparse':
                return 0.99;
            case 'heavy':
                return 1.02;
            default:
                return 1;
        }
    }
}
