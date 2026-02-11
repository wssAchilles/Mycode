/**
 * SpaceFeedMixer - Space Feed 编排层
 * 复刻 x-algorithm home-mixer/main.rs
 * 组装完整的 Feed 推荐管道
 */

import { RecommendationPipeline } from './framework';
import { FeedQuery, createFeedQuery } from './types/FeedQuery';
import { FeedCandidate } from './types/FeedCandidate';
import { reportPipelineMetrics } from './utils/metricsReporter';

// Sources
import { FollowingSource, PopularSource, ColdStartSource, TwoTowerSource } from './sources';
import { NewsAnnSource } from './sources/NewsAnnSource';

// Hydrators
import {
    UserActionSeqQueryHydrator,
    UserFeaturesQueryHydrator,
    NewsModelContextQueryHydrator,
    AuthorInfoHydrator,
    UserInteractionHydrator,
    VideoInfoHydrator,
    VFCandidateHydrator,
    ExperimentQueryHydrator,
} from './hydrators';

// Filters
import {
    AgeFilter,
    BlockedUserFilter,
    MutedKeywordFilter,
    SeenPostFilter,
    DuplicateFilter,
    NewsExternalIdDedupFilter,
    SelfPostFilter,
    RetweetDedupFilter,
    VFFilter,
    ConversationDedupFilter,
    PreviouslyServedFilter,
} from './filters';

// Scorers
import {
    EngagementScorer,
    WeightedScorer,
    AuthorDiversityScorer,
    OONScorer,
    RecencyScorer,
    AuthorAffinityScorer,
    ContentQualityScorer,
    PhoenixScorer,
} from './scorers';

// Selector
import { TopKSelector } from './selectors';

// SideEffects
import { ImpressionLogger, MetricsCollector, ServeCacheSideEffect } from './sideeffects';

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
 * 复刻 home-mixer 的编排职责
 * 完整集成 x-algorithm 的所有核心组件
 */
export class SpaceFeedMixer {
    private pipeline: RecommendationPipeline<FeedQuery, FeedCandidate>;
    private config: SpaceFeedMixerConfig;

    constructor(config: Partial<SpaceFeedMixerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.pipeline = this.buildPipeline();
    }

    /**
     * 构建推荐管道
     * 像素级复刻 home-mixer 的管道组装
     */
    private buildPipeline(): RecommendationPipeline<FeedQuery, FeedCandidate> {
        const pipeline = new RecommendationPipeline<FeedQuery, FeedCandidate>({
            defaultResultSize: this.config.defaultResultSize,
            maxCandidates: this.config.maxCandidates,
            debug: this.config.debug,
            onMetrics: (m) => reportPipelineMetrics('recsys.pipeline', m),
            componentTimeoutMs: 1500,
            captureComponentMetrics: true,
        })
            // ============================================
            // QueryHydrators (并行执行) - 丰富查询上下文
            // ============================================
            .withQueryHydrator(new UserFeaturesQueryHydrator()) // 加载用户特征
            .withQueryHydrator(new UserActionSeqQueryHydrator()) // 加载行为序列
            .withQueryHydrator(new NewsModelContextQueryHydrator()); // 新闻 externalId 上下文（ANN/Phoenix）

        // A/B 实验上下文填充 (条件启用)
        if (this.config.experimentsEnabled) {
            pipeline.withQueryHydrator(new ExperimentQueryHydrator());
        }

        pipeline
            // ============================================
            // Sources (并行执行) - 获取候选集
            // ============================================
            .withSource(new FollowingSource()) // 关注网络 (复刻 Thunder)
            .withSource(new NewsAnnSource()) // 新闻 OON: ANN 召回 + externalId 映射
            // 社交 OON（启发式/过渡）：默认通过实验开关启用（见 Iteration D）
            .withSource(new PopularSource()) // 热门内容 (Phoenix Retrieval heuristic)
            .withSource(new TwoTowerSource()) // 双塔 ANN 召回 (social OON heuristic)
            .withSource(new ColdStartSource()) // 冷启动内容 (新用户专用)

            // ============================================
            // Candidate Hydrators (并行执行) - 丰富候选数据
            // ============================================
            .withHydrator(new AuthorInfoHydrator()) // 作者信息
            .withHydrator(new UserInteractionHydrator()) // 用户交互状态
            .withHydrator(new VideoInfoHydrator()) // 视频/安全信息

            // ============================================
            // Filters (顺序执行) - 硬规则过滤
            // ============================================
            .withFilter(new DuplicateFilter()) // 跨源去重
            .withFilter(new NewsExternalIdDedupFilter()) // 新闻 externalId/cluster 去重
            .withFilter(new SelfPostFilter()) // 不推荐自己的帖子
            .withFilter(new RetweetDedupFilter()) // 转推/引用去重
            .withFilter(new AgeFilter(7)) // 7天内的帖子
            .withFilter(new BlockedUserFilter()) // 屏蔽用户
            .withFilter(new MutedKeywordFilter()) // 静音关键词
            .withFilter(new SeenPostFilter()) // 已读帖子
            .withFilter(new PreviouslyServedFilter()) // 已送过滤（内存缓存，占位）

            // ============================================
            // Scorers (顺序执行) - 计算评分
            // ============================================
            .withScorer(new PhoenixScorer()) // Phoenix 多动作预测（新闻 externalId）
            .withScorer(new EngagementScorer()) // 规则回退：仅在 Phoenix 缺失时填充 phoenixScores
            .withScorer(new WeightedScorer()) // 加权评分：写 weightedScore
            // 额外启发式：仅实验桶启用（默认关闭）
            .withScorer(new ContentQualityScorer())
            .withScorer(new AuthorAffinityScorer())
            .withScorer(new RecencyScorer())
            .withScorer(new AuthorDiversityScorer()) // 作者/供给单元多样性：写 score
            .withScorer(new OONScorer()) // OON 降权：基于 score 调整

            // ============================================
            // Post-score Filters (顺序执行)
            // ============================================
            // 注意：工业级 VF 通常属于 post-selection（只对少量候选做），对话去重也可后置减少开销

            // ============================================
            // Selector - 排序截断
            // ============================================
            // 预选 TopK 时做 oversample，用于后续 post-selection（例如 VF）过滤后仍能补齐 limit
            .withSelector(new TopKSelector(this.config.defaultResultSize, { oversampleFactor: 5, maxSize: 200 }))

            // ============================================
            // Post-selection Filters (顺序执行)
            // ============================================
            .withPostSelectionHydrator(new VFCandidateHydrator()) // VF 批量检测：填充 candidate.vfResult
            .withPostSelectionFilter(new VFFilter()) // VF / 可见性策略（缺失/失败 => 降级仅 in-network）
            .withPostSelectionFilter(new ConversationDedupFilter()) // 对话去重

            // ============================================
            // SideEffects (异步执行) - 副作用处理
            // ============================================
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
