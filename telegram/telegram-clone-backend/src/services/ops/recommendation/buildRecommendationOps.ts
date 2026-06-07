import { buildNodeCapabilityOwnershipSummary } from '../../controlPlane/capabilityOwners';
import {
  getRustRecommendationMode,
  getRustRecommendationTimeoutMs,
} from '../../recommendation/clients/RustRecommendationClient';
import { buildRecommendationTraceSummary } from '../../recommendation/ops';
import { readRustRecommendationOpsSummary } from '../../recommendation/rust/ops';
import { recommendationRuntimeMetrics } from '../../recommendation/rust/runtimeMetrics';
import { readGraphKernelOpsSummary } from '../../graphKernel/ops';
import { getCapabilityRecord } from '../shared/capabilityRecord';
import { readOptionalInt, readOptionalNumber, readOptionalString } from '../shared/queryParsing';

export async function buildRecommendationOps(query: Record<string, unknown>) {
  const mode = getRustRecommendationMode();
  const [rustRecommendation, graphKernel, traceSummary] = await Promise.all([
    readRustRecommendationOpsSummary(),
    readGraphKernelOpsSummary(),
    buildRecommendationTraceSummary({
      windowHours: readOptionalInt(query.windowHours),
      limit: readOptionalInt(query.limit),
      surface: readOptionalString(query.surface),
      shadowLowOverlapThreshold: readOptionalNumber(query.shadowLowOverlapThreshold),
    }),
  ]);
  const capabilities = buildNodeCapabilityOwnershipSummary({ graphKernel });
  const readiness = await buildRecommendationReadiness({
    rustRecommendation,
    graphKernel,
    traceSummary,
    mode,
  });

  return {
    runtime: recommendationRuntimeMetrics.snapshot(mode),
    readiness,
    ownership: {
      recommendation: getCapabilityRecord(capabilities, 'recommendation'),
      graph: getCapabilityRecord(capabilities, 'graph'),
    },
    rustRecommendation,
    graphKernel,
    traceSummary,
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
  const fallbackCount = Number(traceSummary?.byFallbackReason?.rust_primary_error_fallback_node || 0);
  if (fallbackCount > 0) {
    blockers.push(`rust_primary_error_fallback_node:${fallbackCount}`);
  }

  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'ready' : 'degraded',
    mode: input.mode,
    blockers,
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
