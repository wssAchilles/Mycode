/**
 * SpaceFeedMixer - Space Feed 编排层
 * 复刻 x-algorithm home-mixer/main.rs
 * 组装完整的 Feed 推荐管道
 */

import { RecommendationPipeline } from './framework';
import { FeedQuery, createFeedQuery } from './types/FeedQuery';
import { FeedCandidate } from './types/FeedCandidate';

// Sources
import { FollowingSource, PopularSource } from './sources';

// Hydrators
import {
    UserActionSeqQueryHydrator,
    UserFeaturesQueryHydrator,
    AuthorInfoHydrator,
    UserInteractionHydrator,
} from './hydrators';

// Filters
import {
    AgeFilter,
    BlockedUserFilter,
    MutedKeywordFilter,
    SeenPostFilter,
    DuplicateFilter,
} from './filters';

// Scorers
import {
    EngagementScorer,
    WeightedScorer,
    AuthorDiversityScorer,
    RecencyScorer,
    AuthorAffinityScorer,
    ContentQualityScorer,
} from './scorers';

// SideEffects
import { ImpressionLogger, MetricsCollector } from './sideeffects';

/**
 * SpaceFeedMixer 配置
 */
export interface SpaceFeedMixerConfig {
    defaultResultSize: number;
    maxCandidates: number;
    debug: boolean;
}

const DEFAULT_CONFIG: SpaceFeedMixerConfig = {
    defaultResultSize: 20,
    maxCandidates: 500,
    debug: false,
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
        return new RecommendationPipeline<FeedQuery, FeedCandidate>({
            defaultResultSize: this.config.defaultResultSize,
            maxCandidates: this.config.maxCandidates,
            debug: this.config.debug,
        })
            // ============================================
            // QueryHydrators (并行执行) - 丰富查询上下文
            // ============================================
            .withQueryHydrator(new UserFeaturesQueryHydrator()) // 加载用户特征
            .withQueryHydrator(new UserActionSeqQueryHydrator()) // 加载行为序列

            // ============================================
            // Sources (并行执行) - 获取候选集
            // ============================================
            .withSource(new FollowingSource()) // 关注网络 (复刻 Thunder)
            .withSource(new PopularSource()) // 热门内容 (复刻 Phoenix Retrieval)

            // ============================================
            // Candidate Hydrators (并行执行) - 丰富候选数据
            // ============================================
            .withHydrator(new AuthorInfoHydrator()) // 作者信息
            .withHydrator(new UserInteractionHydrator()) // 用户交互状态

            // ============================================
            // Filters (顺序执行) - 硬规则过滤
            // ============================================
            .withFilter(new DuplicateFilter()) // 去重
            .withFilter(new AgeFilter(7)) // 7天内的帖子
            .withFilter(new BlockedUserFilter()) // 屏蔽用户
            .withFilter(new MutedKeywordFilter()) // 静音关键词
            .withFilter(new SeenPostFilter()) // 已读帖子

            // ============================================
            // Scorers (顺序执行) - 计算评分
            // ============================================
            .withScorer(new EngagementScorer()) // 基础互动预测 (规则版 Phoenix)
            .withScorer(new WeightedScorer()) // 加权评分 (复刻 WeightedScorer)
            .withScorer(new ContentQualityScorer()) // 内容质量
            .withScorer(new AuthorAffinityScorer()) // 作者亲密度
            .withScorer(new RecencyScorer()) // 时效性衰减
            .withScorer(new AuthorDiversityScorer()) // 作者多样性 (复刻)

            // ============================================
            // SideEffects (异步执行) - 副作用处理
            // ============================================
            .withSideEffect(new ImpressionLogger()) // 曝光日志
            .withSideEffect(new MetricsCollector()); // 指标收集
    }

    /**
     * 获取推荐 Feed
     */
    async getFeed(
        userId: string,
        limit: number = 20,
        cursor?: Date,
        inNetworkOnly: boolean = false
    ): Promise<FeedCandidate[]> {
        const query = createFeedQuery(userId, limit, inNetworkOnly);
        if (cursor) {
            query.cursor = cursor;
        }

        // TODO: 从数据库加载用户特征
        // query.userFeatures = await this.loadUserFeatures(userId);

        const result = await this.pipeline.execute(query);
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
