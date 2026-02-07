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
} from './interfaces';
import { v4 as uuidv4 } from 'uuid';

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

    private config: PipelineConfig = {
        defaultResultSize: 20,
        maxCandidates: 1000,
        debug: false,
        onMetrics: undefined,
        componentTimeoutMs: undefined,
        captureComponentMetrics: true,
    };

    constructor(config?: Partial<PipelineConfig>) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
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
     */
    async execute(query: Q): Promise<PipelineResult<C>> {
        const queryRequestId = (query as any)?.requestId;
        const ctx: PipelineContext = {
            requestId: typeof queryRequestId === 'string' && queryRequestId.length > 0
                ? queryRequestId
                : uuidv4(),
            startTime: Date.now(),
        };

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
            const queryStart = Date.now();
            const hydratedQuery = await this.hydrateQuery(query, ctx);
            timing.hydrating = Date.now() - queryStart;

            // 2. Sourcing (并行执行)
            const sourceStart = Date.now();
            let candidates = await this.fetchCandidates(hydratedQuery, ctx);
            timing.sourcing = Date.now() - sourceStart;

            // 限制最大候选数
            if (candidates.length > this.config.maxCandidates) {
                candidates = candidates.slice(0, this.config.maxCandidates);
            }

            const retrievedCount = candidates.length;

            // 3. Candidate Hydration (并行执行)
            const hydrateStart = Date.now();
            candidates = await this.hydrateCandidates(hydratedQuery, candidates, ctx);
            timing.hydrating += Date.now() - hydrateStart;

            // 4. Filtering (顺序执行)
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
            const scoreStart = Date.now();
            const scoredCandidates = await this.scoreCandidates(
                hydratedQuery,
                kept,
                ctx
            );
            timing.scoring = Date.now() - scoreStart;

            // 6. Post-score Filters (顺序执行，使用 candidate.score)
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
            const selectStart = Date.now();
            const selectedCandidates = this.selectCandidates(
                hydratedQuery,
                postFilteredCandidates,
                ctx
            );
            timing.selecting = Date.now() - selectStart;

            // 8. Post-selection Hydration + Filtering (e.g., VF)
            let finalCandidates = selectedCandidates;

            if (this.postSelectionHydrators.length > 0) {
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
            if (this.postSelectionFilters.length > 0 && finalCandidates.length > 0) {
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
            this.config.onMetrics?.({
                requestId: ctx.requestId,
                timing,
                counts: {
                    retrieved: retrievedCount,
                    filtered: filteredCount,
                    postFiltered: postFilteredCount,
                    postSelectionFiltered: postSelectionFilteredCount,
                    selected: finalCandidates.length,
                },
                components: this.config.captureComponentMetrics ? this.componentMetrics : undefined,
            });

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
            console.error(`[Pipeline ${ctx.requestId}] Error:`, error);
            throw error;
        } finally {
            this.componentMetrics = [];
        }
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
                    console.error(`[QueryHydrator ${hydrator.name}] Error:`, error);
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
     */
    private async fetchCandidates(query: Q, _ctx: PipelineContext): Promise<C[]> {
        const enabledSources = this.sources.filter((s) => s.enable(query));

        // 并行执行所有 Source
        const results = await Promise.all(
            enabledSources.map(async (source) => {
                return this.runComponent('Source', source.name, () =>
                    source.getCandidates(query)
                ).catch((error) => {
                    console.error(`[Source ${source.name}] Error:`, error);
                    return [];
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
                    console.error(`[${stage} ${hydrator.name}] Error:`, error);
                    return candidates;
                });
            })
        );

        let mergedCandidates = [...candidates];
        for (let i = 0; i < enabledHydrators.length; i++) {
            const hydratedCandidates = results[i];
            if (!hydratedCandidates || hydratedCandidates.length !== mergedCandidates.length) {
                console.warn(`[${stage} ${enabledHydrators[i].name}] length mismatch, skip update`);
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
                console.error(`[${stage} ${filter.name}] Error:`, error);
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
                console.error(`[PostFilter ${filter.name}] Error:`, error);
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
                    console.warn(`[Scorer ${scorer.name}] length mismatch, skip update`);
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
                console.error(`[Scorer ${scorer.name}] Error:`, error);
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
        if (!this.selector || !this.selector.enable(query)) {
            // 默认: 按分数降序排序，截取 defaultResultSize
            return scoredCandidates
                .sort((a, b) => b.score - a.score)
                .slice(0, this.config.defaultResultSize)
                .map((sc) => sc.candidate);
        }

        return this.selector.select(query, scoredCandidates);
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
                console.error(`[SideEffect ${sideEffect.name}] Error:`, error);
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
        console.log(`[Pipeline ${ctx.requestId}] Completed:
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
            console.log(
                `[Pipeline ${ctx.requestId}] Component metrics:`,
                JSON.stringify(this.componentMetrics, null, 2)
            );
        }
    }

    /**
     * 包装组件调用，记录耗时、错误、超时
     */
    private async runComponent<T>(
        stage: string,
        name: string,
        fn: () => Promise<T>
    ): Promise<T> {
        const start = Date.now();
        let timedOut = false;
        let error: any;
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
                          reject(new Error(`Component ${name} timed out`));
                      }, timeoutMs);
                  }),
              ])
            : runner;

        try {
            return await result;
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
}
