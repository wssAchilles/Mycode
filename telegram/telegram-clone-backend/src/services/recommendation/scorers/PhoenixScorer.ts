/**
 * PhoenixScorer - Phoenix 式多动作预测占位实现
 * 预留远程模型接口，当前使用启发式回退，填充 phoenixScores 供 WeightedScorer 等使用。
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, PhoenixScores } from '../types/FeedCandidate';
import {
    PhoenixClient,
    PhoenixPrediction,
    HttpPhoenixClient,
} from '../clients/PhoenixClient';

export class PhoenixScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'PhoenixScorer';
    private client: PhoenixClient;
    private enabled: boolean;

    constructor(client?: PhoenixClient) {
        if (client) {
            this.client = client;
            this.enabled = true;
        } else {
            const endpoint = process.env.PHOENIX_ENDPOINT;
            if (!endpoint) {
                console.warn('[PhoenixScorer] PHOENIX_ENDPOINT not set, Phoenix scoring disabled');
                this.enabled = false;
                // 返回空预测，保持流水线兼容
                this.client = {
                    predict: async () => [],
                };
            } else {
                this.client = new HttpPhoenixClient(endpoint, 3000);
                this.enabled = true;
            }
        }
    }

    enable(_query: FeedQuery): boolean {
        return this.enabled;
    }

    async score(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        if (candidates.length === 0) return [];

        try {
            // Industrial policy: Only score news candidates that have an externalId (model vocab).
            const phoenixEligible = candidates.filter(
                (c) => Boolean(c.isNews) && Boolean(c.modelPostId || c.newsMetadata?.externalId)
            );

            if (phoenixEligible.length === 0) {
                return candidates.map((c) => ({ candidate: c, score: c.score ?? 0 }));
            }

            // Align with x-algorithm retweet semantics: use canonical content id for lookups.
            // We keep this generic even though Phoenix is currently news-only.
            const phoenixRequestCandidates = phoenixEligible.map((c) => {
                const lookupId = this.getPhoenixLookupId(c);
                if (!lookupId) return c;
                return { ...c, modelPostId: lookupId };
            });

            const preds = await this.client.predict(
                query.userId,
                // IMPORTANT: do NOT fall back to `userActionSequence` here.
                // For news ranking, Phoenix expects the model vocabulary ids (externalId).
                query.modelUserActionSequence ?? [],
                phoenixRequestCandidates
            );

            const predMap = new Map<string, PhoenixPrediction>();
            for (const p of preds || []) {
                if (p && typeof (p as any).postId === 'string' && (p as any).postId) {
                    predMap.set((p as any).postId, p);
                }
            }

            return candidates.map((candidate) => {
                const lookupId = this.getPhoenixLookupId(candidate);
                const p = lookupId ? predMap.get(lookupId) : undefined;

                if (!p) {
                    // Do not set an "empty" phoenixScores object; leave it missing so fallback scorers can fill.
                    return { candidate, score: candidate.score ?? 0 };
                }

                const phoenixScores: PhoenixScores = {
                    likeScore: p.like,
                    replyScore: p.reply,
                    repostScore: p.repost,
                    quoteScore: (p as any).quote,
                    clickScore: p.click,
                    quotedClickScore: (p as any).quotedClick,
                    photoExpandScore: (p as any).photoExpand,
                    profileClickScore: p.profileClick,
                    videoQualityViewScore: (p as any).videoQualityView,
                    shareScore: p.share,
                    shareViaDmScore: (p as any).shareViaDm,
                    shareViaCopyLinkScore: (p as any).shareViaCopyLink,
                    dwellScore: p.dwell,
                    dwellTime: (p as any).dwellTime,
                    followAuthorScore: (p as any).followAuthor,

                    // Negative actions (support both "x-algorithm style" and legacy field names)
                    notInterestedScore: (p as any).notInterested ?? (p as any).dismiss,
                    dismissScore: (p as any).dismiss,
                    blockAuthorScore: (p as any).blockAuthor ?? (p as any).block,
                    blockScore: (p as any).block,
                    muteAuthorScore: (p as any).muteAuthor,
                    reportScore: (p as any).report,
                };

                return {
                    candidate: { ...candidate, phoenixScores },
                    score: candidate.score ?? 0,
                };
            });
        } catch (err) {
            // 出错时返回空预测，避免终止 pipeline
            console.error('[PhoenixScorer] predict failed:', err);
            return candidates.map((c) => ({ candidate: c, score: c.score ?? 0 }));
        }
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            phoenixScores: scored.candidate.phoenixScores ?? candidate.phoenixScores,
        };
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
