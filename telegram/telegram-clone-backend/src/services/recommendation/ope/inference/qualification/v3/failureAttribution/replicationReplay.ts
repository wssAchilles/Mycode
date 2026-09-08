import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  bootstrapPurposeSeedV1,
  bootstrapStatisticsDiagnosticV2,
  diagnosticCiBootstrapTV1,
} from '../../../bootstrap';
import { summarizeClusterScoresV1 } from '../../../clusterScores';
import { DIAGNOSTIC_CI_BOOTSTRAP_DOMAIN_V1 } from '../../../contracts';
import { thresholdBootstrapTV2 } from '../../../directionalV2';
import type { QualificationArtifactRecordV1 } from '../../v2/artifact';
import type {
  FrozenSyntheticScenarioV1,
  SyntheticInferenceQualificationResultV1,
} from '../../v2/contracts';
import { generateSyntheticClusterScoreReplicationV1 } from '../../v2/dgp';
import type { VerifiedFrozenInferenceQualificationProtocolV1 } from '../../v2/protocol';
import type {
  Phase13AssumptionAttributionRecordV1,
  Phase13AssumptionControlV1,
  Phase13AttributionPurposeV1,
  Phase13AttributionReasonV1,
  Phase13FailureAttributionBlockerV1,
  Phase13PurposeAttributionV1,
  Phase13ReplicationAttributionRecordV1,
} from './contracts';

type CurrentReplication = {
  start: Extract<QualificationArtifactRecordV1, { record: 'replication_start' }>;
  clusters: Extract<QualificationArtifactRecordV1, { record: 'cluster_score' }>[];
};

export type Phase12SemanticReplayStateV1 = {
  criticalAttributions: Phase13ReplicationAttributionRecordV1[];
  invalidAttribution: Phase13ReplicationAttributionRecordV1 | null;
  assumptions: Phase13AssumptionAttributionRecordV1[];
  current: CurrentReplication | null;
  artifactEnd: Extract<QualificationArtifactRecordV1, { record: 'artifact_end' }> | null;
  coverageSuccesses: number;
  falsePromotions: number;
  invalidReplications: number;
  bootstrapWorkUnits: number;
  clusterScoreCount: number;
  peakBufferedClusters: number;
  dynamicBlockers: string[];
};

const ASSUMPTION_REASONS: Record<Phase13AssumptionControlV1, readonly Phase13AttributionReasonV1[]> = {
  viewer_dependence: ['viewer_or_session_clustering_present'],
  unhandled_time_shock: ['common_shock_dependence_present'],
  propensity_bound_unverified: ['positive_propensity_floor_unverified'],
  adaptive_selection_holdout_reuse: [
    'adaptive_policy_selection_present',
    'holdout_reuse_present',
  ],
};

export function createPhase12SemanticReplayStateV1(): Phase12SemanticReplayStateV1 {
  return {
    criticalAttributions: [],
    invalidAttribution: null,
    assumptions: [],
    current: null,
    artifactEnd: null,
    coverageSuccesses: 0,
    falsePromotions: 0,
    invalidReplications: 0,
    bootstrapWorkUnits: 0,
    clusterScoreCount: 0,
    peakBufferedClusters: 0,
    dynamicBlockers: [],
  };
}

export function replayPhase12ArtifactRecordV1(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  state: Phase12SemanticReplayStateV1,
  record: QualificationArtifactRecordV1,
): void {
  if (record.record === 'replication_start') {
    if (state.current) semanticsMismatch();
    state.current = { start: record, clusters: [] };
    return;
  }
  if (record.record === 'cluster_score') {
    if (!state.current) semanticsMismatch();
    state.current.clusters.push(record);
    state.clusterScoreCount += 1;
    state.peakBufferedClusters = Math.max(state.peakBufferedClusters, state.current.clusters.length);
    if (state.current.clusters.length > 4) resourceExceeded();
    return;
  }
  if (record.record === 'replication_end') {
    if (!state.current) semanticsMismatch();
    const attribution = record.scenarioKind === 'critical'
      ? replayCritical(protocol, state, state.current, record)
      : replayInvalidControl(protocol, state, state.current, record);
    if (record.scenarioKind === 'critical') state.criticalAttributions.push(attribution);
    else state.invalidAttribution = attribution;
    state.current = null;
    return;
  }
  if (record.record === 'assumption_control') {
    replayAssumption(state, record);
    return;
  }
  if (record.record === 'artifact_end') state.artifactEnd = record;
}

export function verifyPhase12WholeResultV1(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  qualification: SyntheticInferenceQualificationResultV1,
  state: Phase12SemanticReplayStateV1,
  recordCount: number,
): void {
  if (state.current || !state.artifactEnd
    || state.criticalAttributions.length !== 936
    || state.assumptions.length !== 32
    || !state.invalidAttribution
    || state.clusterScoreCount !== protocol.resources.totalClusterScores
    || state.peakBufferedClusters > 4) {
    throw stableFailure('qualification_resource_attribution_unavailable');
  }
  const reachability = protocol.reachability;
  const coverageLowerBound = state.coverageSuccesses / reachability.coverageDenominator
    - reachability.coverageMargin;
  const falsePromotionUpperBound = state.falsePromotions / reachability.falsePromotionDenominator
    + reachability.falsePromotionMargin;
  const invalidRateUpperBound = state.invalidReplications / reachability.invalidRateDenominator
    + reachability.invalidRateMargin;
  if (coverageLowerBound < reachability.minimumCoverage) addBlocker(state.dynamicBlockers, 'coverage_gate_failed');
  if (falsePromotionUpperBound > reachability.maximumFalsePromotionRate) addBlocker(state.dynamicBlockers, 'false_promotion_gate_failed');
  if (invalidRateUpperBound > reachability.maximumInvalidReplicateRate) addBlocker(state.dynamicBlockers, 'invalid_replicate_gate_failed');
  const candidateStatus = state.dynamicBlockers.length === 0
    ? 'synthetic_mixture_gates_passed' : 'failed';
  const expectedMetrics = {
    coverageSuccesses: state.coverageSuccesses,
    coverageDenominator: reachability.coverageDenominator,
    coverageLowerBound,
    falsePromotions: state.falsePromotions,
    falsePromotionDenominator: reachability.falsePromotionDenominator,
    falsePromotionUpperBound,
    invalidReplicates: state.invalidReplications,
    invalidRateDenominator: reachability.invalidRateDenominator,
    invalidRateUpperBound,
  };
  const expectedBlockers = [
    'finite_sample_inference_unavailable',
    'multiplicity_control_unavailable',
    ...state.dynamicBlockers,
  ];
  if (qualification.candidateStatus !== candidateStatus
    || canonicalDecisionJson(qualification.metrics) !== canonicalDecisionJson(expectedMetrics)
    || canonicalDecisionJson(qualification.blockers) !== canonicalDecisionJson(expectedBlockers)
    || qualification.diagnostics.resources.actualRecordCount !== recordCount
    || qualification.diagnostics.resources.actualClusterScoreCount !== state.clusterScoreCount
    || qualification.diagnostics.resources.actualBootstrapWorkUnits !== state.bootstrapWorkUnits
    || qualification.diagnostics.peakBufferedClusters !== state.peakBufferedClusters
    || state.artifactEnd.candidateStatus !== candidateStatus) semanticsMismatch();
}

function replayCritical(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  state: Phase12SemanticReplayStateV1,
  current: CurrentReplication,
  end: Extract<QualificationArtifactRecordV1, { record: 'replication_end' }>,
): Phase13ReplicationAttributionRecordV1 {
  const scenario = protocol.scenarios.find((candidate) => candidate.scenarioId === end.scenarioId);
  if (!scenario) semanticsMismatch();
  const generated = generateSyntheticClusterScoreReplicationV1(protocol, scenario, end.replicationIndex);
  if (generated.status !== 'generated'
    || current.start.replicationSha256 !== generated.replication.replicationSha256
    || canonicalDecisionJson(current.clusters.map(stripClusterRecord))
      !== canonicalDecisionJson(generated.replication.clusterScores)) semanticsMismatch();
  const result = evaluateReplication(
    protocol, scenario, generated.replication.replicationSha256,
    generated.replication.clusterScores,
  );
  state.bootstrapWorkUnits += result.bootstrapWorkUnits;
  if (result.invalid) {
    state.invalidReplications += 1;
    addBlocker(state.dynamicBlockers, `critical_replication_not_evaluable:${scenario.scenarioId}`);
  } else {
    if (result.coversTruth) state.coverageSuccesses += 1;
    if (scenario.truthClass !== 'beneficial' && result.falsePromotion) state.falsePromotions += 1;
  }
  if (end.status !== (result.invalid ? 'not_evaluable' : 'evaluated')
    || end.blocker !== (result.invalid ? result.v1Blocker : null)
    || end.thresholdTestSha256 !== result.thresholdTestSha256
    || end.diagnosticCiSha256 !== result.diagnosticCiSha256) semanticsMismatch();
  return {
    record: 'replication_attribution',
    version: 'phase13_replication_attribution_v1',
    scenarioKind: 'critical',
    scenarioId: scenario.scenarioId,
    replicationIndex: end.replicationIndex,
    replicationInvalid: result.invalid,
    purposes: result.purposes,
  };
}

function evaluateReplication(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  scenario: FrozenSyntheticScenarioV1,
  replicationSha256: string,
  clusters: readonly { inferenceClusterId: string; y: number; a: number; importanceMass: number }[],
) {
  const summary = summarizeClusterScoresV1('dr', clusters);
  if (summary.status !== 'evaluated') {
    return {
      invalid: true,
      coversTruth: false,
      falsePromotion: false,
      bootstrapWorkUnits: 0,
      v1Blocker: summary.blocker,
      thresholdTestSha256: null,
      diagnosticCiSha256: null,
      purposes: [
        purpose('cluster_summary', 'not_evaluable', [clusterReason(summary.blocker)],
          pointEstimateFromClusters(clusters)),
        purpose('threshold_test', 'not_run', ['upstream_not_run']),
        purpose('diagnostic_ci', 'not_run', ['upstream_not_run']),
        purpose('assumption_control', 'not_run', ['upstream_not_run']),
      ],
    };
  }
  const inputSha256 = digest({
    protocolSha256: protocol.protocolSha256,
    replicationSha256,
    purpose: 'synthetic_qualification_replication_v1',
  });
  const threshold = thresholdBootstrapTV2({
    summary: summary.summary,
    nullThreshold: scenario.threshold,
    direction: scenario.direction,
    bootstrapReplicates: protocol.bootstrapReplicates,
    seedMaterial: protocol.bootstrapSeedMaterial,
    inputSha256,
    segment: '__all__',
  });
  const interval = diagnosticCiBootstrapTV1(
    summary.summary, protocol.confidenceLevel, protocol.bootstrapReplicates,
    protocol.bootstrapSeedMaterial, inputSha256, '__all__',
  );
  const thresholdReason = threshold.status === 'evaluated' ? 'none'
    : thresholdBootstrapReason(protocol, scenario, summary.summary, inputSha256);
  const ciReason = interval.status === 'evaluated' ? 'none'
    : ciBootstrapReason(protocol, summary.summary, inputSha256);
  const invalid = threshold.status !== 'evaluated' || interval.status !== 'evaluated';
  return {
    invalid,
    coversTruth: interval.status === 'evaluated'
      && interval.lower <= scenario.knownTruth && scenario.knownTruth <= interval.upper,
    falsePromotion: threshold.status === 'evaluated' && threshold.pValue <= protocol.familyAlpha,
    bootstrapWorkUnits: scenario.clusterCount * protocol.bootstrapReplicates * 2,
    v1Blocker: invalid ? 'bootstrap_replicate_invalid' : null,
    thresholdTestSha256: threshold.status === 'evaluated' ? threshold.thresholdTestSha256 : null,
    diagnosticCiSha256: interval.status === 'evaluated' ? digest(interval) : null,
    purposes: [
      purpose('cluster_summary', 'evaluated', ['none'], summary.summary.thetaHat,
        summary.summary.standardError),
      purpose('threshold_test', threshold.status === 'evaluated' ? 'evaluated' : 'not_evaluable',
        [thresholdReason], summary.summary.thetaHat, summary.summary.standardError,
        threshold.status === 'evaluated' ? threshold.pValue : null, null, null,
        threshold.status === 'evaluated' ? threshold.thresholdTestSha256 : null),
      purpose('diagnostic_ci', interval.status === 'evaluated' ? 'evaluated' : 'not_evaluable',
        [ciReason], summary.summary.thetaHat, summary.summary.standardError, null,
        interval.status === 'evaluated' ? interval.lower : null,
        interval.status === 'evaluated' ? interval.upper : null,
        interval.status === 'evaluated' ? digest(interval) : null),
      purpose('assumption_control', 'not_run', ['upstream_not_run']),
    ],
  };
}

function replayInvalidControl(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  state: Phase12SemanticReplayStateV1,
  current: CurrentReplication,
  end: Extract<QualificationArtifactRecordV1, { record: 'replication_end' }>,
): Phase13ReplicationAttributionRecordV1 {
  const clusters = [
    { inferenceClusterId: 'cluster-a', y: 0, a: 1, importanceMass: 2 },
    { inferenceClusterId: 'cluster-b', y: 2, a: 1, importanceMass: 1 },
  ];
  if (current.start.replicationSha256 !== digest({
    protocolSha256: protocol.protocolSha256, control: 'invalid_studentizer',
  }) || canonicalDecisionJson(current.clusters.map(stripClusterRecord))
    !== canonicalDecisionJson(clusters)) semanticsMismatch();
  const summary = summarizeClusterScoresV1('dr', clusters);
  if (summary.status !== 'evaluated') semanticsMismatch();
  state.bootstrapWorkUnits += 2 * protocol.bootstrapReplicates * 2;
  const inputSha256 = digest({ protocolSha256: protocol.protocolSha256, control: 'invalid_studentizer' });
  const scenario = { threshold: summary.summary.thetaHat, direction: 'greater' } as const;
  const threshold = thresholdBootstrapTV2({
    summary: summary.summary, nullThreshold: scenario.threshold, direction: scenario.direction,
    bootstrapReplicates: protocol.bootstrapReplicates, seedMaterial: protocol.bootstrapSeedMaterial,
    inputSha256, segment: '__all__',
  });
  const interval = diagnosticCiBootstrapTV1(
    summary.summary, 0.95, protocol.bootstrapReplicates,
    protocol.bootstrapSeedMaterial, inputSha256, '__all__',
  );
  if (threshold.status !== 'not_evaluable' || interval.status !== 'not_evaluable'
    || end.status !== 'expected_failure_observed'
    || end.blocker !== 'bootstrap_replicate_invalid'
    || end.thresholdTestSha256 !== null || end.diagnosticCiSha256 !== null) semanticsMismatch();
  return {
    record: 'replication_attribution',
    version: 'phase13_replication_attribution_v1',
    scenarioKind: 'fail_closed_control',
    scenarioId: 'invalid_studentizer_control',
    replicationIndex: 0,
    replicationInvalid: false,
    purposes: [
      purpose('cluster_summary', 'evaluated', ['none'], summary.summary.thetaHat,
        summary.summary.standardError),
      purpose('threshold_test', 'not_evaluable', [thresholdBootstrapReason(
        protocol, scenario, summary.summary, inputSha256,
      )], summary.summary.thetaHat, summary.summary.standardError),
      purpose('diagnostic_ci', 'not_evaluable', [ciBootstrapReason(
        protocol, summary.summary, inputSha256,
      )], summary.summary.thetaHat, summary.summary.standardError),
      purpose('assumption_control', 'not_run', ['upstream_not_run']),
    ],
  };
}

function replayAssumption(
  state: Phase12SemanticReplayStateV1,
  record: Extract<QualificationArtifactRecordV1, { record: 'assumption_control' }>,
): void {
  const control = record.control as Phase13AssumptionControlV1;
  const reasons = ASSUMPTION_REASONS[control];
  if (!reasons || record.status !== 'not_applicable'
    || canonicalDecisionJson(record.reasons) !== canonicalDecisionJson(reasons)) {
    throw stableFailure('qualification_control_semantics_unavailable');
  }
  state.assumptions.push({
    record: 'assumption_attribution',
    version: 'phase13_assumption_attribution_v1',
    scenarioKind: 'fail_closed_control',
    scenarioId: control,
    replicationIndex: record.replicationIndex,
    replicationInvalid: false,
    purposes: [
      purpose('cluster_summary', 'not_run', ['upstream_not_run']),
      purpose('threshold_test', 'not_run', ['upstream_not_run']),
      purpose('diagnostic_ci', 'not_run', ['upstream_not_run']),
      purpose('assumption_control', 'not_applicable', reasons),
    ],
  });
}

function thresholdBootstrapReason(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  scenario: { threshold: number; direction: 'greater' | 'less' },
  summary: Extract<ReturnType<typeof summarizeClusterScoresV1>, { status: 'evaluated' }>['summary'],
  inputSha256: string,
): Phase13AttributionReasonV1 {
  const alternative = scenario.direction === 'greater'
    ? 'theta_greater_than_null_v1' : 'theta_less_than_null_v1';
  const purposeSeedSha256 = createHash('sha256')
    .update('ope_directional_threshold_test_bootstrap_v2')
    .update('\0').update(protocol.bootstrapSeedMaterial)
    .update('\0').update(inputSha256)
    .update('\0').update(summary.estimator)
    .update('\0').update('__all__')
    .update('\0').update(scenario.direction)
    .update('\0').update(alternative)
    .update('\0').update(canonicalDecisionJson(scenario.threshold))
    .digest('hex');
  const diagnostic = bootstrapStatisticsDiagnosticV2(summary, {
    center: scenario.threshold,
    scores: summary.clusters.map((cluster) => cluster.y - cluster.a * scenario.threshold),
    purposeSeedSha256,
  }, protocol.bootstrapReplicates);
  return diagnostic.status === 'not_evaluable' ? diagnostic.reason : 'resample_numeric_invalid';
}

function ciBootstrapReason(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  summary: Extract<ReturnType<typeof summarizeClusterScoresV1>, { status: 'evaluated' }>['summary'],
  inputSha256: string,
): Phase13AttributionReasonV1 {
  const purposeSeedSha256 = bootstrapPurposeSeedV1(
    DIAGNOSTIC_CI_BOOTSTRAP_DOMAIN_V1, protocol.bootstrapSeedMaterial,
    inputSha256, summary.estimator, '__all__', protocol.confidenceLevel,
  );
  const diagnostic = bootstrapStatisticsDiagnosticV2(summary, {
    center: summary.thetaHat,
    scores: summary.clusters.map((cluster) => cluster.score),
    purposeSeedSha256,
  }, protocol.bootstrapReplicates);
  return diagnostic.status === 'not_evaluable' ? diagnostic.reason : 'resample_numeric_invalid';
}

function purpose(
  purposeName: Phase13AttributionPurposeV1,
  status: Phase13PurposeAttributionV1['status'],
  reasons: readonly Phase13AttributionReasonV1[],
  pointEstimate: number | null = null,
  standardError: number | null = null,
  pValue: number | null = null,
  lower: number | null = null,
  upper: number | null = null,
  evidenceSha256: string | null = null,
): Phase13PurposeAttributionV1 {
  return {
    purpose: purposeName, status, reasons, pointEstimate, standardError,
    pValue, lower, upper, evidenceSha256,
  };
}

function clusterReason(blocker: string): Phase13AttributionReasonV1 {
  if (blocker === 'cluster_score_degenerate') return 'observed_score_degenerate';
  if (blocker === 'cluster_score_invalid' || blocker === 'cluster_mass_invalid'
    || blocker === 'cluster_diagnostics_invalid') return blocker;
  return 'synthetic_dgp_contract_invalid';
}

function stripClusterRecord(record: Extract<QualificationArtifactRecordV1, { record: 'cluster_score' }>) {
  return {
    inferenceClusterId: record.clusterId,
    y: record.y,
    a: record.a,
    importanceMass: record.importanceMass,
  };
}

function pointEstimateFromClusters(clusters: readonly { y: number; a: number }[]): number | null {
  const estimate = clusters.reduce((sum, cluster) => sum + cluster.y, 0)
    / clusters.reduce((sum, cluster) => sum + cluster.a, 0);
  return Number.isFinite(estimate) ? estimate : null;
}

function addBlocker(blockers: string[], blocker: string): void {
  if (!blockers.includes(blocker)) blockers.push(blocker);
}

function semanticsMismatch(): never {
  throw stableFailure('qualification_artifact_semantics_mismatch');
}

function resourceExceeded(): never {
  throw stableFailure('resource_limit_exceeded');
}

function stableFailure(blocker: Phase13FailureAttributionBlockerV1): Error {
  return Object.assign(new Error(blocker), { blocker });
}

const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
