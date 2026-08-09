import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { evaluateOpeV2 } from '../v2/evaluate';
import { isVerifiedProjectedOpeInputV2, type VerifiedProjectedOpeInputV2 } from '../v2/project';
import { diagnosticCiBootstrapTV1, thresholdBootstrapTV1 } from './bootstrap';
import { buildVerifiedClusterScoreSummaryV1 } from './clusterScores';
import {
  DIAGNOSTICS_ONLY_ABSTENTION_V1,
  frozenOpeHypothesisManifestV1Schema,
  robustInferenceExperimentalConfigV1Schema,
  type ExperimentalBootstrapResultV1,
  type FrozenOpeHypothesisManifestV1,
  type RobustInferenceExperimentalConfigV1,
} from './contracts';
import { isVerifiedFrozenHypothesisSealV1, type VerifiedFrozenHypothesisSealV1 } from './hypothesisSeal';

export type ExperimentalInferenceInputV1 = {
  projection: VerifiedProjectedOpeInputV2;
  config: RobustInferenceExperimentalConfigV1;
  hypothesisEvidence: VerifiedFrozenHypothesisSealV1;
};

export function frozenHypothesisManifestSha256V1(manifest: Omit<FrozenOpeHypothesisManifestV1, 'manifestSha256'>): string {
  return digest(manifest);
}

export function robustInferenceConfigSha256V1(config: RobustInferenceExperimentalConfigV1): string {
  return digest(config);
}

export function evaluateExperimentalClusterInferenceV1(input: unknown): ExperimentalBootstrapResultV1 {
  let estimator: ExperimentalBootstrapResultV1['estimator'] = 'ips';
  try {
    const raw = record(input);
    const projection = raw?.projection;
    if (!isVerifiedProjectedOpeInputV2(projection)) return invalidInference('unverified_projection', estimator);
    const hypothesisEvidence = raw?.hypothesisEvidence;
    if (!isVerifiedFrozenHypothesisSealV1(hypothesisEvidence)) return invalidInference('hypothesis_seal_trust_root_unavailable', estimator);
    estimator = hypothesisEvidence.hypothesis.estimator;
    if (projection.slots.some((slot) => slot.binding.realDatasetEligible)) return invalidInference('hypothesis_seal_trust_root_unavailable', estimator);
    const config = robustInferenceExperimentalConfigV1Schema.safeParse(raw?.config);
    const hypothesis = frozenOpeHypothesisManifestV1Schema.safeParse(hypothesisEvidence.hypothesis);
    if (!config.success || !hypothesis.success) return invalidInference('invalid_input', estimator);
    const manifest = hypothesis.data;
    if (manifest.inferenceConfigSha256 !== robustInferenceConfigSha256V1(config.data)) return invalidInference('inference_config_digest_mismatch', estimator);
    if (manifest.objective !== projection.config.rewardDefinition.objective) return invalidInference('hypothesis_objective_mismatch', estimator);
    const { manifestSha256: _manifestSha256, ...manifestPreimage } = manifest;
    if (frozenHypothesisManifestSha256V1(manifestPreimage) !== manifest.manifestSha256) return invalidInference('hypothesis_manifest_digest_mismatch', estimator);
    const sealedAt = Date.parse(hypothesisEvidence.receipt.sealedAt);
    const holdoutNotBefore = Date.parse(hypothesisEvidence.receipt.holdoutNotBefore);
    if (Date.parse(manifest.frozenAt) > sealedAt || sealedAt >= holdoutNotBefore) return invalidInference('hypothesis_not_frozen_before_holdout', estimator);

    const baseline = evaluateOpeV2(projection).estimators[estimator];
    if (baseline.status !== 'evaluated') return invalidInference(baseline.blockers[0] ?? 'selected_estimator_not_evaluable', estimator);
    const inputSha256 = digest({ projection, config: config.data, hypothesisSealEvidenceSha256: hypothesisEvidence.hypothesisSealEvidenceSha256, sealReceiptSha256: hypothesisEvidence.receipt.sealReceiptSha256 });
    const scoreResult = buildVerifiedClusterScoreSummaryV1(projection, estimator, manifest.segment);
    if (scoreResult.status !== 'evaluated') return invalidInference(scoreResult.blocker, estimator);
    const summary = scoreResult.summary;
    const diagnostics = { clusterCount: summary.clusters.length, clusterEss: summary.clusterEss, maximumScoreShare: summary.maximumScoreShare, bootstrapReplicates: config.data.bootstrapReplicates };
    const workUnits = summary.clusters.length * config.data.bootstrapReplicates * 2;
    const blocker = !Number.isSafeInteger(workUnits) || workUnits > config.data.maximumBootstrapWorkUnits ? 'resource_limit_exceeded'
      : summary.clusters.length < config.data.minimumClusters ? 'insufficient_inference_clusters'
        : summary.clusterEss < config.data.minimumClusterEss ? 'cluster_ess_below_threshold'
          : summary.maximumScoreShare > config.data.maximumScoreShare ? 'maximum_score_share_exceeded' : undefined;
    if (blocker) return { ...invalidInference(blocker, estimator), diagnostics };

    const threshold = thresholdBootstrapTV1(summary, manifest.threshold, config.data.bootstrapReplicates, manifest.bootstrapSeedMaterial, inputSha256, manifest.segment);
    const interval = diagnosticCiBootstrapTV1(summary, config.data.confidenceLevel, config.data.bootstrapReplicates, manifest.bootstrapSeedMaterial, inputSha256, manifest.segment);
    if (threshold.status !== 'evaluated' || interval.status !== 'evaluated') return { ...invalidInference('bootstrap_replicate_invalid', estimator), diagnostics };
    const thresholdBody = { threshold: manifest.threshold, observedStatistic: threshold.observedStatistic, pValue: threshold.pValue, purposeSeedSha256: threshold.purposeSeedSha256 };
    const intervalBody = { level: interval.level, lower: interval.lower, upper: interval.upper, standardError: interval.standardError, lowerQuantile: interval.lowerQuantile, upperQuantile: interval.upperQuantile, purposeSeedSha256: interval.purposeSeedSha256 };
    return {
      contractVersion: 'experimental_cluster_bootstrap_t_result_v1', status: 'evaluated', blockers: ['finite_sample_inference_unavailable'], estimator,
      realDatasetEligible: false, diagnostics,
      thresholdTest: { ...thresholdBody, thresholdTestSha256: digest(thresholdBody) },
      diagnosticCi: { ...intervalBody, diagnosticCiSha256: digest(intervalBody) },
    };
  } catch {
    return invalidInference('inference_math_failed', estimator);
  }
}

export function buildRobustInferenceSingleCohortDiagnosticsV1(input: unknown) {
  try {
    const bootstrap = evaluateExperimentalClusterInferenceV1(input);
    const raw = record(input);
    if (!raw || !isVerifiedProjectedOpeInputV2(raw.projection) || !isVerifiedFrozenHypothesisSealV1(raw.hypothesisEvidence)) return unavailableDiagnostics(bootstrap.blockers);
    const parsedConfig = robustInferenceExperimentalConfigV1Schema.safeParse(raw.config);
    if (!parsedConfig.success) return unavailableDiagnostics(bootstrap.blockers);
    const wald = evaluateOpeV2(raw.projection);
    const estimator = raw.hypothesisEvidence.hypothesis.estimator;
    const assumptions = parsedConfig.data.selfNormalizedBoundAssumptions;
    return {
      contractVersion: 'robust_inference_single_cohort_diagnostics_v1' as const,
      status: 'evaluated' as const,
      methods: {
        clusterMultiplierBootstrapT: bootstrap,
        clusteredWaldDiagnostic: wald.confidenceIntervals[estimator],
        selfNormalizedTruncatedBoundAudit: assumptions.status === 'unavailable'
          ? { status: 'not_applicable' as const, reason: 'required_bound_assumptions_unavailable' as const }
          : { status: 'assumptions_declared_only' as const, assumptions },
        abstention: { status: 'selected' as const, method: DIAGNOSTICS_ONLY_ABSTENTION_V1 },
      },
      selectedMethod: DIAGNOSTICS_ONLY_ABSTENTION_V1,
      blockers: ['finite_sample_inference_unavailable'] as const,
      realDatasetEligible: false as const,
    };
  } catch {
    return unavailableDiagnostics(['inference_math_failed']);
  }
}

export const buildRobustInferenceAblationReportV1 = buildRobustInferenceSingleCohortDiagnosticsV1;

const digest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');

function invalidInference(blocker: string, estimator: ExperimentalBootstrapResultV1['estimator']): ExperimentalBootstrapResultV1 {
  return {
    contractVersion: 'experimental_cluster_bootstrap_t_result_v1', status: 'not_evaluable', blockers: [blocker], estimator,
    realDatasetEligible: false, diagnostics: { clusterCount: 0, clusterEss: null, maximumScoreShare: null, bootstrapReplicates: 0 }, thresholdTest: null, diagnosticCi: null,
  };
}

function unavailableDiagnostics(blockers: readonly string[]) {
  return {
    contractVersion: 'robust_inference_single_cohort_diagnostics_v1' as const,
    status: 'not_evaluable' as const,
    blockers: [...blockers],
    methods: null,
    selectedMethod: DIAGNOSTICS_ONLY_ABSTENTION_V1,
    realDatasetEligible: false as const,
  };
}

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}
