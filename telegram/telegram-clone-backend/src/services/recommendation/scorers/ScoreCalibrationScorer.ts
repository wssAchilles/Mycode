import { ScoredCandidate, Scorer } from '../framework';
import { FeedCandidate } from '../types/FeedCandidate';
import { FeedQuery } from '../types/FeedQuery';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';
import { getSourceMixingMultiplier } from '../utils/sourceMixing';

const CALIBRATION_FACTOR_FLAGS = {
    source: 'calibration_source_multiplier',
    quality: 'calibration_quality_multiplier',
    earlySuppression: 'calibration_early_suppression',
    userState: 'calibration_user_state_multiplier',
} as const;

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
            const flag = (key: string, defaultOn = true) =>
                getSpaceFeedExperimentFlag(query, key, defaultOn);

            const sourceMultiplier = flag(CALIBRATION_FACTOR_FLAGS.source)
                ? this.getSourceMultiplier(query, candidate) : 1;
            const qualityMultiplier = flag(CALIBRATION_FACTOR_FLAGS.quality)
                ? this.getQualityMultiplier(query) : 1;
            const earlySuppression = flag(CALIBRATION_FACTOR_FLAGS.earlySuppression)
                ? this.getEarlySuppression(query, candidate) : { strength: 0, multiplier: 1 };
            const userStateMultiplier = flag(CALIBRATION_FACTOR_FLAGS.userState)
                ? this.getUserStateMultiplier(query) : 1;
            const adjusted =
                current *
                sourceMultiplier *
                qualityMultiplier *
                earlySuppression.multiplier *
                userStateMultiplier;

            return {
                candidate: {
                    ...candidate,
                    weightedScore: adjusted,
                    scoreContractVersion: candidate.scoreContractVersion ?? 'recommendation_score_contract_v2',
                    scoreBreakdownVersion: candidate.scoreBreakdownVersion ?? 'score_breakdown_v2',
                },
                score: adjusted,
                scoreBreakdown: {
                    calibrationSourceMultiplier: sourceMultiplier,
                    calibrationEmbeddingQualityMultiplier: qualityMultiplier,
                    calibrationFreshnessMultiplier: 1,
                    calibrationEngagementMultiplier: 1,
                    calibrationEvidenceMultiplier: 1,
                    earlySuppressionStrength: earlySuppression.strength,
                    earlySuppressionMultiplier: earlySuppression.multiplier,
                    negativeFeedbackStrength: 0,
                    negativeFeedbackMultiplier: 1,
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
