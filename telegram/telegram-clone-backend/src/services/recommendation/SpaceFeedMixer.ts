/**
 * SpaceFeedMixer - Space Feed 编排层
 * 复刻 x-algorithm home-mixer/main.rs
 * 组装完整的 Feed 推荐管道
 */

import { RecommendationPipeline } from './framework';
import { FeedQuery, createFeedQuery } from './types/FeedQuery';
import { FeedCandidate } from './types/FeedCandidate';
import { reportPipelineMetrics } from './utils/metricsReporter';
import {
    NODE_RECOMMENDATION_BASELINE_ROLE,
    RECOMMENDATION_CANONICAL_ALGORITHM_OWNER,
} from './contracts/runtimeOwnership';
import {
    buildRecommendationFilters,
    buildRecommendationHydrators,
    buildRecommendationPostSelectionFilters,
    buildRecommendationPostSelectionHydrators,
    buildRecommendationQueryHydrators,
    buildRecommendationScorers,
    buildRecommendationSelector,
    buildRecommendationSources,
} from './internal/componentCatalog';
import { ImpressionLogger, MetricsCollector, RecommendationTraceLogger, ServeCacheSideEffect } from './sideeffects';

// Experiment
import { getExperimentLogger } from '../experiment';

/**
 * SpaceFeedMixer 配置
 */
export interface SpaceFeedMixerConfig {
    defaultResultSize: number;
    maxCandidates: number;
    debug: boolean;
    /** 是否启用实验框架 */
    experimentsEnabled: boolean;
}

const DEFAULT_CONFIG: SpaceFeedMixerConfig = {
    defaultResultSize: 20,
    maxCandidates: 500,
    debug: false,
    experimentsEnabled: true,
};

/**
 * SpaceFeedMixer
 * Node 迁移期 baseline/fallback。
 * 新增长期推荐 source/filter/scorer/selector 默认进入 Rust recommendation。
 */
export class SpaceFeedMixer {
    static readonly runtimeRole = NODE_RECOMMENDATION_BASELINE_ROLE;
    static readonly canonicalAlgorithmOwner = RECOMMENDATION_CANONICAL_ALGORITHM_OWNER;

    private pipeline: RecommendationPipeline<FeedQuery, FeedCandidate>;
    private config: SpaceFeedMixerConfig;

    constructor(config: Partial<SpaceFeedMixerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.pipeline = this.buildPipeline();
    }

    /**
     * 构建推荐管道
     * 保留迁移期 Node baseline；不作为新增长期算法能力的增长点。
     */
    private buildPipeline(): RecommendationPipeline<FeedQuery, FeedCandidate> {
        const pipeline = new RecommendationPipeline<FeedQuery, FeedCandidate>({
            defaultResultSize: this.config.defaultResultSize,
            maxCandidates: this.config.maxCandidates,
            debug: this.config.debug,
            onMetrics: (m) => reportPipelineMetrics('recsys.pipeline', m),
            componentTimeoutMs: 1500,
            captureComponentMetrics: true,
        });

        for (const hydrator of buildRecommendationQueryHydrators({
            includeExperimentQueryHydrator: this.config.experimentsEnabled,
        })) {
            pipeline.withQueryHydrator(hydrator);
        }
        for (const source of buildRecommendationSources()) {
            pipeline.withSource(source);
        }
        for (const hydrator of buildRecommendationHydrators()) {
            pipeline.withHydrator(hydrator);
        }
        for (const filter of buildRecommendationFilters()) {
            pipeline.withFilter(filter);
        }
        for (const scorer of buildRecommendationScorers()) {
            pipeline.withScorer(scorer);
        }

        pipeline.withSelector(buildRecommendationSelector(this.config.defaultResultSize));
        for (const hydrator of buildRecommendationPostSelectionHydrators()) {
            pipeline.withPostSelectionHydrator(hydrator);
        }
        for (const filter of buildRecommendationPostSelectionFilters()) {
            pipeline.withPostSelectionFilter(filter);
        }

        pipeline
            .withSideEffect(new RecommendationTraceLogger()) // 请求级 source/ranking trace
            .withSideEffect(new ImpressionLogger()) // 曝光日志
            .withSideEffect(new ServeCacheSideEffect()) // 记录已送
            .withSideEffect(new MetricsCollector()); // 指标收集

        return pipeline;
    }

    /**
     * 获取推荐 Feed
     */
    async getFeed(
        userId: string,
        limit: number = 20,
        cursor?: Date,
        inNetworkOnly: boolean = false,
        options?: Partial<Pick<FeedQuery, 'seenIds' | 'servedIds' | 'isBottomRequest' | 'clientAppId' | 'countryCode' | 'languageCode' | 'requestId'>>
    ): Promise<FeedCandidate[]> {
        const query = createFeedQuery(userId, limit, inNetworkOnly, {
            cursor,
            ...options,
        });

        const result = await this.pipeline.execute(query);

        // 记录实验曝光
        if (this.config.experimentsEnabled && query.experimentContext) {
            getExperimentLogger().logImpression(
                userId,
                query.experimentContext.assignments,
                { feedSize: result.selectedCandidates.length }
            );
        }

        return result.selectedCandidates;
    }

    /**
     * 获取 Feed 并返回完整结果 (含调试信息)
     */
    async getFeedWithDebug(
        userId: string,
        limit: number = 20
    ) {
        const query = createFeedQuery(userId, limit);
        return this.pipeline.execute(query);
    }
}

// 单例导出
let mixerInstance: SpaceFeedMixer | null = null;

export function getSpaceFeedMixer(config?: Partial<SpaceFeedMixerConfig>): SpaceFeedMixer {
    if (!mixerInstance) {
        mixerInstance = new SpaceFeedMixer(config);
    }
    return mixerInstance;
}
