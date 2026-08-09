import { z } from 'zod';

import {
  DIAGNOSTICS_ONLY_ABSTENTION_V1,
  ROBUST_INFERENCE_METHOD_V1,
} from '../contracts';

export const INFERENCE_QUALIFICATION_REQUEST_V1 = 'inference_qualification_request_v1' as const;
export const INFERENCE_QUALIFICATION_V1 = 'inference_qualification_v1' as const;
export const INFERENCE_QUALIFICATION_LIMITS_V1 = 'inference_qualification_resource_limits_v1' as const;
export const INFERENCE_QUALIFICATION_HIGH_WATER_V1 = 'inference_qualification_high_water_v1' as const;
export const SYNTHETIC_CS_ASSUMPTION_EVIDENCE_V1 = 'synthetic_time_uniform_cs_assumption_evidence_v1' as const;
export const TIME_UNIFORM_CS_APPLICABILITY_AUDIT_V1 = 'time_uniform_confidence_sequence_applicability_audit_v1' as const;
export const CLUSTERED_WALD_DIAGNOSTIC_V1 = 'decision_cluster_robust_wald_v1' as const;

export const FINITE_SAMPLE_INFERENCE_BLOCKER = 'finite_sample_inference_unavailable' as const;
export const MULTIPLICITY_CONTROL_BLOCKER = 'multiplicity_control_unavailable' as const;
export const HOLDOUT_LEDGER_COMPLETENESS_BLOCKER = 'holdout_ledger_completeness_unverified' as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const inferenceQualificationResourceLimitsV1Schema = z.object({
  contractVersion: z.literal(INFERENCE_QUALIFICATION_LIMITS_V1),
  maximumScenarioCount: count,
  maximumRecordCount: count,
  maximumClusterCount: count,
  maximumEstimatedStateBytes: count,
}).strict();

export const inferenceQualificationHighWaterV1Schema = z.object({
  contractVersion: z.literal(INFERENCE_QUALIFICATION_HIGH_WATER_V1),
  scenarioCount: count,
  recordCount: count,
  clusterCount: count,
  estimatedStateBytes: count,
}).strict();

const diagnosticReferenceSchema = z.object({ status: z.literal('unavailable') }).strict();

export const inferenceQualificationDiagnosticReferencesV1Schema = z.object({
  clusterMultiplierBootstrapT: z.object({
    method: z.literal(ROBUST_INFERENCE_METHOD_V1),
    reference: diagnosticReferenceSchema,
  }).strict(),
  clusteredWald: z.object({
    method: z.literal(CLUSTERED_WALD_DIAGNOSTIC_V1),
    reference: diagnosticReferenceSchema,
  }).strict(),
}).strict();

export const syntheticTimeUniformCsAssumptionEvidenceV1Schema = z.object({
  contractVersion: z.literal(SYNTHETIC_CS_ASSUMPTION_EVIDENCE_V1),
  sourceScope: z.literal('synthetic_fixture'),
  protocolBinding: z.literal('immutable_frozen_protocol_v1'),
  provenance: z.object({
    frozenFamilySha256: sha256,
    holdoutLedgerReceiptSha256: sha256,
    datasetSha256: sha256,
    datasetVersion: z.string().trim().min(1).max(256),
    trajectoryEvidenceSha256: sha256,
    syntheticOutcomeEvidenceSha256: sha256,
    syntheticContextSha256: sha256,
    behaviorPolicyConfigSha256: sha256,
    targetPolicyConfigSha256: sha256,
    opeV3ReceiptSha256: sha256,
    opeV3StateBindingSha256: sha256,
    trajectoryCohortSha256: sha256,
    targetEvidenceRootsSha256: sha256,
  }).strict(),
  iidContextualBanditRecordsVerified: z.boolean(),
  oneActionSlotPerIndependentRecordVerified: z.boolean(),
  fixedBehaviorPolicyBeforeOutcomesVerified: z.boolean(),
  fixedTargetPolicyBeforeOutcomesVerified: z.boolean(),
  supportAudit: z.object({
    absoluteContinuityVerified: z.boolean(),
    behaviorPropensityFloor: finite.nullable(),
    maximumImportanceWeight: finite.nullable(),
  }).strict(),
  rewardAudit: z.object({
    lowerBound: finite,
    upperBound: finite,
    observedMinimum: finite.nullable(),
    observedMaximum: finite.nullable(),
    auditedRecordCount: count,
  }).strict(),
  dependenceAudit: z.object({
    viewerOrSessionClusteringPresent: z.boolean(),
    temporalDependencePresent: z.boolean(),
    commonShockDependencePresent: z.boolean(),
    adaptivePolicySelectionPresent: z.boolean(),
    holdoutReusePresent: z.boolean(),
  }).strict(),
  recordCount: count,
  actionSlotCount: count,
  independentClusterCount: count,
  scenarioCount: count,
  estimatedStateBytes: count,
  evidenceSha256: sha256,
}).strict();

export const inferenceQualificationRequestV1Schema = z.object({
  contractVersion: z.literal(INFERENCE_QUALIFICATION_REQUEST_V1),
  resourceLimits: inferenceQualificationResourceLimitsV1Schema,
  highWater: inferenceQualificationHighWaterV1Schema,
  diagnosticReferences: inferenceQualificationDiagnosticReferencesV1Schema,
  frozenFamilyEvidence: z.unknown(),
  holdoutLedgerReceipt: z.unknown(),
  syntheticTrajectoryEvidence: z.unknown(),
  syntheticOutcomeEvidence: z.unknown(),
  syntheticContextEvidence: z.unknown(),
  opeAggregateReceipt: z.unknown(),
  timeUniformCsEvidence: z.unknown(),
}).strict();

export const timeUniformCsApplicabilityReasonV1Schema = z.enum([
  'verified_synthetic_assumption_evidence_unavailable',
  'frozen_evaluation_family_unverified',
  HOLDOUT_LEDGER_COMPLETENESS_BLOCKER,
  'qualification_binding_mismatch',
  'iid_contextual_bandit_records_unverified',
  'independent_single_slot_records_unverified',
  'fixed_pre_outcome_policies_unverified',
  'objective_tuple_evidence_unavailable',
  'absolute_continuity_unverified',
  'positive_propensity_floor_unverified',
  'finite_importance_weight_upper_bound_unverified',
  'reward_bounds_invalid',
  'reward_audit_incomplete',
  'reward_out_of_bounds',
  'viewer_or_session_clustering_present',
  'temporal_dependence_present',
  'common_shock_dependence_present',
  'adaptive_policy_selection_present',
  'holdout_reuse_present',
  'resource_limit_exceeded',
]);

export const timeUniformCsApplicabilityAuditV1Schema = z.object({
  contractVersion: z.literal(TIME_UNIFORM_CS_APPLICABILITY_AUDIT_V1),
  status: z.enum(['applicable', 'not_applicable']),
  reasons: z.array(timeUniformCsApplicabilityReasonV1Schema),
  confidenceSequence: z.null(),
}).strict().superRefine((audit, context) => {
  if ((audit.status === 'applicable') !== (audit.reasons.length === 0)) {
    context.addIssue({ code: 'custom', path: ['reasons'], message: 'applicability_reason_mismatch' });
  }
});

export const inferenceQualificationResultV1Schema = z.object({
  contractVersion: z.literal(INFERENCE_QUALIFICATION_V1),
  status: z.literal('completed_with_abstention'),
  selectedMethod: z.literal(DIAGNOSTICS_ONLY_ABSTENTION_V1),
  blockers: z.array(z.string().min(1)),
  realDatasetEligible: z.literal(false),
  bindings: z.object({
    frozenFamilySha256: sha256.nullable(),
    holdoutLedgerReceiptSha256: sha256.nullable(),
    timeUniformCsEvidenceSha256: sha256.nullable(),
    trajectoryEvidenceSha256: sha256.nullable(),
    opeV3ReceiptSha256: sha256.nullable(),
  }).strict(),
  methods: z.object({
    clusterMultiplierBootstrapT: z.object({
      method: z.literal(ROBUST_INFERENCE_METHOD_V1),
      status: z.literal('unavailable'),
      evidenceSha256: z.null(),
    }).strict(),
    clusteredWald: z.object({
      method: z.literal(CLUSTERED_WALD_DIAGNOSTIC_V1),
      status: z.literal('unavailable'),
      evidenceSha256: z.null(),
    }).strict(),
    timeUniformConfidenceSequence: timeUniformCsApplicabilityAuditV1Schema,
    abstention: z.object({
      status: z.literal('selected'),
      method: z.literal(DIAGNOSTICS_ONLY_ABSTENTION_V1),
    }).strict(),
  }).strict(),
  diagnostics: z.object({
    highWater: inferenceQualificationHighWaterV1Schema,
    resourceLimits: inferenceQualificationResourceLimitsV1Schema,
    resourceLimitExceeded: z.boolean(),
  }).strict(),
  qualificationSha256: sha256,
}).strict().superRefine((result, context) => {
  const finiteSampleIndex = result.blockers.indexOf(FINITE_SAMPLE_INFERENCE_BLOCKER);
  const multiplicityIndex = result.blockers.indexOf(MULTIPLICITY_CONTROL_BLOCKER);
  if (finiteSampleIndex !== result.blockers.length - 2
    || multiplicityIndex !== result.blockers.length - 1
    || new Set(result.blockers).size !== result.blockers.length) {
    context.addIssue({ code: 'custom', path: ['blockers'], message: 'fixed_blocker_order_mismatch' });
  }
  if (result.diagnostics.resourceLimitExceeded
    && !result.blockers.includes('resource_limit_exceeded')) {
    context.addIssue({ code: 'custom', path: ['blockers'], message: 'resource_blocker_missing' });
  }
});

export type InferenceQualificationResourceLimitsV1 = z.infer<typeof inferenceQualificationResourceLimitsV1Schema>;
export type InferenceQualificationHighWaterV1 = z.infer<typeof inferenceQualificationHighWaterV1Schema>;
export type InferenceQualificationDiagnosticReferencesV1 = z.infer<typeof inferenceQualificationDiagnosticReferencesV1Schema>;
export type SyntheticTimeUniformCsAssumptionEvidenceV1 = z.infer<typeof syntheticTimeUniformCsAssumptionEvidenceV1Schema>;
export type InferenceQualificationRequestV1 = z.infer<typeof inferenceQualificationRequestV1Schema>;
export type TimeUniformCsApplicabilityReasonV1 = z.infer<typeof timeUniformCsApplicabilityReasonV1Schema>;
export type TimeUniformCsApplicabilityAuditV1 = z.infer<typeof timeUniformCsApplicabilityAuditV1Schema>;
export type InferenceQualificationResultV1 = z.infer<typeof inferenceQualificationResultV1Schema>;
