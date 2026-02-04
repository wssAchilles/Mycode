/**
 * 推荐管道框架核心接口定义
 * 像素级复刻 x-algorithm/candidate-pipeline 的设计
 */

/**
 * 管道执行结果
 */
export interface PipelineResult<C> {
    /** 最终选中的候选集 */
    selectedCandidates: C[];
    /** 被过滤掉的候选集 (用于调试) */
    filteredCandidates: C[];
    /** 检索到的总候选数 */
    retrievedCount: number;
    /** 执行耗时统计 */
    timing: {
        total: number;
        sourcing: number;
        hydrating: number;
        filtering: number;
        scoring: number;
        selecting: number;
    };
}

/**
 * 带分数的候选者
 */
export interface ScoredCandidate<C> {
    candidate: C;
    score: number;
    /** 各评分器的分数明细 */
    scoreBreakdown?: Record<string, number>;
}

/**
 * 过滤结果
 */
export interface FilterResult<C> {
    kept: C[];
    removed: C[];
}

// ============================================
// 核心组件接口 (1:1 复刻 candidate-pipeline)
// ============================================

/**
 * Source - 候选集来源
 * 复刻 candidate-pipeline/source.rs
 */
export interface Source<Q, C> {
    /** 组件名称 (用于日志和监控) */
    readonly name: string;

    /**
     * 判断此 Source 是否应该执行
     * @param query 查询对象
     */
    enable(query: Q): boolean;

    /**
     * 获取候选集
     * @param query 查询对象
     * @returns 候选集数组
     */
    getCandidates(query: Q): Promise<C[]>;
}

/**
 * QueryHydrator - 查询丰富器
 * 复刻 candidate-pipeline/query_hydrator.rs
 * 用于在管道开始前丰富查询上下文 (如加载用户行为序列)
 */
export interface QueryHydrator<Q> {
    readonly name: string;

    enable(query: Q): boolean;

    /**
     * 丰富查询对象
     * @param query 原始查询
     * @returns 丰富后的查询
     */
    hydrate(query: Q): Promise<Q>;

    /**
     * 将丰富结果合并到原查询
     */
    update(query: Q, hydrated: Partial<Q>): Q;
}

/**
 * Hydrator - 候选者丰富器
 * 复刻 candidate-pipeline/hydrator.rs
 * 用于批量丰富候选者数据 (如加载作者信息)
 */
export interface Hydrator<Q, C> {
    readonly name: string;

    enable(query: Q): boolean;

    /**
     * 批量丰富候选者
     * 注意: 返回的数组必须与输入顺序一致
     */
    hydrate(query: Q, candidates: C[]): Promise<C[]>;

    /**
     * 将丰富结果合并到候选者
     */
    update(candidate: C, hydrated: Partial<C>): C;
}

/**
 * Filter - 过滤器
 * 复刻 candidate-pipeline/filter.rs
 * 用于硬规则过滤 (如年龄限制、屏蔽词)
 */
export interface Filter<Q, C> {
    readonly name: string;

    enable(query: Q): boolean;

    /**
     * 过滤候选集
     * @returns kept: 保留的候选, removed: 被移除的候选
     */
    filter(query: Q, candidates: C[]): Promise<FilterResult<C>>;
}

/**
 * Scorer - 评分器
 * 复刻 candidate-pipeline/scorer.rs
 * 用于计算候选者的分数
 */
export interface Scorer<Q, C> {
    readonly name: string;

    enable(query: Q): boolean;

    /**
     * 为候选集计算分数
     * 注意: 返回的数组必须与输入顺序一致
     */
    score(query: Q, candidates: C[]): Promise<ScoredCandidate<C>[]>;

    /**
     * 将评分结果合并到候选者
     */
    update(candidate: C, scored: ScoredCandidate<C>): C;
}

/**
 * Selector - 选择器
 * 复刻 candidate-pipeline/selector.rs
 * 用于排序和截断候选集
 */
export interface Selector<Q, C> {
    readonly name: string;

    enable(query: Q): boolean;

    /**
     * 从候选者获取排序分数
     */
    getScore(candidate: C): number;

    /**
     * 获取选择数量限制
     */
    getSize(query: Q): number;

    /**
     * 选择候选集 (排序 + 截断)
     */
    select(query: Q, candidates: ScoredCandidate<C>[]): C[];
}

/**
 * SideEffect - 副作用处理器
 * 复刻 candidate-pipeline/side_effect.rs
 * 用于异步执行不影响结果的操作 (如埋点、缓存回写)
 */
export interface SideEffect<Q, C> {
    readonly name: string;

    enable(query: Q): boolean;

    /**
     * 执行副作用 (异步，不阻塞主流程)
     */
    run(query: Q, selectedCandidates: C[]): Promise<void>;
}

// ============================================
// 辅助类型
// ============================================

/**
 * 管道配置
 */
export interface PipelineConfig {
    /** 默认返回数量 */
    defaultResultSize: number;
    /** 最大候选数量 (防止内存溢出) */
    maxCandidates: number;
    /** 是否启用调试日志 */
    debug: boolean;
    /** 可选：记录指标回调 */
    onMetrics?: (metrics: PipelineMetrics) => void;
    /** 组件超时（毫秒），未设置则不做超时保护 */
    componentTimeoutMs?: number;
    /** 是否收集组件级耗时/错误指标 */
    captureComponentMetrics?: boolean;
}

/**
 * 管道执行上下文
 */
export interface PipelineContext {
    /** 请求 ID (用于追踪) */
    requestId: string;
    /** 开始时间 */
    startTime: number;
}

/**
 * 指标上报结构
 */
export interface PipelineMetrics {
    requestId: string;
    timing: PipelineResult<any>['timing'];
    counts: {
        retrieved: number;
        filtered: number;
        postFiltered: number;
        selected: number;
    };
    components?: ComponentMetric[];
}

export interface ComponentMetric {
    stage: string;
    name: string;
    durationMs: number;
    error?: string;
    timedOut?: boolean;
}
