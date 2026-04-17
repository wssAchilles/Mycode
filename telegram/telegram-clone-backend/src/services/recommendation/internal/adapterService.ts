import type { Filter, Hydrator, QueryHydrator, ScoredCandidate, Scorer, Source } from '../framework';
import type { FeedCandidate } from '../types/FeedCandidate';
import type { FeedQuery } from '../types/FeedQuery';
import {
  buildRecommendationFilters,
  buildRecommendationHydrators,
  buildRecommendationPostSelectionFilters,
  buildRecommendationPostSelectionHydrators,
  buildRecommendationQueryHydrators,
  buildRecommendationScorers,
  buildRecommendationSourceCatalog,
  buildRecommendationSourceOrder,
  isMlRankingScorerName,
  isMlRetrievalSourceName,
} from './componentCatalog';

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
  mlSourceCounts: Record<string, number>;
  stageTimings: Record<string, number>;
  degradedReasons: string[];
  graph: {
    totalCandidates: number;
    kernelCandidates: number;
    legacyCandidates: number;
    fallbackUsed: boolean;
    emptyResult: boolean;
  };
}

export interface InternalRetrievalExecutionResult extends InternalCandidatesExecutionResult {
  summary: InternalRetrievalExecutionSummary;
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

export class RecommendationAdapterService {
  private readonly sourceCatalog = buildRecommendationSourceCatalog();

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

  async getSourceCandidates(
    sourceName: string,
    query: FeedQuery,
  ): Promise<{ candidates: FeedCandidate[]; stage: InternalStageExecution }> {
    const source = this.sourceCatalog[sourceName];
    if (!source) {
      throw new Error(`unknown_source:${sourceName}`);
    }

    const start = Date.now();
    if (!source.enable(query)) {
      return {
        candidates: [],
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
      return {
        candidates: [],
        stage: {
          name: source.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: 0,
          detail: { error: error?.message || 'source_failed' },
        },
      };
    }
  }

  async retrieveCandidates(query: FeedQuery): Promise<InternalRetrievalExecutionResult> {
    const stages: InternalStageExecution[] = [];
    const sourceCounts: Record<string, number> = {};
    const mlSourceCounts: Record<string, number> = {};
    const stageTimings: Record<string, number> = {};
    const degradedReasons = new Set<string>();
    const candidates: FeedCandidate[] = [];

    for (const sourceName of buildRecommendationSourceOrder()) {
      const { candidates: sourceCandidates, stage } = await this.getSourceCandidates(sourceName, query);
      const normalizedCandidates = sourceCandidates.map((candidate) => ({
        ...candidate,
        recallSource: candidate.recallSource || sourceName,
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

      candidates.push(...normalizedCandidates);
    }

    return {
      candidates,
      stages,
      summary: {
        stage: 'retrieval_v1',
        totalCandidates: candidates.length,
        inNetworkCandidates: candidates.filter((candidate) => Boolean(candidate.inNetwork)).length,
        outOfNetworkCandidates: candidates.filter((candidate) => !candidate.inNetwork).length,
        mlRetrievedCandidates: Object.values(mlSourceCounts).reduce((sum, count) => sum + count, 0),
        recentHotCandidates: 0,
        sourceCounts,
        mlSourceCounts,
        stageTimings,
        degradedReasons: Array.from(degradedReasons),
        graph: summarizeGraphCandidates(
          candidates.filter((candidate) => {
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
  ): Promise<InternalCandidatesExecutionResult> {
    let current: ScoredCandidate<FeedCandidate>[] = candidates.map((candidate) => ({
      candidate,
      score: candidate.score ?? 0,
      scoreBreakdown: candidate._scoreBreakdown || {},
    }));
    const stages: InternalStageExecution[] = [];

    for (const scorer of buildRecommendationScorers()) {
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

    const mlEligibleCandidates = filterResult.candidates.filter((candidate) =>
      Boolean(candidate.isNews) && Boolean(candidate.modelPostId || candidate.newsMetadata?.externalId),
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
    let current = candidates.slice();
    const stages: InternalStageExecution[] = [];

    for (const hydrator of hydrators) {
      const start = Date.now();
      if (!hydrator.enable(query)) {
        stages.push({
          name: hydrator.name,
          enabled: false,
          durationMs: Date.now() - start,
          inputCount: current.length,
          outputCount: current.length,
        });
        continue;
      }

      try {
        const hydrated = await hydrator.hydrate(query, current);
        if (hydrated.length === current.length) {
          current = current.map((candidate, index) => hydrator.update(candidate, hydrated[index]));
        }
        stages.push({
          name: hydrator.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: candidates.length,
          outputCount: current.length,
        });
      } catch (error: any) {
        stages.push({
          name: hydrator.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: current.length,
          outputCount: current.length,
          detail: { error: error?.message || 'hydrator_failed' },
        });
      }
    }

    return {
      candidates: current,
      stages,
    };
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

export const recommendationAdapterService = new RecommendationAdapterService();

function summarizeGraphCandidates(candidates: FeedCandidate[]): InternalRetrievalExecutionSummary['graph'] {
  const kernelCandidates = candidates.filter(isGraphKernelCandidate).length;
  const totalCandidates = candidates.length;
  const legacyCandidates = totalCandidates - kernelCandidates;

  return {
    totalCandidates,
    kernelCandidates,
    legacyCandidates,
    fallbackUsed: legacyCandidates > 0,
    emptyResult: totalCandidates === 0,
  };
}

function isGraphKernelCandidate(candidate: FeedCandidate): boolean {
  const graphRecallType = (candidate as FeedCandidate & { graphRecallType?: string }).graphRecallType;
  return candidate.recallSource === 'GraphKernelSource'
    || (typeof graphRecallType === 'string' && graphRecallType.startsWith('cpp_graph_'));
}
