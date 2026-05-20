/**
 * 推荐管道执行器
 * 像素级复刻 x-algorithm/candidate-pipeline/candidate_pipeline.rs 的执行流程
 */

import {
    Source,
    QueryHydrator,
    Hydrator,
    Filter,
    Scorer,
    Selector,
    SideEffect,
    PipelineResult,
    PipelineConfig,
    PipelineContext,
    ScoredCandidate,
    FilterResult,
    ComponentMetric,
    CircuitBreakerConfig,
} from './interfaces';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../../../utils/logger';

const log = createChildLogger('recommendation:Pipeline');

// ============================================
// Circuit Breaker State
// ============================================

interface CircuitState {
    /** Number of consecutive failures */
    consecutiveFailures: number;
    /** Timestamp when the circuit was tripped (0 = not tripped) */
    trippedAt: number;
    /** Whether the circuit is currently open (blocking calls) */
    isOpen: boolean;
}

const DEFAULT_CB_FAILURE_THRESHOLD = 5;
const DEFAULT_CB_RESET_TIMEOUT_MS = 30_000;

// ============================================
// Error types for timeout and circuit breaker
// ============================================

/**
 * Thrown when a component exceeds its individual timeout.
 */
export class ComponentTimeoutError extends Error {
    constructor(
        public readonly componentName: string,
        public readonly timeoutMs: number,
    ) {
        super(`Component ${componentName} timed out after ${timeoutMs}ms`);
        this.name = 'ComponentTimeoutError';
    }
}

/**
 * Thrown when a component's circuit breaker is open (tripped).
 */
export class CircuitBreakerOpenError extends Error {
    constructor(public readonly componentKey: string) {
        super(`Circuit breaker open for ${componentKey}`);
        this.name = 'CircuitBreakerOpenError';
    }
}

// ============================================
// Circuit Breaker
// ============================================

class CircuitBreaker {
    private states = new Map<string, CircuitState>();
    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;

    /** Aggregate metrics */
    totalTrips = 0;
    totalSkips = 0;

    constructor(config?: CircuitBreakerConfig) {
        this.failureThreshold = config?.failureThreshold ?? DEFAULT_CB_FAILURE_THRESHOLD;
        this.resetTimeoutMs = config?.resetTimeoutMs ?? DEFAULT_CB_RESET_TIMEOUT_MS;
    }

    /**
     * Check whether a component is allowed to execute.
     * Returns true if the call should proceed, false if the circuit is open.
     */
    canExecute(componentKey: string): boolean {
        const state = this.states.get(componentKey);
        if (!state || !state.isOpen) return true;

        // Check if the reset window has elapsed
        if (Date.now() - state.trippedAt >= this.resetTimeoutMs) {
            // Half-open: allow one probe call
            state.isOpen = false;
            state.consecutiveFailures = 0;
            log.info(`[CircuitBreaker] ${componentKey} reset after ${this.resetTimeoutMs}ms window`);
            return true;
        }

        this.totalSkips++;
        return false;
    }

    /** Record a successful execution -- resets the failure counter */
    recordSuccess(componentKey: string): void {
        const state = this.states.get(componentKey);
        if (state) {
            state.consecutiveFailures = 0;
            if (state.isOpen) {
                state.isOpen = false;
                log.info(`[CircuitBreaker] ${componentKey} recovered`);
            }
        }
    }

    /** Record a failed execution -- may trip the circuit */
    recordFailure(componentKey: string): void {
        let state = this.states.get(componentKey);
        if (!state) {
            state = { consecutiveFailures: 0, trippedAt: 0, isOpen: false };
            this.states.set(componentKey, state);
        }

        state.consecutiveFailures++;

        if (state.consecutiveFailures >= this.failureThreshold && !state.isOpen) {
            state.isOpen = true;
            state.trippedAt = Date.now();
            this.totalTrips++;
            log.warn(
                `[CircuitBreaker] ${componentKey} OPEN after ${state.consecutiveFailures} consecutive failures ` +
                `(will reset in ${this.resetTimeoutMs}ms)`
            );
        }
    }

    /** Get current state snapshot for metrics */
    getSnapshot(): Record<string, { open: boolean; consecutiveFailures: number }> {
        const snap: Record<string, { open: boolean; consecutiveFailures: number }> = {};
        this.states.forEach((state, key) => {
            snap[key] = { open: state.isOpen, consecutiveFailures: state.consecutiveFailures };
        });
        return snap;
    }
}

/**
 * 通用推荐管道
 * @template Q 查询类型
 * @template C 候选者类型
 */
export class RecommendationPipeline<Q, C> {
    private queryHydrators: QueryHydrator<Q>[] = [];
    private sources: Source<Q, C>[] = [];
    private hydrators: Hydrator<Q, C>[] = [];
    private filters: Filter<Q, C>[] = [];
    private postFilters: Filter<Q, C>[] = [];
    private postSelectionHydrators: Hydrator<Q, C>[] = [];
    private postSelectionFilters: Filter<Q, C>[] = [];
    private scorers: Scorer<Q, C>[] = [];
    private selector: Selector<Q, C> | null = null;
    private sideEffects: SideEffect<Q, C>[] = [];
    private componentMetrics: ComponentMetric[] = [];
    private circuitBreaker: CircuitBreaker;
    private pipelineTimedOut = false;

    /** Per-request runtime metrics (reset each execute) */
    private runtimeMetrics = {
        timeoutCount: 0,
        circuitBreakerTrips: 0,
        fallbackCount: 0,
    };

    private config: PipelineConfig = {
        defaultResultSize: 20,
        maxCandidates: 1000,
        debug: false,
        onMetrics: undefined,
        componentTimeoutMs: undefined,
        captureComponentMetrics: true,
        pipelineTimeoutMs: undefined,
        circuitBreaker: undefined,
    };

    constructor(config?: Partial<PipelineConfig>) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
        this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);
    }

    // ============================================
    // Builder 模式 API
    // ============================================

    withQueryHydrator(hydrator: QueryHydrator<Q>): this {
        this.queryHydrators.push(hydrator);
        return this;
    }

    withSource(source: Source<Q, C>): this {
        this.sources.push(source);
        return this;
    }

    withHydrator(hydrator: Hydrator<Q, C>): this {
        this.hydrators.push(hydrator);
        return this;
    }

    withFilter(filter: Filter<Q, C>): this {
        this.filters.push(filter);
        return this;
    }

    withPostFilter(filter: Filter<Q, C>): this {
        this.postFilters.push(filter);
        return this;
    }

    withPostSelectionHydrator(hydrator: Hydrator<Q, C>): this {
        this.postSelectionHydrators.push(hydrator);
        return this;
    }

    withPostSelectionFilter(filter: Filter<Q, C>): this {
        this.postSelectionFilters.push(filter);
        return this;
    }

    withScorer(scorer: Scorer<Q, C>): this {
        this.scorers.push(scorer);
        return this;
    }

    withSelector(selector: Selector<Q, C>): this {
        this.selector = selector;
        return this;
    }

    withSideEffect(sideEffect: SideEffect<Q, C>): this {
        this.sideEffects.push(sideEffect);
        return this;
    }

    // ============================================
    // 核心执行流程 (1:1 复刻 candidate_pipeline.rs)
    // ============================================

    /**
     * 执行推荐管道
     * 复刻 CandidatePipeline::execute()
     *
     * When `pipelineTimeoutMs` is configured the pipeline races against a
     * wall-clock deadline. If the deadline fires the method returns whatever
     * partial results are available at that point instead of throwing.
     */
    async execute(query: Q): Promise<PipelineResult<C>> {
        const queryRequestId = (query as any)?.requestId;
        const ctx: PipelineContext = {
            requestId: typeof queryRequestId === 'string' && queryRequestId.length > 0
                ? queryRequestId
                : uuidv4(),
            startTime: Date.now(),
        };

        // Reset per-request state
        this.pipelineTimedOut = false;
        this.runtimeMetrics = { timeoutCount: 0, circuitBreakerTrips: 0, fallbackCount: 0 };
        this.componentMetrics = [];

        const pipelineTimeoutMs = this.config.pipelineTimeoutMs;

        // Wrap the core pipeline in a timeout race when configured
        const coreExecution = this.executeCore(query, ctx);

        if (pipelineTimeoutMs && pipelineTimeoutMs > 0) {
            return Promise.race([
                coreExecution,
                this.pipelineTimeoutResult(pipelineTimeoutMs, ctx),
            ]);
        }

        return coreExecution;
    }

    /**
     * Internal: builds a partial result when the pipeline-level deadline fires.
     * Sets `this.pipelineTimedOut` so `executeCore` can also bail early at
     * stage boundaries when it checks the flag.
     */
    private pipelineTimeoutResult(
        timeoutMs: number,
        ctx: PipelineContext,
    ): Promise<PipelineResult<C>> {
        return new Promise<PipelineResult<C>>((resolve) => {
            setTimeout(() => {
                this.pipelineTimedOut = true;
                const elapsed = Date.now() - ctx.startTime;
                log.warn(
                    `[Pipeline ${ctx.requestId}] Pipeline timeout after ${elapsed}ms (limit ${timeoutMs}ms) — returning partial results`
                );
                this.runtimeMetrics.timeoutCount++;
                resolve({
                    selectedCandidates: [],
                    filteredCandidates: [],
                    retrievedCount: 0,
                    timing: {
                        total: elapsed,
                        sourcing: 0,
                        hydrating: 0,
                        filtering: 0,
                        scoring: 0,
                        selecting: 0,
                    },
                });
            }, timeoutMs);
        });
    }

    /**
     * Core pipeline stages. Separated from `execute()` so the pipeline-level
     * timeout can race against the entire execution.
     */
    private async executeCore(query: Q, ctx: PipelineContext): Promise<PipelineResult<C>> {
        const timing = {
            total: 0,
            sourcing: 0,
            hydrating: 0,
            filtering: 0,
            scoring: 0,
            selecting: 0,
            postSelectionHydrating: 0,
            postSelectionFiltering: 0,
        };

        try {
            // 1. Query Hydration (并行执行)
            if (this.pipelineTimedOut) return this.buildPartialResult(ctx, timing);
            const queryStart = Date.now();
            const hydratedQuery = await this.hydrateQuery(query, ctx);
            timing.hydrating = Date.now() - queryStart;

            // 2. Sourcing (并行执行)
            if (this.pipelineTimedOut) return this.buildPartialResult(ctx, timing);
            const sourceStart = Date.now();
            let candidates = await this.fetchCandidates(hydratedQuery, ctx);
            timing.sourcing = Date.now() - sourceStart;

            // 限制最大候选数
            if (candidates.length > this.config.maxCandidates) {
                candidates = candidates.slice(0, this.config.maxCandidates);
            }

            const retrievedCount = candidates.length;

            // 3. Candidate Hydration (并行执行)
            if (this.pipelineTimedOut) return this.buildPartialResult(ctx, timing, retrievedCount);
            const hydrateStart = Date.now();
            candidates = await this.hydrateCandidates(hydratedQuery, candidates, ctx);
            timing.hydrating += Date.now() - hydrateStart;

            // 4. Filtering (顺序执行)
            if (this.pipelineTimedOut) return this.buildPartialResult(ctx, timing, retrievedCount);
            const filterStart = Date.now();
            const { kept, removed } = await this.filterCandidates(
                hydratedQuery,
                candidates,
                ctx
            );
            timing.filtering = Date.now() - filterStart;
            const filteredCount = removed.length;
            const allRemoved: C[] = [...removed];

            // 5. Scoring (顺序执行)
            if (this.pipelineTimedOut) return this.buildPartialResult(ctx, timing, retrievedCount, filteredCount, allRemoved);
            const scoreStart = Date.now();
            const scoredCandidates = await this.scoreCandidates(
                hydratedQuery,
                kept,
                ctx
            );
            timing.scoring = Date.now() - scoreStart;

            // 6. Post-score Filters (顺序执行，使用 candidate.score)
            if (this.pipelineTimedOut) return this.buildPartialResult(ctx, timing, retrievedCount, filteredCount, allRemoved);
            const postFilterStart = Date.now();
            const { kept: postFilteredCandidates, removed: postRemoved } = await this.postFilterCandidates(
                hydratedQuery,
                scoredCandidates,
                ctx
            );
            timing.filtering += Date.now() - postFilterStart;
            const postFilteredCount = postRemoved.length;
            if (postRemoved.length > 0) {
                allRemoved.push(...postRemoved);
            }

            // 7. Selection
            if (this.pipelineTimedOut) return this.buildPartialResult(ctx, timing, retrievedCount, filteredCount, allRemoved);
            const selectStart = Date.now();
            const selectedCandidates = this.selectCandidates(
                hydratedQuery,
                postFilteredCandidates,
                ctx
            );
            timing.selecting = Date.now() - selectStart;

            // 8. Post-selection Hydration + Filtering (e.g., VF)
            let finalCandidates = selectedCandidates;

            if (this.postSelectionHydrators.length > 0 && !this.pipelineTimedOut) {
                const psHydrateStart = Date.now();
                finalCandidates = await this.hydrateCandidatesWith(
                    hydratedQuery,
                    finalCandidates,
                    this.postSelectionHydrators,
                    'PostSelectionHydrator'
                );
                timing.postSelectionHydrating = Date.now() - psHydrateStart;
            }

            let postSelectionFilteredCount = 0;
            if (this.postSelectionFilters.length > 0 && finalCandidates.length > 0 && !this.pipelineTimedOut) {
                const psFilterStart = Date.now();
                const { kept: psKept, removed: psRemoved } = await this.filterCandidatesWith(
                    hydratedQuery,
                    finalCandidates,
                    this.postSelectionFilters,
                    'PostSelectionFilter'
                );
                timing.postSelectionFiltering = Date.now() - psFilterStart;
                finalCandidates = psKept;
                postSelectionFilteredCount = psRemoved.length;
                if (psRemoved.length > 0) {
                    allRemoved.push(...psRemoved);
                }
            }

            // Ensure final result size matches query.limit (selector may oversample for post-selection)
            const desiredSize =
                typeof (hydratedQuery as any)?.limit === 'number'
                    ? Math.max(0, (hydratedQuery as any).limit)
                    : this.config.defaultResultSize;
            if (finalCandidates.length > desiredSize) {
                finalCandidates = finalCandidates.slice(0, desiredSize);
            }

            // 8. Side Effects (异步，不等待)
            this.runSideEffects(hydratedQuery, finalCandidates, ctx);

            timing.total = Date.now() - ctx.startTime;

            // 指标回调
            this.emitMetrics(ctx, timing, retrievedCount, filteredCount, postFilteredCount, postSelectionFilteredCount, finalCandidates.length);

            if (this.config.debug) {
                this.logPipelineResult(
                    ctx,
                    timing,
                    retrievedCount,
                    filteredCount,
                    postFilteredCount,
                    selectedCandidates.length
                );
            }

            return {
                selectedCandidates: finalCandidates,
                filteredCandidates: allRemoved,
                retrievedCount,
                timing,
            };
        } catch (error) {
            log.error(`[Pipeline ${ctx.requestId}] Error: ${error}`);
            throw error;
        }
    }

    /**
     * Build a partial result when the pipeline is interrupted by the deadline.
     */
    private buildPartialResult(
        ctx: PipelineContext,
        timing: PipelineResult<C>['timing'],
        retrievedCount = 0,
        filteredCount = 0,
        allRemoved: C[] = [],
    ): PipelineResult<C> {
        timing.total = Date.now() - ctx.startTime;
        this.emitMetrics(ctx, timing, retrievedCount, filteredCount, 0, 0, 0);
        return {
            selectedCandidates: [],
            filteredCandidates: allRemoved,
            retrievedCount,
            timing,
        };
    }

    /**
     * Emit metrics to the configured callback, enriched with runtime safety stats.
     */
    private emitMetrics(
        ctx: PipelineContext,
        timing: PipelineResult<any>['timing'],
        retrievedCount: number,
        filteredCount: number,
        postFilteredCount: number,
        postSelectionFilteredCount: number,
        selectedCount: number,
    ): void {
        this.config.onMetrics?.({
            requestId: ctx.requestId,
            timing,
            counts: {
                retrieved: retrievedCount,
                filtered: filteredCount,
                postFiltered: postFilteredCount,
                postSelectionFiltered: postSelectionFilteredCount,
                selected: selectedCount,
            },
            components: this.config.captureComponentMetrics ? this.componentMetrics : undefined,
            safety: {
                pipelineTimedOut: this.pipelineTimedOut,
                componentTimeoutCount: this.runtimeMetrics.timeoutCount,
                circuitBreakerTrips: this.runtimeMetrics.circuitBreakerTrips,
                circuitBreakerSkips: this.circuitBreaker.totalSkips,
                fallbackCount: this.runtimeMetrics.fallbackCount,
                circuitBreakerState: this.circuitBreaker.getSnapshot(),
            },
        });
    }

    // ============================================
    // 内部执行方法
    // ============================================

    /**
     * 1. Query Hydration - 丰富查询上下文
     * 复刻 hydrate_query()
     */
    private async hydrateQuery(query: Q, _ctx: PipelineContext): Promise<Q> {
        const enabledHydrators = this.queryHydrators.filter((h) => h.enable(query));

        // 并行执行所有 QueryHydrator
        const results = await Promise.all(
            enabledHydrators.map(async (hydrator) => {
                return this.runComponent('QueryHydrator', hydrator.name, () =>
                    hydrator.hydrate(query)
                ).catch((error) => {
                    log.error(`[QueryHydrator ${hydrator.name}] Error: ${error}`);
                    return query;
                });
            })
        );

        // 合并所有结果到原 query
        let mergedQuery = query;
        for (let i = 0; i < enabledHydrators.length; i++) {
            mergedQuery = enabledHydrators[i].update(mergedQuery, results[i]);
        }

        return mergedQuery;
    }

    /**
     * 2. Sourcing - 从多个来源获取候选集
     * 复刻 fetch_candidates()
     *
     * Graceful degradation: timeouts and circuit-breaker-open produce empty
     * results instead of blocking the whole pipeline.
     */
    private async fetchCandidates(query: Q, _ctx: PipelineContext): Promise<C[]> {
        const enabledSources = this.sources.filter((s) => s.enable(query));

        // 并行执行所有 Source
        const results = await Promise.all(
            enabledSources.map(async (source) => {
                return this.runComponent('Source', source.name, () =>
                    source.getCandidates(query)
                )
                    .then((candidates) =>
                        (candidates || []).map((candidate) =>
                            this.annotateRecallSource(candidate, source.name)
                        )
                    )
                    .catch((error) => {
                        if (error instanceof CircuitBreakerOpenError) {
                            log.warn(`[Source ${source.name}] Skipped (circuit breaker open)`);
                            this.runtimeMetrics.fallbackCount++;
                        } else if (error instanceof ComponentTimeoutError) {
                            log.warn(`[Source ${source.name}] Timed out after ${error.timeoutMs}ms — returning empty`);
                            this.runtimeMetrics.fallbackCount++;
                        } else {
                            log.error(`[Source ${source.name}] Error: ${error}`);
                        }
                        return [] as C[];
                    });
            })
        );

        // 合并所有来源的候选集
        return results.flat();
    }

    /**
     * 3. Candidate Hydration - 丰富候选者数据
     * 复刻 hydrate()
     */
    private async hydrateCandidates(
        query: Q,
        candidates: C[],
        _ctx: PipelineContext
    ): Promise<C[]> {
        return this.hydrateCandidatesWith(query, candidates, this.hydrators, 'Hydrator');
    }

    private async hydrateCandidatesWith(
        query: Q,
        candidates: C[],
        hydrators: Hydrator<Q, C>[],
        stage: string
    ): Promise<C[]> {
        if (candidates.length === 0) return candidates;

        const enabledHydrators = hydrators.filter((h) => h.enable(query));
        if (enabledHydrators.length === 0) return candidates;

        const results = await Promise.all(
            enabledHydrators.map(async (hydrator) => {
                return this.runComponent(stage, hydrator.name, () =>
                    hydrator.hydrate(query, candidates)
                ).catch((error) => {
                    log.error(`[${stage} ${hydrator.name}] Error: ${error}`);
                    return candidates;
                });
            })
        );

        let mergedCandidates = [...candidates];
        for (let i = 0; i < enabledHydrators.length; i++) {
            const hydratedCandidates = results[i];
            if (!hydratedCandidates || hydratedCandidates.length !== mergedCandidates.length) {
                log.warn(`[${stage} ${enabledHydrators[i].name}] length mismatch, skip update`);
                continue;
            }
            for (let j = 0; j < mergedCandidates.length; j++) {
                mergedCandidates[j] = enabledHydrators[i].update(
                    mergedCandidates[j],
                    hydratedCandidates[j]
                );
            }
        }

        return mergedCandidates;
    }

    /**
     * 4. Filtering - 过滤候选集
     * 复刻 filter()
     * 注意: Filter 是顺序执行的
     */
    private async filterCandidates(
        query: Q,
        candidates: C[],
        _ctx: PipelineContext
    ): Promise<FilterResult<C>> {
        return this.filterCandidatesWith(query, candidates, this.filters, 'Filter');
    }

    private async filterCandidatesWith(
        query: Q,
        candidates: C[],
        filters: Filter<Q, C>[],
        stage: string
    ): Promise<FilterResult<C>> {
        let kept = candidates;
        const allRemoved: C[] = [];

        for (const filter of filters) {
            if (!filter.enable(query)) continue;

            try {
                const result = await this.runComponent(stage, filter.name, () =>
                    filter.filter(query, kept)
                );
                kept = result.kept;
                allRemoved.push(...result.removed);
            } catch (error) {
                log.error(`[${stage} ${filter.name}] Error: ${error}`);
                // 出错时保留所有候选
            }
        }

        return { kept, removed: allRemoved };
    }

    /**
     * 6. Post-score Filters - 在评分后运行（依赖 candidate.score）
     */
    private async postFilterCandidates(
        query: Q,
        scoredCandidates: ScoredCandidate<C>[],
        _ctx: PipelineContext
    ): Promise<{ kept: ScoredCandidate<C>[]; removed: C[] }> {
        if (this.postFilters.length === 0) {
            return { kept: scoredCandidates, removed: [] };
        }

        // 将 scoredCandidates 转为候选者数组传递给 Filter
        let candidates = scoredCandidates.map((sc) => sc.candidate);

        for (const filter of this.postFilters) {
            if (!filter.enable(query)) continue;
            try {
                const result = await this.runComponent('PostFilter', filter.name, () =>
                    filter.filter(query, candidates)
                );
                candidates = result.kept;
            } catch (error) {
                log.error(`[PostFilter ${filter.name}] Error: ${error}`);
            }
        }

        // 根据过滤后的候选者，回写对应的 ScoredCandidate
        const keptSet = new Set(candidates.map((c: any) => (c as any)?.postId?.toString?.() || c));
        const keptScored = scoredCandidates.filter((sc: any) =>
            keptSet.has(sc.candidate?.postId?.toString?.() || sc.candidate)
        );
        const removed = scoredCandidates
            .filter((sc: any) => !keptSet.has(sc.candidate?.postId?.toString?.() || sc.candidate))
            .map((sc) => sc.candidate);
        return { kept: keptScored, removed };
    }

    /**
     * 5. Scoring - 计算分数
     * 复刻 score()
     * 注意: Scorer 是顺序执行的 (后续 Scorer 可能依赖前序结果)
     */
    private async scoreCandidates(
        query: Q,
        candidates: C[],
        _ctx: PipelineContext
    ): Promise<ScoredCandidate<C>[]> {
        if (candidates.length === 0) return [];

        // 初始化带分数的候选者
        let scoredCandidates: ScoredCandidate<C>[] = candidates.map((c) => ({
            candidate: c,
            score: 0,
            scoreBreakdown: {},
        }));

        for (const scorer of this.scorers) {
            if (!scorer.enable(query)) continue;

            try {
                const scored = await this.runComponent('Scorer', scorer.name, () =>
                    scorer.score(query, scoredCandidates.map((sc) => sc.candidate))
                );

                if (!scored || scored.length !== scoredCandidates.length) {
                    log.warn(`[Scorer ${scorer.name}] length mismatch, skip update`);
                    continue;
                }

                // 合并评分结果
                for (let i = 0; i < scoredCandidates.length; i++) {
                    scoredCandidates[i].candidate = scorer.update(
                        scoredCandidates[i].candidate,
                        scored[i]
                    );
                    scoredCandidates[i].score = scored[i].score;
                    if (scored[i].scoreBreakdown) {
                        scoredCandidates[i].scoreBreakdown = {
                            ...scoredCandidates[i].scoreBreakdown,
                            ...scored[i].scoreBreakdown,
                        };
                    }
                }
            } catch (error) {
                log.error(`[Scorer ${scorer.name}] Error: ${error}`);
            }
        }

        return scoredCandidates;
    }

    /**
     * 6. Selection - 排序和截断
     * 复刻 select()
     */
    private selectCandidates(
        query: Q,
        scoredCandidates: ScoredCandidate<C>[],
        _ctx: PipelineContext
    ): C[] {
        let selected: C[];
        if (!this.selector || !this.selector.enable(query)) {
            // 默认: 按分数降序排序，截取 defaultResultSize
            selected = scoredCandidates
                .sort((a, b) => b.score - a.score)
                .slice(0, this.config.defaultResultSize)
                .map((sc) => sc.candidate);
        } else {
            selected = this.selector.select(query, scoredCandidates);
        }

        if (this.isScoreDebugEnabled()) {
            return this.attachDebugScoreMetadata(selected, scoredCandidates);
        }

        return selected;
    }

    /**
     * 7. Side Effects - 异步执行副作用
     * 复刻 run_side_effects()
     */
    private runSideEffects(
        query: Q,
        selectedCandidates: C[],
        _ctx: PipelineContext
    ): void {
        for (const sideEffect of this.sideEffects) {
            if (!sideEffect.enable(query)) continue;

            // 异步执行，不等待
            sideEffect.run(query, selectedCandidates).catch((error) => {
                log.error(`[SideEffect ${sideEffect.name}] Error: ${error}`);
            });
        }
    }

    // ============================================
    // 调试辅助
    // ============================================

    private logPipelineResult(
        ctx: PipelineContext,
        timing: PipelineResult<C>['timing'],
        retrievedCount: number,
        filteredCount: number,
        postFilteredCount: number,
        selectedCount: number
    ): void {
        log.info(`[Pipeline ${ctx.requestId}] Completed:
      - Retrieved: ${retrievedCount}
      - Filtered (pre-score): ${filteredCount}
      - Filtered (post-score): ${postFilteredCount}
      - Selected: ${selectedCount}
      - Total time: ${timing.total}ms
        - Sourcing: ${timing.sourcing}ms
        - Hydrating: ${timing.hydrating}ms
        - Filtering: ${timing.filtering}ms
        - Scoring: ${timing.scoring}ms
        - Selecting: ${timing.selecting}ms`);

        if (this.config.captureComponentMetrics && this.componentMetrics.length > 0) {
            log.info(`[Pipeline ${ctx.requestId}] Component metrics: ${JSON.stringify(this.componentMetrics, null, 2)}`);
        }
    }

    /**
     * 包装组件调用，记录耗时、错误、超时，集成熔断器
     */
    private async runComponent<T>(
        stage: string,
        name: string,
        fn: () => Promise<T>
    ): Promise<T> {
        const componentKey = `${stage}:${name}`;

        // Circuit breaker check
        if (!this.circuitBreaker.canExecute(componentKey)) {
            log.debug(`[CircuitBreaker] Skipping ${componentKey} (circuit open)`);
            if (this.config.captureComponentMetrics) {
                this.componentMetrics.push({
                    stage,
                    name,
                    durationMs: 0,
                    circuitBreakerSkipped: true,
                });
            }
            throw new CircuitBreakerOpenError(componentKey);
        }

        const start = Date.now();
        let timedOut = false;
        let error: unknown;
        const timeoutMs = this.config.componentTimeoutMs;

        const runner = fn().catch((e) => {
            error = e;
            throw e;
        });

        const result = timeoutMs
            ? Promise.race([
                  runner,
                  new Promise<never>((_, reject) => {
                      setTimeout(() => {
                          timedOut = true;
                          this.runtimeMetrics.timeoutCount++;
                          reject(new ComponentTimeoutError(name, timeoutMs));
                      }, timeoutMs);
                  }),
              ])
            : runner;

        try {
            const value = await result;
            this.circuitBreaker.recordSuccess(componentKey);
            return value;
        } catch (err) {
            // Both timeouts and runtime errors count as failures for the circuit breaker
            this.circuitBreaker.recordFailure(componentKey);

            // Track if this failure just tripped the circuit open
            if (!this.circuitBreaker.canExecute(componentKey)) {
                this.runtimeMetrics.circuitBreakerTrips++;
            }

            throw err;
        } finally {
            const duration = Date.now() - start;
            if (this.config.captureComponentMetrics) {
                this.componentMetrics.push({
                    stage,
                    name,
                    durationMs: duration,
                    timedOut: timedOut || undefined,
                    error: error ? String(error) : undefined,
                });
            }
        }
    }

    private annotateRecallSource(candidate: C, sourceName: string): C {
        if (!candidate || typeof candidate !== 'object') return candidate;
        const asObj = candidate as any;
        if (typeof asObj.recallSource === 'string' && asObj.recallSource.length > 0) {
            return candidate;
        }
        return {
            ...asObj,
            recallSource: sourceName,
        } as C;
    }

    private isScoreDebugEnabled(): boolean {
        if (this.config.debug) return true;
        const raw = String(process.env.RECSYS_DEBUG_SCORE_BREAKDOWN || '').toLowerCase();
        return raw === 'true' || raw === '1' || raw === 'yes';
    }

    private attachDebugScoreMetadata(
        selected: C[],
        scoredCandidates: ScoredCandidate<C>[]
    ): C[] {
        const byRef = new Map<any, ScoredCandidate<C>>();
        for (const sc of scoredCandidates) {
            byRef.set(sc.candidate as any, sc);
        }

        return selected.map((candidate) => {
            if (!candidate || typeof candidate !== 'object') return candidate;
            const scored = byRef.get(candidate as any);
            if (!scored) return candidate;
            return {
                ...(candidate as any),
                _scoreBreakdown: scored.scoreBreakdown,
                _pipelineScore: scored.score,
            } as C;
        });
    }
}
