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
      return {
        candidates,
        stage: {
          name: source.name,
          enabled: true,
          durationMs: Date.now() - start,
          inputCount: 1,
          outputCount: candidates.length,
          detail: {
            recallSource: source.name,
          },
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
}

export const recommendationAdapterService = new RecommendationAdapterService();
