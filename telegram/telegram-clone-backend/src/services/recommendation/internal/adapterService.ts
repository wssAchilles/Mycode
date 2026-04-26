import type { Filter, Hydrator, QueryHydrator, ScoredCandidate, Scorer, Source } from '../framework';
import type { FeedCandidate } from '../types/FeedCandidate';
import type { FeedQuery } from '../types/FeedQuery';
import {
  buildRecommendationFilters,
  buildRecommendationHydrators,
  buildRecommendationPostSelectionFilters,
  buildRecommendationPostSelectionHydrators,
  buildRecommendationQueryHydratorCatalog,
  buildRecommendationQueryHydrators,
  buildRecommendationScorerCatalog,
  buildRecommendationScorers,
  buildRecommendationSourceCatalog,
  buildRecommendationSourceOrder,
  isMlRankingScorerName,
  isMlRetrievalSourceName,
} from './componentCatalog';
import type { RecommendationQueryPatchPayload } from '../rust/contracts';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';
import { mergeSourceCandidates, type SourceCandidateBatch } from './merge/candidateMerge';

export interface InternalStageExecution {
  name: string;
  enabled: boolean;
  durationMs: number;
  inputCount: number;
  outputCount: number;
  removedCount?: number;
  detail?: Record<string, unknown>;
}

export interface InternalCandidatesExecutionResult {
  candidates: FeedCandidate[];
  stages: InternalStageExecution[];
}

export interface InternalFilterExecutionResult extends InternalCandidatesExecutionResult {
  removed: FeedCandidate[];
  dropCounts: Record<string, number>;
}

export interface InternalRetrievalExecutionSummary {
  stage: string;
  totalCandidates: number;
  inNetworkCandidates: number;
  outOfNetworkCandidates: number;
  mlRetrievedCandidates: number;
  recentHotCandidates: number;
  sourceCounts: Record<string, number>;
  laneCounts: Record<string, number>;
  mlSourceCounts: Record<string, number>;
  stageTimings: Record<string, number>;
  degradedReasons: string[];
  graph: {
    totalCandidates: number;
    kernelCandidates: number;
    legacyCandidates: number;
    fallbackUsed: boolean;
    emptyResult: boolean;
    kernelSourceCounts: Record<string, number>;
    dominantKernelSource?: string;
    emptyReason?: string;
  };
}

export interface InternalRetrievalExecutionResult extends InternalCandidatesExecutionResult {
  summary: InternalRetrievalExecutionSummary;
}

export interface InternalQueryHydratorBatchResult {
  items: Array<{
    hydratorName: string;
    queryPatch: RecommendationQueryPatchPayload;
    stage: InternalStageExecution;
    providerCalls: Record<string, number>;
    errorClass?: string;
  }>;
  providerCalls: Record<string, number>;
}

export interface InternalSourceBatchResult {
  items: Array<{
    sourceName: string;
    candidates: FeedCandidate[];
    stage: InternalStageExecution;
    timedOut: boolean;
    timeoutMs?: number;
    errorClass?: string;
  }>;
  providerCalls: Record<string, number>;
}

export interface InternalRankingExecutionSummary {
  stage: string;
  inputCandidates: number;
  hydratedCandidates: number;
  filteredCandidates: number;
  scoredCandidates: number;
  mlEligibleCandidates: number;
  mlRankedCandidates: number;
  weightedCandidates: number;
  stageTimings: Record<string, number>;
  filterDropCounts: Record<string, number>;
  degradedReasons: string[];
}

export interface InternalRankingExecutionResult extends InternalCandidatesExecutionResult {
  dropCounts: Record<string, number>;
  summary: InternalRankingExecutionSummary;
}

const QUERY_HYDRATOR_PATCH_OWNERSHIP: Record<
  string,
  Array<keyof RecommendationQueryPatchPayload>
> = {
  UserFeaturesQueryHydrator: ['userFeatures'],
  UserEmbeddingQueryHydrator: ['embeddingContext'],
  UserActionSeqQueryHydrator: ['userActionSequence'],
  UserStateQueryHydrator: ['userStateContext'],
  NewsModelContextQueryHydrator: ['newsHistoryExternalIds', 'modelUserActionSequence'],
  ExperimentQueryHydrator: ['experimentContext'],
};
const USER_STATE_QUERY_HYDRATOR = 'UserStateQueryHydrator';
const USER_STATE_DEPENDENCY_FIELDS: Array<keyof RecommendationQueryPatchPayload> = [
  'userFeatures',
  'embeddingContext',
  'userActionSequence',
];

const SOURCE_BATCH_COMPONENT_TIMEOUT_MS = Math.max(
  1,
  parseInt(String(process.env.RECOMMENDATION_SOURCE_BATCH_COMPONENT_TIMEOUT_MS || '1200'), 10) || 1200,
);
const CANDIDATE_HYDRATOR_CONCURRENCY = Math.max(
  1,
  parseInt(String(process.env.RECOMMENDATION_CANDIDATE_HYDRATOR_CONCURRENCY || '4'), 10) || 4,
);

export class RecommendationAdapterService {
  private readonly sourceCatalog = buildRecommendationSourceCatalog();
  private readonly queryHydratorCatalog = buildRecommendationQueryHydratorCatalog();
  private readonly scorerCatalog = buildRecommendationScorerCatalog();
  private readonly sourceBatchComponentTimeoutMs = SOURCE_BATCH_COMPONENT_TIMEOUT_MS;
  private readonly candidateHydratorConcurrency = CANDIDATE_HYDRATOR_CONCURRENCY;

  async hydrateQuery(query: FeedQuery): Promise<{ query: FeedQuery; stages: InternalStageExecution[] }> {
    let current = query;
    const stages: InternalStageExecution[] = [];

    for (const hydrator of buildRecommendationQueryHydrators()) {
      const start = Date.now();
      if (!hydrator.enable(current)) {
        stages.push({
          name: hydrator.name,
          enabled: false,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 1,
        });
        continue;
      }

      try {
        const hydrated = await hydrator.hydrate(current);
        current = hydrator.update(current, hydrated);
        stages.push({
          name: hydrator.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 1,
        });
      } catch (error: any) {
        stages.push({
          name: hydrator.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 1,
          detail: { error: error?.message || 'hydrate_query_failed' },
        });
      }
    }

    return { query: current, stages };
  }

  async hydrateQueryPatch(
    hydratorName: string,
    query: FeedQuery,
  ): Promise<{
    queryPatch: RecommendationQueryPatchPayload;
    stage: InternalStageExecution;
    errorClass?: string;
  }> {
    const hydrator = this.queryHydratorCatalog[hydratorName];
    if (!hydrator) {
      throw new Error(`unknown_query_hydrator:${hydratorName}`);
    }

    const ownedFields = QUERY_HYDRATOR_PATCH_OWNERSHIP[hydratorName];
    if (!ownedFields || ownedFields.length === 0) {
      throw new Error(`query_hydrator_ownership_missing:${hydratorName}`);
    }

    const start = Date.now();
    if (!hydrator.enable(query)) {
      return {
        queryPatch: {},
        stage: {
          name: hydrator.name,
          enabled: false,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 1,
          detail: { ownedFields },
        },
      };
    }

    try {
      const hydrated = await hydrator.hydrate(query);
      const nextQuery = hydrator.update(query, hydrated);

      const unauthorizedFields = readUnauthorizedQueryPatchFields(query, nextQuery, ownedFields);
      if (unauthorizedFields.length > 0) {
        throw new Error(
          `query_hydrator_contract_violation:${hydratorName}:${unauthorizedFields.join(',')}`,
        );
      }

      return {
        queryPatch: buildRecommendationQueryPatch(nextQuery, ownedFields),
        stage: {
          name: hydrator.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 1,
          detail: { ownedFields },
        },
      };
    } catch (error: any) {
      const errorClass = classifyQueryHydratorError(error?.message);
      return {
        queryPatch: {},
        errorClass,
        stage: {
          name: hydrator.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 1,
          detail: {
            ownedFields,
            error: error?.message || 'hydrate_query_patch_failed',
            errorClass,
          },
        },
      };
    }
  }

  async hydrateQueryPatches(
    hydratorNames: string[],
    query: FeedQuery,
  ): Promise<InternalQueryHydratorBatchResult> {
    const orderedHydrators = hydratorNames.map((hydratorName) => String(hydratorName || '').trim());
    const resultSlots = new Array<InternalQueryHydratorBatchResult['items'][number]>(
      orderedHydrators.length,
    );
    const independentEntries = orderedHydrators
      .map((hydratorName, index) => ({ hydratorName, index }))
      .filter((entry) => entry.hydratorName !== USER_STATE_QUERY_HYDRATOR);
    const userStateEntries = orderedHydrators
      .map((hydratorName, index) => ({ hydratorName, index }))
      .filter((entry) => entry.hydratorName === USER_STATE_QUERY_HYDRATOR);

    const independentItems = await Promise.all(
      independentEntries.map(async ({ hydratorName, index }) => ({
        index,
        item: {
          hydratorName,
          ...(await this.hydrateQueryPatch(hydratorName, query)),
          providerCalls: {},
        },
      })),
    );

    let dependentQuery = query;
    for (const { index, item } of independentItems.sort((left, right) => left.index - right.index)) {
      resultSlots[index] = item;
      dependentQuery = applyRecommendationQueryPatch(dependentQuery, item.queryPatch);
    }

    for (const { hydratorName, index } of userStateEntries) {
      const item = {
        hydratorName,
        ...(await this.hydrateQueryPatch(hydratorName, dependentQuery)),
        providerCalls: {},
      };
      item.stage.detail = {
        ...(item.stage.detail || {}),
        dependencyMode: 'after_feature_action_embedding_patches',
        dependencyFields: USER_STATE_DEPENDENCY_FIELDS,
      };
      resultSlots[index] = item;
      dependentQuery = applyRecommendationQueryPatch(dependentQuery, item.queryPatch);
    }

    return {
      items: resultSlots.filter(Boolean),
      providerCalls: {},
    };
  }

  async getSourceCandidates(
    sourceName: string,
    query: FeedQuery,
  ): Promise<{
    candidates: FeedCandidate[];
    stage: InternalStageExecution;
    timedOut: boolean;
    timeoutMs?: number;
    errorClass?: string;
  }> {
    const source = this.sourceCatalog[sourceName];
    if (!source) {
      throw new Error(`unknown_source:${sourceName}`);
    }

    const start = Date.now();
    if (!source.enable(query)) {
      return {
        candidates: [],
        timedOut: false,
        stage: {
          name: source.name,
          enabled: false,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 0,
        },
      };
    }

    try {
      const candidates = await source.getCandidates(query);
      const detail: Record<string, unknown> = {
        recallSource: source.name,
      };

      if (source.name === 'GraphSource') {
        Object.assign(detail, summarizeGraphCandidates(candidates));
      }

      return {
        candidates,
        timedOut: false,
        stage: {
          name: source.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: candidates.length,
          detail,
        },
      };
    } catch (error: any) {
      const errorClass = classifySourceError(error?.message);
      return {
        candidates: [],
        timedOut: false,
        errorClass,
        stage: {
          name: source.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 0,
          detail: { error: error?.message || 'source_failed', errorClass },
        },
      };
    }
  }

  private async getSourceCandidatesBounded(
    sourceName: string,
    query: FeedQuery,
  ): Promise<{
    candidates: FeedCandidate[];
    stage: InternalStageExecution;
    timedOut: boolean;
    timeoutMs?: number;
    errorClass?: string;
  }> {
    const timeoutMs = this.sourceBatchComponentTimeoutMs;

    const timeoutResult = new Promise<{
      candidates: FeedCandidate[];
      stage: InternalStageExecution;
      timedOut: boolean;
      timeoutMs?: number;
      errorClass?: string;
    }>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          candidates: [],
          timedOut: true,
          timeoutMs,
          errorClass: 'source_timeout',
          stage: {
            name: sourceName,
            enabled: true,
            durationMs: timeoutMs,
            inputCount: 1,
            outputCount: 0,
            detail: {
              error: `source_timeout:${timeoutMs}`,
              errorClass: 'source_timeout',
              timedOut: true,
              timeoutMs,
            },
          },
        });
      }, timeoutMs);

      if (typeof (timer as NodeJS.Timeout).unref === 'function') {
        timer.unref();
      }
    });

    return Promise.race([
      this.getSourceCandidates(sourceName, query),
      timeoutResult,
    ]);
  }

  async getSourceCandidatesBatch(
    sourceNames: string[],
    query: FeedQuery,
  ): Promise<InternalSourceBatchResult> {
    const orderedSourceNames = sourceNames.map((sourceName) => String(sourceName || '').trim());
    const items = await Promise.all(
      orderedSourceNames.map(async (sourceName) => ({
        sourceName,
        ...(await this.getSourceCandidatesBounded(sourceName, query)),
      })),
    );

    return {
      items,
      providerCalls: {},
    };
  }

  async retrieveCandidates(query: FeedQuery): Promise<InternalRetrievalExecutionResult> {
    const stages: InternalStageExecution[] = [];
    const sourceCounts: Record<string, number> = {};
    const mlSourceCounts: Record<string, number> = {};
    const stageTimings: Record<string, number> = {};
    const degradedReasons = new Set<string>();
    const sourceBatches: SourceCandidateBatch[] = [];

    for (const sourceName of buildRecommendationSourceOrder()) {
      const { candidates: sourceCandidates, stage } = await this.getSourceCandidates(sourceName, query);
      const normalizedCandidates = sourceCandidates.map((candidate) => ({
        ...candidate,
        recallSource: candidate.recallSource || sourceName,
        retrievalLane: candidate.retrievalLane || sourceRetrievalLane(sourceName),
      }));

      stages.push(stage);
      sourceCounts[sourceName] = normalizedCandidates.length;
      stageTimings[sourceName] = stage.durationMs;

      if (isMlRetrievalSourceName(sourceName)) {
        mlSourceCounts[sourceName] = normalizedCandidates.length;
      }

      const stageError = this.readStageError(stage);
      if (stageError) {
        degradedReasons.add(`retrieval:${sourceName}:${stageError}`);
      }

      sourceBatches.push({ sourceName, candidates: normalizedCandidates });
    }

    const mergeStart = Date.now();
    const mergeResult = mergeSourceCandidates(query, sourceBatches, buildRecommendationSourceOrder());
    stages.push({
      name: 'LaneMerge',
      enabled: true,
      durationMs: Date.now() - mergeStart,
      inputCount: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
      outputCount: mergeResult.candidates.length,
      removedCount: Number(mergeResult.detail.duplicateRecallHits || 0),
      detail: mergeResult.detail,
    });
    stageTimings.LaneMerge = Date.now() - mergeStart;

    return {
      candidates: mergeResult.candidates,
      stages,
      summary: {
        stage: 'retrieval_v1',
        totalCandidates: mergeResult.candidates.length,
        inNetworkCandidates: mergeResult.candidates.filter((candidate) => Boolean(candidate.inNetwork)).length,
        outOfNetworkCandidates: mergeResult.candidates.filter((candidate) => !candidate.inNetwork).length,
        mlRetrievedCandidates: Object.values(mlSourceCounts).reduce((sum, count) => sum + count, 0),
        recentHotCandidates: 0,
        sourceCounts,
        laneCounts: mergeResult.laneCounts,
        mlSourceCounts,
        stageTimings,
        degradedReasons: Array.from(degradedReasons),
        graph: summarizeGraphCandidates(
          mergeResult.candidates.filter((candidate) => {
            const graphRecallType = (candidate as FeedCandidate & { graphRecallType?: string }).graphRecallType;
            return candidate.recallSource === 'GraphSource'
              || candidate.recallSource === 'GraphKernelSource'
              || (typeof graphRecallType === 'string' && graphRecallType.length > 0);
          }),
        ),
      },
    };
  }

  async hydrateCandidates(
    query: FeedQuery,
    candidates: FeedCandidate[],
  ): Promise<InternalCandidatesExecutionResult> {
    return this.runHydrators(query, candidates, buildRecommendationHydrators());
  }

  async filterCandidates(
    query: FeedQuery,
    candidates: FeedCandidate[],
  ): Promise<InternalFilterExecutionResult> {
    return this.runFilters(query, candidates, buildRecommendationFilters());
  }

  async scoreCandidates(
    query: FeedQuery,
    candidates: FeedCandidate[],
    componentNames?: string[],
  ): Promise<InternalCandidatesExecutionResult> {
    let current: ScoredCandidate<FeedCandidate>[] = candidates.map((candidate) => ({
      candidate,
      score: candidate.score ?? 0,
      scoreBreakdown: candidate._scoreBreakdown || {},
    }));
    const stages: InternalStageExecution[] = [];
    const scorers = this.resolveScorers(componentNames);

    for (const scorer of scorers) {
      const start = Date.now();
      if (!scorer.enable(query)) {
        stages.push({
          name: scorer.name,
          enabled: false,
          durationMs: Date.now() - start,
          inputCount: current.length,
          outputCount: current.length,
        });
        continue;
      }

      try {
        const scored = await scorer.score(
          query,
          current.map((item) => item.candidate),
        );
        if (scored.length === current.length) {
          for (let index = 0; index < current.length; index += 1) {
            current[index].candidate = scorer.update(current[index].candidate, scored[index]);
            current[index].score = scored[index].score;
            current[index].scoreBreakdown = {
              ...(current[index].scoreBreakdown || {}),
              ...(scored[index].scoreBreakdown || {}),
            };

            const candidate = current[index].candidate as FeedCandidate & {
              _scoreBreakdown?: Record<string, number>;
              _pipelineScore?: number;
            };
            candidate._scoreBreakdown = {
              ...(candidate._scoreBreakdown || {}),
              ...(current[index].scoreBreakdown || {}),
            };
            candidate._pipelineScore = current[index].score;
            current[index].candidate = candidate;
          }
        }

        stages.push({
          name: scorer.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: current.length,
          outputCount: current.length,
        });
      } catch (error: any) {
        stages.push({
          name: scorer.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: current.length,
          outputCount: current.length,
          detail: { error: error?.message || 'scorer_failed' },
        });
      }
    }

    return {
      candidates: current.map((item) => item.candidate),
      stages,
    };
  }

  async rankCandidates(
    query: FeedQuery,
    candidates: FeedCandidate[],
  ): Promise<InternalRankingExecutionResult> {
    const inputCandidates = candidates.length;
    const hydrateResult = await this.hydrateCandidates(query, candidates);
    const filterResult = await this.filterCandidates(query, hydrateResult.candidates);
    const scoreResult = await this.scoreCandidates(query, filterResult.candidates);
    const stages = [
      ...hydrateResult.stages,
      ...filterResult.stages,
      ...scoreResult.stages,
    ];
    const stageTimings: Record<string, number> = {};
    const degradedReasons = new Set<string>();

    for (const stage of stages) {
      stageTimings[stage.name] = stage.durationMs;
      const stageError = this.readStageError(stage);
      if (stageError) {
        degradedReasons.add(`ranking:${stage.name}:${stageError}`);
      }
    }

    const socialPhoenixEnabled = getSpaceFeedExperimentFlag(
      query,
      'enable_social_phoenix_scorer',
      true,
    );
    const mlEligibleCandidates = filterResult.candidates.filter((candidate) =>
      (Boolean(candidate.isNews) && Boolean(candidate.modelPostId || candidate.newsMetadata?.externalId)) ||
      (socialPhoenixEnabled && !candidate.isNews),
    ).length;
    const mlRankedCandidates = scoreResult.candidates.filter((candidate) =>
      Boolean(candidate.phoenixScores),
    ).length;
    const weightedCandidates = scoreResult.candidates.filter((candidate) =>
      typeof candidate.weightedScore === 'number',
    ).length;

    const phoenixStage = scoreResult.stages.find((stage) => isMlRankingScorerName(stage.name));
    if (phoenixStage?.enabled && mlEligibleCandidates > 0 && mlRankedCandidates === 0) {
      degradedReasons.add('ranking:PhoenixScorer:empty_ml_ranking');
    }

    return {
      candidates: scoreResult.candidates,
      stages,
      dropCounts: filterResult.dropCounts,
      summary: {
        stage: 'ranking_v1',
        inputCandidates,
        hydratedCandidates: hydrateResult.candidates.length,
        filteredCandidates: filterResult.candidates.length,
        scoredCandidates: scoreResult.candidates.length,
        mlEligibleCandidates,
        mlRankedCandidates,
        weightedCandidates,
        stageTimings,
        filterDropCounts: filterResult.dropCounts,
        degradedReasons: Array.from(degradedReasons),
      },
    };
  }

  private resolveScorers(componentNames?: string[]): Scorer<FeedQuery, FeedCandidate>[] {
    if (!componentNames || componentNames.length === 0) {
      return buildRecommendationScorers();
    }

    const orderedNames = componentNames
      .map((name) => String(name || '').trim())
      .filter((name) => name.length > 0);
    const unknownNames = orderedNames.filter((name) => !this.scorerCatalog[name]);
    if (unknownNames.length > 0) {
      throw new Error(`unknown_scorer:${unknownNames.join(',')}`);
    }

    return orderedNames.map((name) => this.scorerCatalog[name]);
  }

  async hydratePostSelectionCandidates(
    query: FeedQuery,
    candidates: FeedCandidate[],
  ): Promise<InternalCandidatesExecutionResult> {
    return this.runHydrators(query, candidates, buildRecommendationPostSelectionHydrators());
  }

  async filterPostSelectionCandidates(
    query: FeedQuery,
    candidates: FeedCandidate[],
  ): Promise<InternalFilterExecutionResult> {
    return this.runFilters(query, candidates, buildRecommendationPostSelectionFilters());
  }

  private async runHydrators(
    query: FeedQuery,
    candidates: FeedCandidate[],
    hydrators: Hydrator<FeedQuery, FeedCandidate>[],
  ): Promise<InternalCandidatesExecutionResult> {
    const baseCandidates = candidates.slice();
    let current = baseCandidates.slice();
    const stages = await this.runParallelBounded(
      hydrators,
      this.candidateHydratorConcurrency,
      async (hydrator) => {
        const start = Date.now();
        const inputCount = baseCandidates.length;
        const stageDetail: Record<string, unknown> = {
          executionMode: 'parallel_bounded',
          concurrency: this.candidateHydratorConcurrency,
          mergeMode: 'stable_order',
        };

        if (!hydrator.enable(query)) {
          return {
            hydrated: null,
            stage: {
              name: hydrator.name,
              enabled: false,
              durationMs: Date.now() - start,
              inputCount,
              outputCount: inputCount,
              detail: stageDetail,
            },
          };
        }

        try {
          const hydrated = await hydrator.hydrate(query, baseCandidates);
          if (hydrated.length !== inputCount) {
            const error = `hydrator_contract_violation:${hydrator.name}:length_mismatch:${inputCount}:${hydrated.length}`;
            const errorClass = classifyCandidateHydratorError(error);
            return {
              hydrated: null,
              stage: {
                name: hydrator.name,
                enabled: true,
                durationMs: Date.now() - start,
                inputCount,
                outputCount: inputCount,
                detail: {
                  ...stageDetail,
                  error,
                  errorClass,
                  hydratedCount: hydrated.length,
                },
              },
            };
          }

          return {
            hydrated,
            stage: {
              name: hydrator.name,
              enabled: true,
              durationMs: Date.now() - start,
              inputCount,
              outputCount: inputCount,
              detail: stageDetail,
            },
          };
        } catch (error: any) {
          const message = error?.message || 'hydrator_failed';
          const errorClass = classifyCandidateHydratorError(message);
          return {
            hydrated: null,
            stage: {
              name: hydrator.name,
              enabled: true,
              durationMs: Date.now() - start,
              inputCount,
              outputCount: inputCount,
              detail: {
                ...stageDetail,
                error: message,
                errorClass,
              },
            },
          };
        }
      },
    );

    for (const [index, result] of stages.entries()) {
      if (!result.hydrated) {
        continue;
      }
      const hydrator = hydrators[index];
      current = current.map((candidate, candidateIndex) =>
        hydrator.update(candidate, result.hydrated![candidateIndex]),
      );
    }

    return {
      candidates: current,
      stages: stages.map((result) => result.stage),
    };
  }

  private async runParallelBounded<TItem, TResult>(
    items: TItem[],
    concurrency: number,
    worker: (item: TItem, index: number) => Promise<TResult>,
  ): Promise<TResult[]> {
    if (items.length === 0) {
      return [];
    }

    const limit = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array<TResult>(items.length);
    let nextIndex = 0;

    await Promise.all(
      Array.from({ length: limit }, async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= items.length) {
            return;
          }
          results[index] = await worker(items[index], index);
        }
      }),
    );

    return results;
  }

  private async runFilters(
    query: FeedQuery,
    candidates: FeedCandidate[],
    filters: Filter<FeedQuery, FeedCandidate>[],
  ): Promise<InternalFilterExecutionResult> {
    let kept = candidates.slice();
    const removed: FeedCandidate[] = [];
    const dropCounts: Record<string, number> = {};
    const stages: InternalStageExecution[] = [];

    for (const filter of filters) {
      const start = Date.now();
      if (!filter.enable(query)) {
        stages.push({
          name: filter.name,
          enabled: false,
          durationMs: Date.now() - start,
          inputCount: kept.length,
          outputCount: kept.length,
          removedCount: 0,
        });
        continue;
      }

      const inputCount = kept.length;
      try {
        const result = await filter.filter(query, kept);
        kept = result.kept;
        removed.push(...result.removed);
        dropCounts[filter.name] = result.removed.length;
        stages.push({
          name: filter.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount,
          outputCount: kept.length,
          removedCount: result.removed.length,
        });
      } catch (error: any) {
        stages.push({
          name: filter.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount,
          outputCount: kept.length,
          removedCount: 0,
          detail: { error: error?.message || 'filter_failed' },
        });
      }
    }

    return {
      candidates: kept,
      removed,
      dropCounts,
      stages,
    };
  }

  private readStageError(stage: InternalStageExecution): string | undefined {
    const error = stage.detail?.error;
    if (typeof error === 'string' && error.trim().length > 0) {
      return error.trim();
    }
    return undefined;
  }
}

function buildRecommendationQueryPatch(
  query: FeedQuery,
  ownedFields: Array<keyof RecommendationQueryPatchPayload>,
): RecommendationQueryPatchPayload {
  const patch: RecommendationQueryPatchPayload = {};
  for (const field of ownedFields) {
    const value = query[field as keyof FeedQuery];
    if (value !== undefined) {
      (patch as Record<string, unknown>)[field] = value;
    }
  }
  return patch;
}

function applyRecommendationQueryPatch(
  query: FeedQuery,
  patch: RecommendationQueryPatchPayload,
): FeedQuery {
  const next: FeedQuery = { ...query };
  if (patch.userFeatures !== undefined) {
    next.userFeatures = {
      ...patch.userFeatures,
      accountCreatedAt: parseOptionalPatchDate(patch.userFeatures.accountCreatedAt),
    };
  }
  if (patch.embeddingContext !== undefined) {
    next.embeddingContext = {
      ...patch.embeddingContext,
      computedAt: parseOptionalPatchDate(patch.embeddingContext.computedAt),
    };
  }
  if (patch.userStateContext !== undefined) {
    next.userStateContext = patch.userStateContext;
  }
  if (patch.userActionSequence !== undefined) {
    next.userActionSequence = patch.userActionSequence as unknown as FeedQuery['userActionSequence'];
  }
  if (patch.newsHistoryExternalIds !== undefined) {
    next.newsHistoryExternalIds = patch.newsHistoryExternalIds;
  }
  if (patch.modelUserActionSequence !== undefined) {
    next.modelUserActionSequence =
      patch.modelUserActionSequence as unknown as FeedQuery['modelUserActionSequence'];
  }
  if (patch.experimentContext !== undefined) {
    next.experimentContext = patch.experimentContext as unknown as FeedQuery['experimentContext'];
  }
  if (patch.rankingPolicy !== undefined) {
    next.rankingPolicy = patch.rankingPolicy as FeedQuery['rankingPolicy'];
  }
  return next;
}

function parseOptionalPatchDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function readUnauthorizedQueryPatchFields(
  before: FeedQuery,
  after: FeedQuery,
  ownedFields: Array<keyof RecommendationQueryPatchPayload>,
): string[] {
  const knownPatchFields = Object.values(QUERY_HYDRATOR_PATCH_OWNERSHIP).flat();
  return knownPatchFields.filter((field) => {
    if (ownedFields.includes(field)) {
      return false;
    }
    return !sameSerializedValue(before[field as keyof FeedQuery], after[field as keyof FeedQuery]);
  });
}

function sameSerializedValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function classifyQueryHydratorError(message?: string): string {
  const value = String(message || '').trim();
  if (value.startsWith('query_hydrator_contract_violation')) {
    return 'provider_contract_error';
  }
  if (value.startsWith('unknown_query_hydrator')) {
    return 'unknown_query_hydrator';
  }
  return 'query_hydrator_failed';
}

function classifySourceError(message?: string): string {
  const value = String(message || '').trim();
  if (value.startsWith('source_timeout')) {
    return 'source_timeout';
  }
  if (value.startsWith('unknown_source')) {
    return 'unknown_source';
  }
  return 'source_failed';
}

function classifyCandidateHydratorError(message?: string): string {
  const value = String(message || '').trim();
  if (value.startsWith('hydrator_contract_violation')) {
    return 'provider_contract_error';
  }
  return 'candidate_hydrator_failed';
}

export const recommendationAdapterService = new RecommendationAdapterService();

function sourceRetrievalLane(sourceName: string): string {
  switch (sourceName) {
    case 'FollowingSource':
      return 'in_network';
    case 'GraphSource':
    case 'GraphKernelSource':
      return 'social_expansion';
    case 'TwoTowerSource':
    case 'EmbeddingAuthorSource':
    case 'NewsAnnSource':
      return 'interest';
    default:
      return 'fallback';
  }
}

function summarizeLaneCounts(candidates: FeedCandidate[]): Record<string, number> {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    const lane = candidate.retrievalLane || sourceRetrievalLane(candidate.recallSource || '');
    counts[lane] = (counts[lane] || 0) + 1;
    return counts;
  }, {});
}

function summarizeGraphCandidates(candidates: FeedCandidate[]): InternalRetrievalExecutionSummary['graph'] {
  const kernelCandidates = candidates.filter(isGraphKernelCandidate).length;
  const totalCandidates = candidates.length;
  const legacyCandidates = totalCandidates - kernelCandidates;
  const kernelSourceCounts: Record<string, number> = {};

  for (const candidate of candidates) {
    if (!isGraphKernelCandidate(candidate)) {
      continue;
    }
    const graphRecallType = (candidate as FeedCandidate & { graphRecallType?: string }).graphRecallType;
    const key = typeof graphRecallType === 'string' && graphRecallType.length > 0
      ? graphRecallType
      : 'cpp_graph_unknown';
    kernelSourceCounts[key] = (kernelSourceCounts[key] || 0) + 1;
  }

  const dominantKernelSource = Object.entries(kernelSourceCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];

  return {
    totalCandidates,
    kernelCandidates,
    legacyCandidates,
    fallbackUsed: legacyCandidates > 0,
    emptyResult: totalCandidates === 0,
    kernelSourceCounts,
    dominantKernelSource,
    emptyReason: totalCandidates === 0 ? 'graph_candidates_empty' : undefined,
  };
}

function isGraphKernelCandidate(candidate: FeedCandidate): boolean {
  const graphRecallType = (candidate as FeedCandidate & { graphRecallType?: string }).graphRecallType;
  return candidate.recallSource === 'GraphKernelSource'
    || (typeof graphRecallType === 'string' && graphRecallType.startsWith('cpp_graph_'));
}
