import { buildNodeCapabilityOwnershipSummary } from '../../controlPlane/capabilityOwners';
import {
  getRustRecommendationMode,
  getRustRecommendationTimeoutMs,
} from '../../recommendation/clients/RustRecommendationClient';
import { buildRecommendationTraceSummary } from '../../recommendation/ops';
import {
  RANKING_PROMOTION_FIXED_BLOCKERS,
  RANKING_PROMOTION_POLICY_VERSION,
} from '../../recommendation/promotion/contracts';
import { readRustRecommendationOpsSummary } from '../../recommendation/rust/ops';
import { recommendationRuntimeMetrics } from '../../recommendation/rust/runtimeMetrics';
import {
  readRecommendationRolloutEvidence,
  type RecommendationRolloutEvidence,
} from '../../recommendation/ops/rolloutEvidence';
import { readGraphKernelOpsSummary } from '../../graphKernel/ops';
import { getCapabilityRecord } from '../shared/capabilityRecord';
import { readOptionalInt, readOptionalNumber, readOptionalString } from '../shared/queryParsing';

export interface RecommendationOpsReplayLoggingReadiness {
  totalRequests?: number;
  requestsMissingRank?: number;
  requestsMissingRecallSource?: number;
  requestsMissingScore?: number;
  requestsMissingExperimentKeys?: number;
  requestsMissingFeedbackJoinKey?: number;
}

export interface RecommendationOpsSummaryInput {
  rustPrimaryFallbackRate?: number;
  graphKernelMissingDiagnosticsRate?: number;
  replayLoggingReadiness?: RecommendationOpsReplayLoggingReadiness;
  embeddingContractIncompatibleCount?: number | null;
  recommendationRollout?: RecommendationRolloutEvidence;
  baseBlockers?: string[];
}

export async function buildRecommendationOps(
  query: Record<string, unknown>,
  rolloutPolicyConfig?: unknown,
) {
  const mode = getRustRecommendationMode();
  const [rustRecommendation, graphKernel, traceSummary, rolloutEvidence] = await Promise.all([
    readRustRecommendationOpsSummary(),
    readGraphKernelOpsSummary(),
    buildRecommendationTraceSummary({
      windowHours: readOptionalInt(query.windowHours),
      limit: readOptionalInt(query.limit),
      surface: readOptionalString(query.surface),
      shadowLowOverlapThreshold: readOptionalNumber(query.shadowLowOverlapThreshold),
    }),
    readRecommendationRolloutEvidence(rolloutPolicyConfig),
  ]);
  const capabilities = buildNodeCapabilityOwnershipSummary({ graphKernel });
  const readiness = await buildRecommendationReadiness({
    rustRecommendation,
    graphKernel,
    traceSummary,
    rolloutEvidence,
    mode,
  });

  return {
    runtime: recommendationRuntimeMetrics.snapshot(mode),
    readiness,
    rankingPromotion: {
      contractVersion: RANKING_PROMOTION_POLICY_VERSION,
      verdict: 'blocked',
      blockers: [...RANKING_PROMOTION_FIXED_BLOCKERS],
      evidenceStatus: 'not_loaded',
    },
    ownership: {
      recommendation: getCapabilityRecord(capabilities, 'recommendation'),
      graph: getCapabilityRecord(capabilities, 'graph'),
    },
    rustRecommendation,
    graphKernel,
    traceSummary,
    rolloutEvidence,
    config: {
      mode,
      url: String(process.env.RUST_RECOMMENDATION_URL || 'http://recommendation:4200'),
      timeoutMs: getRustRecommendationTimeoutMs(),
      selectorOversampleFactor:
        parseInt(String(process.env.RUST_RECOMMENDATION_SELECTOR_OVERSAMPLE_FACTOR || '5'), 10) || 5,
      selectorMaxSize:
        parseInt(String(process.env.RUST_RECOMMENDATION_SELECTOR_MAX_SIZE || '200'), 10) || 200,
      recentGlobalCapacity:
        parseInt(String(process.env.RUST_RECOMMENDATION_RECENT_GLOBAL_CAPACITY || '256'), 10) || 256,
      recentPerUserCapacity:
        parseInt(String(process.env.RUST_RECOMMENDATION_RECENT_PER_USER_CAPACITY || '64'), 10) || 64,
      graphKernelEnabled: !['0', 'false', 'off', 'no'].includes(
        String(process.env.CPP_GRAPH_KERNEL_ENABLED || 'true').trim().toLowerCase(),
      ),
      graphKernelUrl: String(process.env.CPP_GRAPH_KERNEL_URL || 'http://graph_kernel:4300'),
    },
  };
}

async function buildRecommendationReadiness(input: {
  rustRecommendation: Awaited<ReturnType<typeof readRustRecommendationOpsSummary>>;
  graphKernel: Awaited<ReturnType<typeof readGraphKernelOpsSummary>>;
  traceSummary: Awaited<ReturnType<typeof buildRecommendationTraceSummary>>;
  rolloutEvidence: RecommendationRolloutEvidence;
  mode: string;
}) {
  const blockers: string[] = [];
  const nodeAdapter = await probeNodeAdapterHealth();

  if (!input.rustRecommendation.available) {
    blockers.push(`rust_provider_unavailable:${input.rustRecommendation.error || 'unknown'}`);
  }
  if (!nodeAdapter.available) {
    blockers.push(`node_recommendation_adapter_unavailable:${nodeAdapter.error || 'unknown'}`);
  }
  if (input.graphKernel && input.graphKernel.available === false) {
    blockers.push(`graph_unready:${input.graphKernel.error || 'unknown'}`);
  }

  const traceSummary = input.traceSummary as any;
  const opsSummary = buildRecommendationOpsSummary({
    rustPrimaryFallbackRate: input.rolloutEvidence.fallbackRatio ?? undefined,
    graphKernelMissingDiagnosticsRate: graphKernelMissingDiagnosticsRate(input.graphKernel),
    replayLoggingReadiness: traceSummary?.replayLoggingReadiness,
    embeddingContractIncompatibleCount: traceSummary?.embeddingContractIncompatibleCount,
    recommendationRollout: input.rolloutEvidence,
    baseBlockers: blockers,
  });

  return {
    ok: opsSummary.blockers.length === 0,
    status: opsSummary.blockers.length === 0 ? 'ready' : 'degraded',
    mode: input.mode,
    blockers: opsSummary.blockers,
    evidence: opsSummary.evidence,
    thresholds: opsSummary.thresholds,
    probes: {
      rustRecommendation: {
        available: input.rustRecommendation.available,
        url: input.rustRecommendation.url,
        error: input.rustRecommendation.error,
      },
      nodeAdapter,
      graphKernel: {
        available: input.graphKernel.available,
        url: input.graphKernel.url,
        error: input.graphKernel.error,
      },
    },
  };
}

export function buildRecommendationOpsSummary(input: RecommendationOpsSummaryInput) {
  const thresholds = {
    graphKernelMissingDiagnosticsRate: readRateThreshold(
      process.env.RECOMMENDATION_GRAPH_KERNEL_MISSING_DIAGNOSTICS_RATE_THRESHOLD,
      0.01,
    ),
    embeddingContractIncompatibleCount: readCountThreshold(
      process.env.RECOMMENDATION_EMBEDDING_CONTRACT_INCOMPATIBLE_THRESHOLD,
      0,
    ),
    recommendationRollout: input.recommendationRollout
      ? {
        policyVersion: input.recommendationRollout.policyVersion,
        windowHours: input.recommendationRollout.windowHours,
        minimumPrimarySamples: input.recommendationRollout.minimumPrimarySamples,
        maximumFallbackRatio: input.recommendationRollout.maximumFallbackRatio,
      }
      : null,
  };
  const evidence = {
    rustPrimaryFallbackRate: finiteRate(input.rustPrimaryFallbackRate),
    graphKernelMissingDiagnosticsRate: finiteRate(input.graphKernelMissingDiagnosticsRate),
    replayLoggingReadiness: input.replayLoggingReadiness || {},
    embeddingContractIncompatibleCount: isNonNegativeInteger(input.embeddingContractIncompatibleCount)
      ? input.embeddingContractIncompatibleCount
      : null,
    recommendationRollout: input.recommendationRollout,
  };
  const blockers = [
    ...(input.baseBlockers || []),
    ...(input.recommendationRollout?.blockers || []),
  ];
  const replayLoggingReadinessMissing = input.replayLoggingReadiness === undefined;
  const embeddingContractEvidenceMissing = evidence.embeddingContractIncompatibleCount === null;

  if (evidence.graphKernelMissingDiagnosticsRate > thresholds.graphKernelMissingDiagnosticsRate) {
    blockers.push('graph_kernel_diagnostics_missing');
  }
  if (replayLoggingReadinessMissing) {
    blockers.push('replay_logging_readiness_missing');
  } else if (replayLoggingReadinessIncomplete(evidence.replayLoggingReadiness)) {
    blockers.push('replay_logging_readiness_incomplete');
  }
  if (embeddingContractEvidenceMissing) {
    blockers.push('embedding_contract_evidence_missing');
  } else if (
    evidence.embeddingContractIncompatibleCount !== null
    && evidence.embeddingContractIncompatibleCount > thresholds.embeddingContractIncompatibleCount
  ) {
    blockers.push('embedding_contract_incompatible');
  }

  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'ready' : 'degraded',
    blockers,
    evidence,
    thresholds,
  };
}

async function probeNodeAdapterHealth(): Promise<{ available: boolean; url: string; error?: string }> {
  const baseUrl = String(process.env.BACKEND_INTERNAL_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
  const url = `${baseUrl}/internal/recommendation/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const token = String(process.env.RECOMMENDATION_INTERNAL_TOKEN || '').trim();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: token ? { 'x-recommendation-internal-token': token } : {},
    });
    return response.ok
      ? { available: true, url }
      : { available: false, url, error: `node adapter ${response.status}` };
  } catch (error: any) {
    return {
      available: false,
      url,
      error: error?.name === 'AbortError' ? 'node adapter timeout' : (error?.message || 'node adapter unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function graphKernelMissingDiagnosticsRate(
  graphKernel: Awaited<ReturnType<typeof readGraphKernelOpsSummary>>,
): number {
  if (!graphKernel?.available) return 0;
  const summary = graphKernel.summary || {};
  const explicitRate = readFirstFiniteNumber(
    summary.graphKernelMissingDiagnosticsRate,
    summary.missingDiagnosticsRate,
    summary.diagnosticsMissingRate,
  );
  if (typeof explicitRate === 'number') return finiteRate(explicitRate);

  const currentBlocker = String(summary.currentBlocker || '').trim();
  if (currentBlocker === 'graph_kernel_latency_missing' || currentBlocker === 'graph_kernel_budget_missing') {
    return finiteCount(summary.requestTotal) > 0 ? 1 : 0;
  }
  return 0;
}

function replayLoggingReadinessIncomplete(readiness: RecommendationOpsReplayLoggingReadiness): boolean {
  const counters = [
    readiness.requestsMissingRank,
    readiness.requestsMissingRecallSource,
    readiness.requestsMissingScore,
    readiness.requestsMissingExperimentKeys,
    readiness.requestsMissingFeedbackJoinKey,
  ];
  if (!isNonNegativeInteger(readiness.totalRequests) || readiness.totalRequests === 0) return true;
  if (!counters.every(isNonNegativeInteger)) return true;
  return counters.some((value) => value > 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function readFirstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readRateThreshold(raw: string | undefined, fallback: number): number {
  return finiteRate(parseFloat(String(raw ?? fallback)));
}

function readCountThreshold(raw: string | undefined, fallback: number): number {
  return finiteCount(parseInt(String(raw ?? fallback), 10));
}

function finiteRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function finiteCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}
