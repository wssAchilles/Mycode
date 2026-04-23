/**
 * PhoenixScorer - Phoenix 式多动作预测占位实现
 * 预留远程模型接口，当前使用启发式回退，填充 phoenixScores 供 WeightedScorer 等使用。
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, PhoenixScores } from '../types/FeedCandidate';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';
import {
    PhoenixClient,
    PhoenixPrediction,
    HttpPhoenixClient,
} from '../clients/PhoenixClient';
import {
    buildSocialPhoenixFeatureMapFromCandidate,
    loadSocialPhoenixModel,
    scoreTaskProbability,
    type SocialPhoenixLinearModel,
} from '../socialPhoenix';

export class PhoenixScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'PhoenixScorer';
    private client: PhoenixClient;
    private remoteEnabled: boolean;
    private socialModel: SocialPhoenixLinearModel | null;

    constructor(client?: PhoenixClient) {
        if (client) {
            this.client = client;
            this.remoteEnabled = true;
        } else {
            const endpoint = process.env.PHOENIX_ENDPOINT;
            if (!endpoint) {
                console.warn('[PhoenixScorer] PHOENIX_ENDPOINT not set, social heuristic phoenix mode enabled');
                this.remoteEnabled = false;
                this.client = {
                    predict: async () => [],
                };
            } else {
                this.client = new HttpPhoenixClient(endpoint, 3000);
                this.remoteEnabled = true;
            }
        }
        this.socialModel = loadSocialPhoenixModel(process.env.SOCIAL_PHOENIX_MODEL_PATH);
    }

    enable(query: FeedQuery): boolean {
        return this.remoteEnabled || getSpaceFeedExperimentFlag(query, 'enable_social_phoenix_scorer', true);
    }

    async score(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        if (candidates.length === 0) return [];

        try {
            const socialHeuristicEnabled = getSpaceFeedExperimentFlag(
                query,
                'enable_social_phoenix_scorer',
                true,
            );
            const remoteEligible = this.remoteEnabled
                ? candidates.filter(
                    (candidate) =>
                        Boolean(candidate.isNews) &&
                        Boolean(candidate.modelPostId || candidate.newsMetadata?.externalId),
                )
                : [];

            if (remoteEligible.length === 0 && !socialHeuristicEnabled) {
                return candidates.map((candidate) => ({ candidate, score: candidate.score ?? 0 }));
            }

            const predMap = new Map<string, PhoenixPrediction>();
            if (remoteEligible.length > 0) {
                const phoenixRequestCandidates = remoteEligible.map((candidate) => {
                    const lookupId = this.getPhoenixLookupId(candidate);
                    if (!lookupId) return candidate;
                    return { ...candidate, modelPostId: lookupId };
                });

                const preds = await this.client.predict(
                    query.userId,
                    query.modelUserActionSequence ?? query.userActionSequence ?? [],
                    phoenixRequestCandidates,
                );

                for (const prediction of preds || []) {
                    if (prediction && typeof (prediction as any).postId === 'string' && (prediction as any).postId) {
                        predMap.set((prediction as any).postId, prediction);
                    }
                }
            }

            return candidates.map((candidate) => {
                const lookupId = this.getPhoenixLookupId(candidate);
                const prediction = lookupId ? predMap.get(lookupId) : undefined;

                if (prediction) {
                    return {
                        candidate: {
                            ...candidate,
                            phoenixScores: this.mapPhoenixPrediction(prediction),
                        },
                        score: candidate.score ?? 0,
                        scoreBreakdown: {
                            socialPhoenixMode: 2,
                        },
                    };
                }

                if (socialHeuristicEnabled && !candidate.isNews) {
                    const heuristic = this.buildSocialPhoenixScores(query, candidate);
                    return {
                        candidate: {
                            ...candidate,
                            phoenixScores: heuristic.scores,
                        },
                        score: candidate.score ?? 0,
                        scoreBreakdown: heuristic.breakdown,
                    };
                }

                return { candidate, score: candidate.score ?? 0 };
            });
        } catch (err) {
            // 出错时返回空预测，避免终止 pipeline
            console.error('[PhoenixScorer] predict failed:', err);
            return candidates.map((candidate) => {
                if (getSpaceFeedExperimentFlag(query, 'enable_social_phoenix_scorer', true) && !candidate.isNews) {
                    const heuristic = this.buildSocialPhoenixScores(query, candidate);
                    return {
                        candidate: {
                            ...candidate,
                            phoenixScores: heuristic.scores,
                        },
                        score: candidate.score ?? 0,
                        scoreBreakdown: heuristic.breakdown,
                    };
                }
                return { candidate, score: candidate.score ?? 0 };
            });
        }
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            phoenixScores: scored.candidate.phoenixScores ?? candidate.phoenixScores,
        };
    }

    private mapPhoenixPrediction(prediction: PhoenixPrediction): PhoenixScores {
        return {
            likeScore: prediction.like,
            replyScore: prediction.reply,
            repostScore: prediction.repost,
            quoteScore: (prediction as any).quote,
            clickScore: prediction.click,
            quotedClickScore: (prediction as any).quotedClick,
            photoExpandScore: (prediction as any).photoExpand,
            profileClickScore: prediction.profileClick,
            videoQualityViewScore: (prediction as any).videoQualityView,
            shareScore: prediction.share,
            shareViaDmScore: (prediction as any).shareViaDm,
            shareViaCopyLinkScore: (prediction as any).shareViaCopyLink,
            dwellScore: prediction.dwell,
            dwellTime: (prediction as any).dwellTime,
            followAuthorScore: (prediction as any).followAuthor,
            notInterestedScore: (prediction as any).notInterested ?? (prediction as any).dismiss,
            dismissScore: (prediction as any).dismiss,
            blockAuthorScore: (prediction as any).blockAuthor ?? (prediction as any).block,
            blockScore: (prediction as any).block,
            muteAuthorScore: (prediction as any).muteAuthor,
            reportScore: (prediction as any).report,
        };
    }

    private buildSocialPhoenixScores(
        query: FeedQuery,
        candidate: FeedCandidate,
    ): { scores: PhoenixScores; breakdown: Record<string, number> } {
        if (this.socialModel) {
            return this.buildLearnedSocialPhoenixScores(query, candidate, this.socialModel);
        }

        const breakdown = candidate._scoreBreakdown || {};
        const affinity = this.clamp01(
            Math.max(
                breakdown.retrievalEmbeddingScore || 0,
                candidate.authorAffinityScore || 0,
                this.computeEmbeddingFallbackAffinity(query, candidate),
            ),
        );
        const authorScore = this.clamp01(
            Math.max(breakdown.retrievalAuthorClusterScore || 0, candidate.authorAffinityScore || 0),
        );
        const engagement = this.computeEngagementPrior(candidate);
        const freshness = this.computeFreshness(candidate.createdAt);
        const mediaBoost = (candidate.hasVideo ? 0.06 : 0) + (candidate.hasImage ? 0.03 : 0);
        const networkBoost = candidate.inNetwork ? 0.12 : 0;

        const likeScore = this.clamp01(0.45 * affinity + 0.25 * engagement + 0.2 * freshness + networkBoost * 0.4 + mediaBoost);
        const replyScore = this.clamp01(0.5 * authorScore + 0.2 * engagement + 0.3 * freshness);
        const repostScore = this.clamp01(0.35 * affinity + 0.4 * engagement + 0.25 * freshness);
        const quoteScore = this.clamp01(0.35 * affinity + 0.35 * engagement + 0.2 * freshness + 0.1 * authorScore);
        const clickScore = this.clamp01(0.3 * affinity + 0.18 * engagement + 0.24 * freshness + mediaBoost + networkBoost * 0.25);
        const profileClickScore = this.clamp01(0.45 * authorScore + 0.15 * freshness + 0.2 * engagement + (candidate.inNetwork ? 0.02 : 0.08));
        const shareScore = this.clamp01(0.25 * affinity + 0.45 * engagement + 0.2 * freshness);
        const dwellScore = this.clamp01(0.4 * affinity + 0.15 * engagement + 0.3 * freshness + mediaBoost);
        const followAuthorScore = this.clamp01(0.5 * authorScore + 0.2 * affinity + 0.15 * freshness + (candidate.inNetwork ? 0 : 0.1));
        const negativeBase = this.clamp01(0.2 + (1 - affinity) * 0.25 + (1 - freshness) * 0.15 - networkBoost * 0.3);

        return {
            scores: {
                likeScore,
                replyScore,
                repostScore,
                quoteScore,
                clickScore,
                quotedClickScore: this.clamp01(clickScore * 0.8),
                photoExpandScore: this.clamp01(mediaBoost > 0 ? clickScore * 0.9 : clickScore * 0.4),
                profileClickScore,
                videoQualityViewScore: candidate.hasVideo ? this.clamp01(dwellScore * 0.95) : undefined,
                shareScore,
                shareViaDmScore: this.clamp01(shareScore * 0.8),
                shareViaCopyLinkScore: this.clamp01(shareScore * 0.6),
                dwellScore,
                dwellTime: Math.max(0.1, dwellScore * 4),
                followAuthorScore,
                notInterestedScore: negativeBase,
                dismissScore: this.clamp01(negativeBase * 0.8),
                blockAuthorScore: this.clamp01(negativeBase * 0.25),
                blockScore: this.clamp01(negativeBase * 0.2),
                muteAuthorScore: this.clamp01(negativeBase * 0.35),
                reportScore: this.clamp01(candidate.isNsfw ? 0.08 : negativeBase * 0.1),
            },
            breakdown: {
                socialPhoenixMode: 1,
                socialPhoenixAffinity: affinity,
                socialPhoenixAuthorAffinity: authorScore,
                socialPhoenixEngagement: engagement,
                socialPhoenixFreshness: freshness,
            },
        };
    }

    private buildLearnedSocialPhoenixScores(
        query: FeedQuery,
        candidate: FeedCandidate,
        model: SocialPhoenixLinearModel,
    ): { scores: PhoenixScores; breakdown: Record<string, number> } {
        const features = buildSocialPhoenixFeatureMapFromCandidate(query, candidate);
        const clickScore = scoreTaskProbability(model, 'click', features);
        const likeScore = scoreTaskProbability(model, 'like', features);
        const replyScore = scoreTaskProbability(model, 'reply', features);
        const repostScore = scoreTaskProbability(model, 'repost', features);
        const quoteScore = scoreTaskProbability(model, 'quote', features);
        const shareScore = scoreTaskProbability(model, 'share', features);
        const engagementScore = scoreTaskProbability(model, 'engagement', features);
        const negativeScore = scoreTaskProbability(model, 'negative', features);

        return {
            scores: {
                likeScore,
                replyScore,
                repostScore,
                quoteScore,
                clickScore,
                quotedClickScore: this.clamp01(clickScore * 0.82),
                photoExpandScore: this.clamp01((candidate.hasImage || candidate.hasVideo) ? clickScore * 0.9 : clickScore * 0.45),
                profileClickScore: this.clamp01((likeScore + replyScore) * 0.5),
                videoQualityViewScore: candidate.hasVideo ? this.clamp01((engagementScore + clickScore) * 0.5) : undefined,
                shareScore,
                shareViaDmScore: this.clamp01(shareScore * 0.78),
                shareViaCopyLinkScore: this.clamp01(shareScore * 0.62),
                dwellScore: this.clamp01((clickScore + engagementScore) * 0.55),
                dwellTime: Math.max(0.1, (clickScore + engagementScore) * 2.5),
                followAuthorScore: this.clamp01((likeScore + replyScore) * 0.45 + (candidate.inNetwork ? 0 : 0.08)),
                notInterestedScore: negativeScore,
                dismissScore: this.clamp01(negativeScore * 0.82),
                blockAuthorScore: this.clamp01(negativeScore * 0.28),
                blockScore: this.clamp01(negativeScore * 0.22),
                muteAuthorScore: this.clamp01(negativeScore * 0.36),
                reportScore: this.clamp01(candidate.isNsfw ? Math.max(negativeScore * 0.2, 0.08) : negativeScore * 0.12),
            },
            breakdown: {
                socialPhoenixMode: 3,
                socialPhoenixLearnedClick: clickScore,
                socialPhoenixLearnedEngagement: engagementScore,
                socialPhoenixLearnedNegative: negativeScore,
            },
        };
    }

    private computeEmbeddingFallbackAffinity(query: FeedQuery, candidate: FeedCandidate): number {
        const clusters = query.embeddingContext?.interestedInClusters || [];
        if (!query.embeddingContext?.usable || clusters.length === 0) {
            return 0;
        }

        const clusterMap = new Map<number, number>();
        for (const entry of clusters) {
            clusterMap.set(entry.clusterId, entry.score);
        }
        const clusterId = candidate.newsMetadata?.clusterId;
        if (typeof clusterId === 'number') {
            return this.clamp01(clusterMap.get(clusterId) || 0);
        }
        return 0;
    }

    private computeEngagementPrior(candidate: FeedCandidate): number {
        const engagements =
            (candidate.likeCount || 0) +
            (candidate.commentCount || 0) * 2 +
            (candidate.repostCount || 0) * 3;
        return this.clamp01(engagements / 120);
    }

    private computeFreshness(createdAt: Date): number {
        const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / (1000 * 60 * 60));
        return this.clamp01(Math.exp(-ageHours / 72));
    }

    private clamp01(value: number): number {
        if (!Number.isFinite(value)) return 0;
        if (value <= 0) return 0;
        if (value >= 1) return 1;
        return value;
    }

    private getPhoenixLookupId(candidate: FeedCandidate): string | undefined {
        const baseId = candidate.modelPostId || candidate.newsMetadata?.externalId || candidate.postId?.toString?.();
        if (!baseId) return undefined;

        // If this is a repost of a "social post" (Mongo ObjectId id space), look up by the original id.
        // For news (externalId id space), keep using externalId.
        const looksLikeObjectId = /^[0-9a-fA-F]{24}$/.test(String(baseId));
        if (looksLikeObjectId && candidate.isRepost && candidate.originalPostId) {
            return candidate.originalPostId.toString();
        }

        return String(baseId);
    }
}
