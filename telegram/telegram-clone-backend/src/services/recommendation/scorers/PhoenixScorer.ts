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
            const preds = await this.client.predict(
                query.userId,
                query.userActionSequence,
                candidates
            );

            return candidates.map((candidate, idx) => {
                const p = preds[idx] || ({} as PhoenixPrediction);
                const phoenixScores: PhoenixScores = {
                    likeScore: p.like,
                    replyScore: p.reply,
                    repostScore: p.repost,
                    clickScore: p.click,
                    profileClickScore: p.profileClick,
                    shareScore: p.share,
                    dwellScore: p.dwell,
                    dismissScore: p.dismiss,
                    blockScore: p.block,
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
            phoenixScores: scored.candidate.phoenixScores,
        };
    }
}
