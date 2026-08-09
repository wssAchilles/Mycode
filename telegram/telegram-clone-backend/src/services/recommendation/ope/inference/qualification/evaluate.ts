import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../decisionLog/contracts';
import {
  isVerifiedFrozenEvaluationFamilyV1,
  isVerifiedHoldoutUseLedgerReceiptV1,
} from '../../../promotion/evaluationProtocol';
import { DIAGNOSTICS_ONLY_ABSTENTION_V1 } from '../contracts';
import {
  FINITE_SAMPLE_INFERENCE_BLOCKER,
  HOLDOUT_LEDGER_COMPLETENESS_BLOCKER,
  INFERENCE_QUALIFICATION_HIGH_WATER_V1,
  INFERENCE_QUALIFICATION_LIMITS_V1,
  INFERENCE_QUALIFICATION_V1,
  MULTIPLICITY_CONTROL_BLOCKER,
  TIME_UNIFORM_CS_APPLICABILITY_AUDIT_V1,
  inferenceQualificationRequestV1Schema,
  inferenceQualificationResultV1Schema,
  syntheticTimeUniformCsAssumptionEvidenceV1Schema,
  type InferenceQualificationDiagnosticReferencesV1,
  type InferenceQualificationHighWaterV1,
  type InferenceQualificationResourceLimitsV1,
  type InferenceQualificationResultV1,
  type TimeUniformCsApplicabilityAuditV1,
  type TimeUniformCsApplicabilityReasonV1,
} from './contracts';
import {
  isSyntheticTimeUniformCsEvidenceBoundV1,
  isVerifiedSyntheticTimeUniformCsEvidenceV1,
} from './syntheticEvidence';

const verifiedResult = Symbol('verifiedInferenceQualificationResultV1');
const verifiedResults = new WeakSet<object>();
const verifiedResultDigests = new WeakMap<object, string>();

export type VerifiedInferenceQualificationResultV1 = InferenceQualificationResultV1 & {
  readonly [verifiedResult]: true;
};

const EMPTY_LIMITS: InferenceQualificationResourceLimitsV1 = Object.freeze({
  contractVersion: INFERENCE_QUALIFICATION_LIMITS_V1,
  maximumScenarioCount: 0,
  maximumRecordCount: 0,
  maximumClusterCount: 0,
  maximumEstimatedStateBytes: 0,
});
const EMPTY_HIGH_WATER: InferenceQualificationHighWaterV1 = Object.freeze({
  contractVersion: INFERENCE_QUALIFICATION_HIGH_WATER_V1,
  scenarioCount: 0,
  recordCount: 0,
  clusterCount: 0,
  estimatedStateBytes: 0,
});
const EMPTY_REFERENCES: InferenceQualificationDiagnosticReferencesV1 = Object.freeze({
  clusterMultiplierBootstrapT: {
    method: 'cluster_score_multiplier_bootstrap_t_v1',
    reference: { status: 'unavailable' },
  },
  clusteredWald: {
    method: 'decision_cluster_robust_wald_v1',
    reference: { status: 'unavailable' },
  },
});

export function evaluateInferenceQualificationV1(input: unknown): VerifiedInferenceQualificationResultV1 {
  let parsed: ReturnType<typeof inferenceQualificationRequestV1Schema.safeParse> | undefined;
  try {
    parsed = inferenceQualificationRequestV1Schema.safeParse(input);
  } catch {
    parsed = undefined;
  }
  if (!parsed?.success) {
    return result({
      highWater: EMPTY_HIGH_WATER,
      resourceLimits: EMPTY_LIMITS,
      diagnosticReferences: EMPTY_REFERENCES,
      familySha256: null,
      ledgerReceiptSha256: null,
      csEvidenceSha256: null,
      trajectoryEvidenceSha256: null,
      opeV3ReceiptSha256: null,
      resourceLimitExceeded: false,
      csAudit: notApplicable([
        'verified_synthetic_assumption_evidence_unavailable',
        'objective_tuple_evidence_unavailable',
        'frozen_evaluation_family_unverified',
        HOLDOUT_LEDGER_COMPLETENESS_BLOCKER,
      ]),
      dynamicBlockers: ['inference_qualification_contract_invalid', HOLDOUT_LEDGER_COMPLETENESS_BLOCKER],
    });
  }

  const request = parsed.data;
  const familyEvidence = request.frozenFamilyEvidence;
  const ledgerReceipt = request.holdoutLedgerReceipt;
  const familyVerified = isVerifiedFrozenEvaluationFamilyV1(familyEvidence);
  const ledgerVerified = isVerifiedHoldoutUseLedgerReceiptV1(ledgerReceipt);
  const resourceLimitExceeded = exceedsLimits(request.highWater, request.resourceLimits);
  const ledgerComplete = familyVerified
    && ledgerVerified
    && ledgerReceipt.familySha256 === familyEvidence.familySha256
    && ledgerReceipt.holdoutSha256 === familyEvidence.holdout.holdoutSha256;
  const provenance = {
    frozenFamilyEvidence: familyEvidence,
    holdoutLedgerReceipt: ledgerReceipt,
    syntheticTrajectoryEvidence: request.syntheticTrajectoryEvidence,
    syntheticOutcomeEvidence: request.syntheticOutcomeEvidence,
    syntheticContextEvidence: request.syntheticContextEvidence,
    opeAggregateReceipt: request.opeAggregateReceipt,
  };
  const verifiedCsEvidence = isVerifiedSyntheticTimeUniformCsEvidenceV1(
    request.timeUniformCsEvidence,
  ) ? request.timeUniformCsEvidence : null;
  const csEvidenceBound = isSyntheticTimeUniformCsEvidenceBoundV1(
    request.timeUniformCsEvidence,
    provenance,
  );
  const completeChainBound = ledgerComplete && csEvidenceBound;

  const csAudit = auditTimeUniformCsApplicabilityV1({
    evidence: request.timeUniformCsEvidence,
    evidenceBound: csEvidenceBound,
    familyVerified,
    ledgerComplete,
    resourceLimitExceeded,
    highWater: request.highWater,
  });
  const dynamicBlockers: string[] = [];
  if (resourceLimitExceeded) dynamicBlockers.push('resource_limit_exceeded');
  if (!ledgerComplete) dynamicBlockers.push(HOLDOUT_LEDGER_COMPLETENESS_BLOCKER);

  return result({
    highWater: request.highWater,
    resourceLimits: request.resourceLimits,
    diagnosticReferences: request.diagnosticReferences,
    familySha256: completeChainBound ? familyEvidence.familySha256 : null,
    ledgerReceiptSha256: completeChainBound ? ledgerReceipt.receiptSha256 : null,
    csEvidenceSha256: completeChainBound ? verifiedCsEvidence?.evidenceSha256 ?? null : null,
    trajectoryEvidenceSha256: completeChainBound
      ? verifiedCsEvidence?.provenance.trajectoryEvidenceSha256 ?? null : null,
    opeV3ReceiptSha256: completeChainBound
      ? verifiedCsEvidence?.provenance.opeV3ReceiptSha256 ?? null : null,
    resourceLimitExceeded,
    csAudit,
    dynamicBlockers,
  });
}

function auditTimeUniformCsApplicabilityV1(input: {
  evidence: unknown;
  evidenceBound: boolean;
  familyVerified: boolean;
  ledgerComplete: boolean;
  resourceLimitExceeded: boolean;
  highWater: InferenceQualificationHighWaterV1;
}): TimeUniformCsApplicabilityAuditV1 {
  const reasons: TimeUniformCsApplicabilityReasonV1[] = [];
  let parsed: ReturnType<typeof syntheticTimeUniformCsAssumptionEvidenceV1Schema.safeParse>
    | undefined;
  try {
    parsed = syntheticTimeUniformCsAssumptionEvidenceV1Schema.safeParse(input.evidence);
  } catch {
    parsed = undefined;
  }
  const capabilityVerified = isVerifiedSyntheticTimeUniformCsEvidenceV1(input.evidence);
  if (!capabilityVerified) {
    reasons.push(
      'verified_synthetic_assumption_evidence_unavailable',
      'objective_tuple_evidence_unavailable',
    );
  }
  if (capabilityVerified && !input.evidenceBound) reasons.push('qualification_binding_mismatch');
  if (!input.familyVerified) reasons.push('frozen_evaluation_family_unverified');
  if (!input.ledgerComplete) reasons.push(HOLDOUT_LEDGER_COMPLETENESS_BLOCKER);
  if (input.resourceLimitExceeded) reasons.push('resource_limit_exceeded');
  if (!parsed?.success) return notApplicable(reasons);

  const evidence = parsed.data;
  if (evidence.recordCount !== input.highWater.recordCount
    || evidence.independentClusterCount !== input.highWater.clusterCount
    || evidence.scenarioCount !== input.highWater.scenarioCount
    || evidence.estimatedStateBytes !== input.highWater.estimatedStateBytes) {
    reasons.push('qualification_binding_mismatch');
  }
  if (!evidence.iidContextualBanditRecordsVerified) reasons.push('iid_contextual_bandit_records_unverified');
  if (!evidence.oneActionSlotPerIndependentRecordVerified
    || evidence.actionSlotCount !== evidence.recordCount
    || evidence.independentClusterCount !== evidence.recordCount) {
    reasons.push('independent_single_slot_records_unverified');
  }
  if (!evidence.fixedBehaviorPolicyBeforeOutcomesVerified
    || !evidence.fixedTargetPolicyBeforeOutcomesVerified) {
    reasons.push('fixed_pre_outcome_policies_unverified');
  }
  if (!evidence.supportAudit.absoluteContinuityVerified) reasons.push('absolute_continuity_unverified');
  if (evidence.supportAudit.behaviorPropensityFloor === null
    || evidence.supportAudit.behaviorPropensityFloor <= 0
    || evidence.supportAudit.behaviorPropensityFloor > 1) {
    reasons.push('positive_propensity_floor_unverified');
  }
  if (evidence.supportAudit.maximumImportanceWeight === null
    || evidence.supportAudit.maximumImportanceWeight <= 0) {
    reasons.push('finite_importance_weight_upper_bound_unverified');
  }
  const reward = evidence.rewardAudit;
  if (reward.lowerBound > reward.upperBound) reasons.push('reward_bounds_invalid');
  if (reward.auditedRecordCount !== evidence.recordCount
    || (evidence.recordCount > 0 && (reward.observedMinimum === null || reward.observedMaximum === null))) {
    reasons.push('reward_audit_incomplete');
  }
  if ((reward.observedMinimum !== null && reward.observedMinimum < reward.lowerBound)
    || (reward.observedMaximum !== null && reward.observedMaximum > reward.upperBound)) {
    reasons.push('reward_out_of_bounds');
  }
  if (evidence.dependenceAudit.viewerOrSessionClusteringPresent) reasons.push('viewer_or_session_clustering_present');
  if (evidence.dependenceAudit.temporalDependencePresent) reasons.push('temporal_dependence_present');
  if (evidence.dependenceAudit.commonShockDependencePresent) reasons.push('common_shock_dependence_present');
  if (evidence.dependenceAudit.adaptivePolicySelectionPresent) reasons.push('adaptive_policy_selection_present');
  if (evidence.dependenceAudit.holdoutReusePresent) reasons.push('holdout_reuse_present');

  return reasons.length === 0
    ? {
      contractVersion: TIME_UNIFORM_CS_APPLICABILITY_AUDIT_V1,
      status: 'applicable',
      reasons: [],
      confidenceSequence: null,
    }
    : notApplicable(reasons);
}

function result(input: {
  highWater: InferenceQualificationHighWaterV1;
  resourceLimits: InferenceQualificationResourceLimitsV1;
  diagnosticReferences: InferenceQualificationDiagnosticReferencesV1;
  familySha256: string | null;
  ledgerReceiptSha256: string | null;
  csEvidenceSha256: string | null;
  trajectoryEvidenceSha256: string | null;
  opeV3ReceiptSha256: string | null;
  resourceLimitExceeded: boolean;
  csAudit: TimeUniformCsApplicabilityAuditV1;
  dynamicBlockers: string[];
}): VerifiedInferenceQualificationResultV1 {
  const preimage = {
    contractVersion: INFERENCE_QUALIFICATION_V1,
    status: 'completed_with_abstention' as const,
    selectedMethod: DIAGNOSTICS_ONLY_ABSTENTION_V1,
    blockers: [
      ...input.dynamicBlockers,
      FINITE_SAMPLE_INFERENCE_BLOCKER,
      MULTIPLICITY_CONTROL_BLOCKER,
    ],
    realDatasetEligible: false as const,
    bindings: {
      frozenFamilySha256: input.familySha256,
      holdoutLedgerReceiptSha256: input.ledgerReceiptSha256,
      timeUniformCsEvidenceSha256: input.csEvidenceSha256,
      trajectoryEvidenceSha256: input.trajectoryEvidenceSha256,
      opeV3ReceiptSha256: input.opeV3ReceiptSha256,
    },
    methods: {
      clusterMultiplierBootstrapT: {
        method: input.diagnosticReferences.clusterMultiplierBootstrapT.method,
        status: 'unavailable' as const,
        evidenceSha256: null,
      },
      clusteredWald: {
        method: input.diagnosticReferences.clusteredWald.method,
        status: 'unavailable' as const,
        evidenceSha256: null,
      },
      timeUniformConfidenceSequence: input.csAudit,
      abstention: { status: 'selected' as const, method: DIAGNOSTICS_ONLY_ABSTENTION_V1 },
    },
    diagnostics: {
      highWater: input.highWater,
      resourceLimits: input.resourceLimits,
      resourceLimitExceeded: input.resourceLimitExceeded,
    },
  };
  const candidate = inferenceQualificationResultV1Schema.parse({
    ...preimage,
    qualificationSha256: digest(preimage),
  }) as VerifiedInferenceQualificationResultV1;
  Object.defineProperty(candidate, verifiedResult, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  verifiedResults.add(candidate);
  recursivelyFreeze(candidate);
  verifiedResultDigests.set(candidate, candidate.qualificationSha256);
  return candidate;
}

export function isVerifiedInferenceQualificationResultV1(
  value: unknown,
): value is VerifiedInferenceQualificationResultV1 {
  try {
    if (!value || typeof value !== 'object' || !verifiedResults.has(value)) return false;
    const candidate = value as VerifiedInferenceQualificationResultV1;
    const { qualificationSha256: _digest, ...preimage } = candidate;
    return candidate[verifiedResult] === true
      && recursivelyFrozen(candidate)
      && inferenceQualificationResultV1Schema.safeParse(candidate).success
      && candidate.qualificationSha256 === digest(preimage)
      && verifiedResultDigests.get(candidate) === candidate.qualificationSha256;
  } catch {
    return false;
  }
}

function notApplicable(reasons: TimeUniformCsApplicabilityReasonV1[]): TimeUniformCsApplicabilityAuditV1 {
  return {
    contractVersion: TIME_UNIFORM_CS_APPLICABILITY_AUDIT_V1,
    status: 'not_applicable',
    reasons: [...new Set(reasons)],
    confidenceSequence: null,
  };
}

function exceedsLimits(
  highWater: InferenceQualificationHighWaterV1,
  limits: InferenceQualificationResourceLimitsV1,
): boolean {
  return highWater.scenarioCount > limits.maximumScenarioCount
    || highWater.recordCount > limits.maximumRecordCount
    || highWater.clusterCount > limits.maximumClusterCount
    || highWater.estimatedStateBytes > limits.maximumEstimatedStateBytes;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, property), seen);
  Object.freeze(value);
  return value;
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((property) => recursivelyFrozen(Reflect.get(value, property), seen));
}
