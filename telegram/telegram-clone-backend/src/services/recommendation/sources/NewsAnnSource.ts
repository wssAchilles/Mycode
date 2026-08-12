/**
 * NewsAnnSource - 新闻 OON 召回源（ANN Two-Tower）
 *
 * 对齐 x-algorithm 的 Phoenix Retrieval 思想，但这里的全局语料暂定为新闻语料：
 * - ANN 输入/输出使用 externalId（例如 MIND `N12345`）
 * - 通过 Mongo `newsMetadata.externalId` 映射回 Post._id 以便后续 hydration 与 serving
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import {
    AnnAttempt,
    AnnClient,
    AnnComparison,
    HttpAnnClient,
    buildAnnEvaluationKs,
    compareAnnAgainstExact,
    retrieveAnnWithinBudget,
} from '../clients/ANNClient';
import {
    CRAWLER_TFIDF_EMBEDDING_CONTRACT,
    buildEmbeddingContract,
    isEmbeddingContractCompatible,
    type EmbeddingContract,
} from '../contracts/embeddingContract';

const FALLBACK_MAX_RESULTS = 80;
const NEWS_ANN_TIMEOUT_MS = Math.max(
    50,
    parseInt(String(process.env.NEWS_ANN_TIMEOUT_MS || '900'), 10) || 900,
);
const NEWS_ANN_RETRIES = Math.max(
    0,
    parseInt(String(process.env.NEWS_ANN_RETRIES || '0'), 10) || 0,
);
const DEFAULT_NEWS_ANN_DIMENSIONS = Math.max(
    1,
    parseInt(String(process.env.NEWS_ANN_EMBEDDING_DIMENSIONS || '256'), 10) || 256,
);
const REQUIRED_NEWS_ANN_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'semantic_news_v1',
    dimensions: DEFAULT_NEWS_ANN_DIMENSIONS,
    retrievalEmbeddingDim: DEFAULT_NEWS_ANN_DIMENSIONS,
    rankingEmbeddingDim: DEFAULT_NEWS_ANN_DIMENSIONS,
    modelVersion: process.env.NEWS_ANN_REQUIRED_MODEL_VERSION || 'semantic_news_v1',
    artifactVersion: process.env.NEWS_ANN_REQUIRED_ARTIFACT_VERSION || 'semantic_news_artifact_v1',
    producer: 'NewsAnnSource',
    semantic: true,
};

type AnnObservation = {
    mode: 'observe_only';
    reason?: 'client_not_configured' | 'request_contract_mismatch' | 'id_namespace_mismatch' | 'observation_failed';
    attempt?: AnnAttempt;
    validatedCount: number;
    hydratedCount: number;
    comparison: AnnComparison;
};

export class NewsAnnSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'NewsAnnSource';
    private annClient?: AnnClient;
    private readonly stageDetails = new Map<string, Record<string, unknown>>();

    constructor(annClient?: AnnClient) {
        if (annClient) {
            this.annClient = annClient;
        } else if (process.env.ANN_ENDPOINT) {
            this.annClient = new HttpAnnClient({
                endpoint: process.env.ANN_ENDPOINT,
                timeoutMs: NEWS_ANN_TIMEOUT_MS,
                retries: NEWS_ANN_RETRIES,
                retryDelayMs: 0,
            });
        }
    }

    enable(query: FeedQuery): boolean {
        return !query.inNetworkOnly;
    }

    stageDetail(query: FeedQuery, _candidates?: FeedCandidate[]): Record<string, unknown> | undefined {
        const detail = this.stageDetails.get(query.requestId);
        this.stageDetails.delete(query.requestId);
        return detail;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        const annObservationPromise = this.observeAnnWithinDeadline(query);
        const [annObservation, candidates] = await Promise.all([
            annObservationPromise,
            this.getRecencyFallback(query),
        ]);
        this.stageDetails.set(query.requestId, {
            servedPath: candidates.length > 0 ? 'recency_fallback' : 'empty',
            annObservation,
        });
        return candidates;
    }

    private async observeAnnWithinDeadline(query: FeedQuery): Promise<AnnObservation> {
        const startedAt = Date.now();
        const budgetMs = Math.max(1, resolveAnnBudgetMs(query, NEWS_ANN_TIMEOUT_MS));
        const deadline = startedAt + budgetMs;
        let timer: NodeJS.Timeout | undefined;
        const observation = this.observeAnn(query, deadline, startedAt)
            .catch(() => (
                Date.now() >= deadline
                    ? timedOutAnnObservation(query, startedAt)
                    : failedAnnObservation(query)
            ));
        const timeout = new Promise<AnnObservation>((resolve) => {
            timer = setTimeout(
                () => resolve(timedOutAnnObservation(query, startedAt)),
                Math.max(0, deadline - Date.now()),
            );
        });

        try {
            return await Promise.race([observation, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async observeAnn(
        query: FeedQuery,
        deadline: number,
        startedAt: number,
    ): Promise<AnnObservation> {
        const evaluationKs = buildAnnEvaluationKs(query.limit);
        const comparison = compareAnnAgainstExact({ evaluationKs, annIds: [] });
        if (!this.annClient) {
            return {
                mode: 'observe_only',
                reason: 'client_not_configured',
                validatedCount: 0,
                hydratedCount: 0,
                comparison,
            };
        }

        const runtimeContract = getNewsAnnRuntimeContract();
        if (!isEmbeddingContractCompatible(runtimeContract, REQUIRED_NEWS_ANN_CONTRACT)) {
            return {
                mode: 'observe_only',
                reason: 'request_contract_mismatch',
                validatedCount: 0,
                hydratedCount: 0,
                comparison,
            };
        }

        const requestedK = evaluationKs[evaluationKs.length - 1] || 200;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            return timedOutAnnObservation(query, startedAt);
        }
        const attempt = await retrieveAnnWithinBudget(
            this.annClient,
            {
                userId: query.userId,
                keywords: [],
                historyPostIds: (query.newsHistoryExternalIds || []).map(String).filter(Boolean),
                topK: requestedK,
                corpusContract: runtimeContract,
                expectedEvidence: {
                    embeddingSpace: runtimeContract.embeddingSpace,
                    retrievalEmbeddingDim: runtimeContract.retrievalEmbeddingDim,
                    modelVersion: runtimeContract.modelVersion,
                    artifactVersion: runtimeContract.artifactVersion,
                    idNamespace: 'news_external_id',
                },
            },
            remainingMs,
        );
        if (Date.now() >= deadline) {
            return timedOutAnnObservation(query, startedAt);
        }
        const observedComparison = compareAnnAgainstExact({
            evaluationKs,
            annIds: attempt.candidates.map((candidate) => candidate.postId),
            annEvidence: attempt.responseEvidence,
        });
        if (attempt.outcome !== 'success') {
            return {
                mode: 'observe_only',
                attempt,
                validatedCount: 0,
                hydratedCount: 0,
                comparison: observedComparison,
            };
        }
        if (attempt.responseEvidence?.idNamespace !== 'news_external_id') {
            return {
                mode: 'observe_only',
                reason: 'id_namespace_mismatch',
                attempt,
                validatedCount: 0,
                hydratedCount: 0,
                comparison: observedComparison,
            };
        }

        const externalIds = Array.from(new Set(
            attempt.candidates.map((candidate) => candidate.postId.trim()).filter(Boolean),
        ));
        if (externalIds.length === 0) {
            return {
                mode: 'observe_only',
                attempt,
                validatedCount: 0,
                hydratedCount: 0,
                comparison: observedComparison,
            };
        }
        const posts = await Post.find(
            {
                isNews: true,
                deletedAt: null,
                'newsMetadata.externalId': { $in: externalIds },
            },
            { 'newsMetadata.externalId': 1 },
        ).lean();
        if (Date.now() >= deadline) {
            return timedOutAnnObservation(query, startedAt);
        }
        const hydratedIds = new Set(
            (posts as any[])
                .map((post) => String(post?.newsMetadata?.externalId || ''))
                .filter((externalId) => externalIds.includes(externalId)),
        );
        return {
            mode: 'observe_only',
            attempt,
            validatedCount: externalIds.length,
            hydratedCount: hydratedIds.size,
            comparison: observedComparison,
        };
    }

    private async getRecencyFallback(query: FeedQuery): Promise<FeedCandidate[]> {
        const mongoQuery: Record<string, unknown> = {
            isNews: true,
            deletedAt: null,
        };
        if (query.cursor) {
            mongoQuery.createdAt = { $lt: query.cursor };
        }

        const posts = await Post.find(mongoQuery)
            .sort({ createdAt: -1 })
            .limit(FALLBACK_MAX_RESULTS)
            .lean();

        return (posts as any[]).map((p) => ({
            ...createFeedCandidate(p as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: false,
            recallSource: this.name,
            _scoreBreakdown: {
                annFallbackRecency: 1,
            },
        }));
    }
}

function getNewsAnnRuntimeContract(): EmbeddingContract {
    const dimensions = Math.max(
        1,
        parseInt(String(process.env.NEWS_ANN_EMBEDDING_DIMENSIONS || DEFAULT_NEWS_ANN_DIMENSIONS), 10)
        || DEFAULT_NEWS_ANN_DIMENSIONS,
    );
    if (process.env.NEWS_ANN_SEMANTIC_CONTRACT_ENABLED === 'true') {
        return {
            embeddingSpace: process.env.NEWS_ANN_EMBEDDING_SPACE || REQUIRED_NEWS_ANN_CONTRACT.embeddingSpace,
            dimensions,
            retrievalEmbeddingDim: dimensions,
            rankingEmbeddingDim: dimensions,
            modelVersion: process.env.NEWS_ANN_MODEL_VERSION || REQUIRED_NEWS_ANN_CONTRACT.modelVersion,
            artifactVersion: process.env.NEWS_ANN_ARTIFACT_VERSION || REQUIRED_NEWS_ANN_CONTRACT.artifactVersion,
            producer: process.env.NEWS_ANN_PRODUCER || 'news-ann-service',
            semantic: true,
        };
    }

    return buildEmbeddingContract(CRAWLER_TFIDF_EMBEDDING_CONTRACT, dimensions);
}

function resolveAnnBudgetMs(query: FeedQuery, fallbackMs: number): number {
    const policyBudget = Number(query.rankingPolicy?.sourceBatchTimeoutMs);
    return Number.isFinite(policyBudget) && policyBudget > 0
        ? Math.round(policyBudget)
        : fallbackMs;
}

function failedAnnObservation(query: FeedQuery): AnnObservation {
    const evaluationKs = buildAnnEvaluationKs(query.limit);
    return {
        mode: 'observe_only',
        reason: 'observation_failed',
        validatedCount: 0,
        hydratedCount: 0,
        comparison: compareAnnAgainstExact({ evaluationKs, annIds: [] }),
    };
}

function timedOutAnnObservation(query: FeedQuery, startedAt: number): AnnObservation {
    const evaluationKs = buildAnnEvaluationKs(query.limit);
    const requestedK = evaluationKs[evaluationKs.length - 1] || 200;
    return {
        mode: 'observe_only',
        attempt: {
            outcome: 'timeout',
            requestedK,
            returnedK: 0,
            latencyMs: Math.max(0, Date.now() - startedAt),
            candidates: [],
        },
        validatedCount: 0,
        hydratedCount: 0,
        comparison: compareAnnAgainstExact({ evaluationKs, annIds: [] }),
    };
}
