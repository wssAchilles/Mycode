import type { Phase12CriticalScenarioIdV1 } from '../../v2/contracts';

export const VERIFIED_PHASE12_FAILURE_ATTRIBUTION_SOURCE_V1 =
  'verified_phase12_failure_attribution_source_v1' as const;
export const PHASE13_FAILURE_ATTRIBUTION_CLASSIFICATION_V1 =
  'phase13_failure_attribution_classification_v1' as const;
export const PHASE13_ATTRIBUTION_SIDECAR_V1 =
  'phase13_failure_attribution_sidecar_v1' as const;

export const PHASE13_PURPOSE_ORDER_V1 = Object.freeze([
  'cluster_summary',
  'threshold_test',
  'diagnostic_ci',
  'assumption_control',
] as const);

export const PHASE13_REASON_ORDER_V1 = Object.freeze([
  'none',
  'upstream_not_run',
  'observed_score_degenerate',
  'resample_studentizer_degenerate',
  'resample_numeric_invalid',
  'cluster_score_invalid',
  'cluster_mass_invalid',
  'cluster_diagnostics_invalid',
  'synthetic_dgp_contract_invalid',
  'resource_limit_exceeded',
  'viewer_or_session_clustering_present',
  'common_shock_dependence_present',
  'positive_propensity_floor_unverified',
  'adaptive_policy_selection_present',
  'holdout_reuse_present',
] as const);

export const PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1 = Object.freeze({
  maximumInputRecords: 5_420,
  maximumInputBytes: 33_554_432,
  maximumBufferedClusters: 4,
  maximumDgpPrimitiveWorkUnits: 131_072,
  maximumBootstrapWorkUnits: 892_048,
  sidecarRecordCount: 984,
  maximumCanonicalRecordBytes: 4_096,
  maximumSidecarBytes: 4_031_448,
} as const);

export type Phase13AttributionPurposeV1 = typeof PHASE13_PURPOSE_ORDER_V1[number];
export type Phase13AttributionReasonV1 = typeof PHASE13_REASON_ORDER_V1[number];
export type Phase13AssumptionControlV1 =
  | 'viewer_dependence'
  | 'unhandled_time_shock'
  | 'propensity_bound_unverified'
  | 'adaptive_selection_holdout_reuse';
export type Phase13ScenarioSummaryIdV1 = Phase12CriticalScenarioIdV1
  | Phase13AssumptionControlV1
  | 'invalid_studentizer_control';

export type Phase13PurposeAttributionV1 = {
  purpose: Phase13AttributionPurposeV1;
  status: 'evaluated' | 'not_evaluable' | 'not_run' | 'not_applicable';
  reasons: readonly Phase13AttributionReasonV1[];
  pointEstimate: number | null;
  standardError: number | null;
  pValue: number | null;
  lower: number | null;
  upper: number | null;
  evidenceSha256: string | null;
};

export type Phase13AttributionStartRecordV1 = {
  record: 'attribution_start';
  version: typeof PHASE13_ATTRIBUTION_SIDECAR_V1;
  protocolSha256: string;
  qualificationSha256: string;
  sourceReceiptSha256: string;
  purposeOrder: typeof PHASE13_PURPOSE_ORDER_V1;
  reasonOrder: typeof PHASE13_REASON_ORDER_V1;
  expectedRecordCount: 984;
};

export type Phase13ReplicationAttributionRecordV1 = {
  record: 'replication_attribution';
  version: 'phase13_replication_attribution_v1';
  scenarioKind: 'critical' | 'fail_closed_control';
  scenarioId: Phase12CriticalScenarioIdV1 | 'invalid_studentizer_control';
  replicationIndex: number;
  replicationInvalid: boolean;
  purposes: readonly Phase13PurposeAttributionV1[];
};

export type Phase13AssumptionAttributionRecordV1 = {
  record: 'assumption_attribution';
  version: 'phase13_assumption_attribution_v1';
  scenarioKind: 'fail_closed_control';
  scenarioId: Phase13AssumptionControlV1;
  replicationIndex: number;
  replicationInvalid: false;
  purposes: readonly Phase13PurposeAttributionV1[];
};

export type Phase13ScenarioSummaryRecordV1 = {
  record: 'scenario_summary';
  version: 'phase13_scenario_summary_v1';
  scenarioId: Phase13ScenarioSummaryIdV1;
  replicationCount: number;
  invalidReplicationCount: number;
  purposeReasonCounts: readonly {
    purpose: Phase13AttributionPurposeV1;
    counts: readonly number[];
  }[];
};

export type Phase13AttributionEndRecordV1 = {
  record: 'attribution_end';
  version: 'phase13_failure_attribution_sidecar_end_v1';
  sourceReceiptSha256: string;
  expectedRecordCount: 984;
  recordsBeforeEndSha256: string;
};

export type Phase13FailureAttributionRecordV1 =
  | Phase13AttributionStartRecordV1
  | Phase13ReplicationAttributionRecordV1
  | Phase13AssumptionAttributionRecordV1
  | Phase13ScenarioSummaryRecordV1
  | Phase13AttributionEndRecordV1;

export type VerifiedPhase12FailureAttributionSourceV1 = {
  contractVersion: typeof VERIFIED_PHASE12_FAILURE_ATTRIBUTION_SOURCE_V1;
  protocolSha256: string;
  qualificationSha256: string;
  generatorSeedSha256: string;
  bootstrapSeedSha256: string;
  rawArtifactSha256: string;
  rawArtifactRecordCount: 5_420;
  rawArtifactByteCount: number;
  sourceReceiptSha256: string;
  attributionSha256: string;
  attributionRecordCount: 984;
  failureClassificationVersion: typeof PHASE13_FAILURE_ATTRIBUTION_CLASSIFICATION_V1;
  dgpPrimitiveWorkUnits: 108_812;
  bootstrapWorkUnits: number;
  peakBufferedClusters: number;
  realDatasetEligible: false;
};

export type Phase13FailureAttributionBlockerV1 =
  | 'failure_attribution_source_unverified'
  | 'qualification_artifact_binding_mismatch'
  | 'qualification_artifact_semantics_mismatch'
  | 'qualification_resource_attribution_unavailable'
  | 'qualification_control_semantics_unavailable'
  | 'resource_limit_exceeded';
