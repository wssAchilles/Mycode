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

  return {
    runtime: recommendationRuntimeMetrics.snapshot(mode),
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
