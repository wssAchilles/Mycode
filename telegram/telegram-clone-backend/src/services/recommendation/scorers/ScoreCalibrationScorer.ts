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
            const userStateMultiplier = this.getUserStateMultiplier(query);
            const adjusted =
                current *
                sourceMultiplier *
                qualityMultiplier *
                freshnessMultiplier *
                engagementMultiplier *
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
        return getSourceMixingMultiplier(query, candidate.recallSource || '');
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
