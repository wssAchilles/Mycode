import type { RecommendationSummaryPayload } from './contracts';

export interface RecommendationShadowComparison {
  overlapCount: number;
  overlapRatio: number;
  selectedCount: number;
  baselineCount: number;
}

export interface RecommendationRuntimeSnapshot {
  mode: string;
  lastPrimaryAt?: string;
  lastShadowAt?: string;
  lastPrimarySummary?: RecommendationSummaryPayload;
  lastShadowSummary?: RecommendationSummaryPayload;
  lastShadowComparison?: RecommendationShadowComparison;
}

class RecommendationRuntimeMetrics {
  private lastPrimarySummary?: RecommendationSummaryPayload;
  private lastPrimaryAt?: string;
  private lastShadowSummary?: RecommendationSummaryPayload;
  private lastShadowAt?: string;
  private lastShadowComparison?: RecommendationShadowComparison;

  recordPrimary(summary: RecommendationSummaryPayload): void {
    this.lastPrimarySummary = summary;
    this.lastPrimaryAt = new Date().toISOString();
  }

  recordShadow(
    summary: RecommendationSummaryPayload,
    comparison: RecommendationShadowComparison,
  ): void {
    this.lastShadowSummary = summary;
    this.lastShadowAt = new Date().toISOString();
    this.lastShadowComparison = comparison;
  }

  snapshot(mode: string): RecommendationRuntimeSnapshot {
    return {
      mode,
      lastPrimaryAt: this.lastPrimaryAt,
      lastShadowAt: this.lastShadowAt,
      lastPrimarySummary: this.lastPrimarySummary,
      lastShadowSummary: this.lastShadowSummary,
      lastShadowComparison: this.lastShadowComparison,
    };
  }
}

export const recommendationRuntimeMetrics = new RecommendationRuntimeMetrics();
