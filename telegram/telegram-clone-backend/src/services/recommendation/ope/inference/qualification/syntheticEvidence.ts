import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../decisionLog/contracts';
import {
  isVerifiedSyntheticContextV1,
  type VerifiedSyntheticContextV1,
} from '../../../decisionContext/syntheticContextV1';
import {
  isVerifiedSyntheticTrajectoryEvidenceV1,
  type VerifiedSyntheticTrajectoryEvidenceV1,
} from '../../../offlinePrediction/streamingV2';
import {
  isVerifiedOpeAggregateReceiptV3,
  type VerifiedOpeAggregateReceiptV3,
} from '../../v3';
import {
  isVerifiedSyntheticOutcomeEvidenceV1,
  type VerifiedSyntheticOutcomeEvidenceV1,
} from '../../../outcomes/syntheticOutcomeEvidenceV1';
import {
  isVerifiedFrozenEvaluationFamilyV1,
  isVerifiedHoldoutUseLedgerReceiptV1,
  type VerifiedFrozenEvaluationFamilyV1,
  type VerifiedHoldoutUseLedgerReceiptV1,
} from '../../../promotion/evaluationProtocol';
import {
  SYNTHETIC_CS_ASSUMPTION_EVIDENCE_V1,
  syntheticTimeUniformCsAssumptionEvidenceV1Schema,
  type SyntheticTimeUniformCsAssumptionEvidenceV1,
} from './contracts';

const verifiedEvidence = Symbol('verifiedSyntheticTimeUniformCsAssumptionEvidenceV1');
const verifiedEvidenceSet = new WeakSet<object>();
const verifiedEvidenceDigests = new WeakMap<object, string>();

type SyntheticEvidenceProvenanceV1 = {
  frozenFamilyEvidence: VerifiedFrozenEvaluationFamilyV1;
  holdoutLedgerReceipt: VerifiedHoldoutUseLedgerReceiptV1;
  syntheticTrajectoryEvidence: VerifiedSyntheticTrajectoryEvidenceV1;
  syntheticOutcomeEvidence: VerifiedSyntheticOutcomeEvidenceV1;
  syntheticContextEvidence: VerifiedSyntheticContextV1;
  opeAggregateReceipt: VerifiedOpeAggregateReceiptV3;
};

type SyntheticEvidenceChainV1 = Omit<SyntheticEvidenceProvenanceV1, 'holdoutLedgerReceipt'>;

export type SyntheticFamilyTrajectoryBindingBlockerV1 =
  | 'synthetic_cs_provenance_unverified'
  | 'synthetic_cs_segment_binding_mismatch'
  | 'synthetic_cs_objective_tuple_binding_mismatch'
  | 'synthetic_cs_policy_binding_mismatch'
  | 'synthetic_cs_dataset_binding_mismatch'
  | 'synthetic_cs_evidence_root_binding_mismatch'
  | 'synthetic_cs_config_binding_mismatch'
  | 'objective_tuple_evidence_unavailable';

export type IssueSyntheticTimeUniformCsEvidenceResultV1 =
  | { status: 'verified'; evidence: VerifiedSyntheticTimeUniformCsAssumptionEvidenceV1 }
  | {
    status: 'not_evaluable';
    blocker:
      | 'synthetic_cs_provenance_unverified'
      | Exclude<SyntheticFamilyTrajectoryBindingBlockerV1, 'synthetic_cs_provenance_unverified'>;
  };

export type VerifiedSyntheticTimeUniformCsAssumptionEvidenceV1 = SyntheticTimeUniformCsAssumptionEvidenceV1 & {
  readonly [verifiedEvidence]: true;
};

export function issueSyntheticTimeUniformCsEvidenceV1(
  input: unknown,
): IssueSyntheticTimeUniformCsEvidenceResultV1 {
  let provenance: SyntheticEvidenceProvenanceV1 | null;
  try {
    provenance = verifiedProvenance(input);
  } catch {
    provenance = null;
  }
  if (!provenance) return { status: 'not_evaluable', blocker: 'synthetic_cs_provenance_unverified' };
  const bindingAudit = familyTrajectoryBindingBlockers(provenance);
  if (bindingAudit.length > 0) return { status: 'not_evaluable', blocker: bindingAudit[0]! };
  const { frozenFamilyEvidence: family, holdoutLedgerReceipt: ledger,
    syntheticTrajectoryEvidence: trajectory, syntheticOutcomeEvidence: outcome,
    opeAggregateReceipt: receipt } = provenance;
  const rewards = outcome.outcomes.map((entry) => entry.reward);
  const observedMinimum = Math.min(...rewards);
  const observedMaximum = Math.max(...rewards);
  const behaviorPropensityFloor = Math.min(...trajectory.steps.map((step) => step.behaviorProbability));
  const oneSlotPerCluster = receipt.observedSlotCount === receipt.highWaterDiagnostics.clusters
    && trajectory.expectedStepCount === 1;
  const reviewedSyntheticPreimage = {
    contractVersion: SYNTHETIC_CS_ASSUMPTION_EVIDENCE_V1,
    sourceScope: 'synthetic_fixture' as const,
    protocolBinding: 'immutable_frozen_protocol_v1' as const,
    provenance: {
      frozenFamilySha256: family.familySha256,
      holdoutLedgerReceiptSha256: ledger.receiptSha256,
      datasetSha256: family.dataset.datasetSha256,
      datasetVersion: outcome.datasetVersion,
      trajectoryEvidenceSha256: trajectory.trajectoryEvidenceSha256,
      syntheticOutcomeEvidenceSha256: outcome.syntheticOutcomeEvidenceSha256,
      syntheticContextSha256: trajectory.syntheticContextSha256,
      behaviorPolicyConfigSha256: trajectory.behaviorPolicyConfigSha256,
      targetPolicyConfigSha256: trajectory.targetPolicyConfigSha256,
      opeV3ReceiptSha256: receipt.receiptSha256,
      opeV3StateBindingSha256: receipt.stateBindingSha256,
      trajectoryCohortSha256: receipt.trajectoryCohortSha256,
      targetEvidenceRootsSha256: receipt.targetEvidenceRootsSha256,
    },
    // The current V3 fixture is sequential and does not expose a verified all-action weight bound.
    iidContextualBanditRecordsVerified: false,
    oneActionSlotPerIndependentRecordVerified: oneSlotPerCluster,
    fixedBehaviorPolicyBeforeOutcomesVerified: true,
    fixedTargetPolicyBeforeOutcomesVerified: true,
    supportAudit: {
      absoluteContinuityVerified: false,
      behaviorPropensityFloor,
      maximumImportanceWeight: null,
    },
    rewardAudit: {
      lowerBound: outcome.rewardBounds.minimum,
      upperBound: outcome.rewardBounds.maximum,
      observedMinimum,
      observedMaximum,
      auditedRecordCount: receipt.observedSlotCount,
    },
    dependenceAudit: {
      viewerOrSessionClusteringPresent: receipt.highWaterDiagnostics.clusters
        < receipt.observedSlotCount,
      temporalDependencePresent: trajectory.expectedStepCount > 1,
      commonShockDependencePresent: false,
      adaptivePolicySelectionPresent: false,
      holdoutReusePresent: false,
    },
    recordCount: receipt.observedSlotCount,
    actionSlotCount: receipt.observedSlotCount,
    independentClusterCount: receipt.highWaterDiagnostics.clusters,
    scenarioCount: 1,
    estimatedStateBytes: receipt.highWaterDiagnostics.estimatedAggregateStateBytes,
  };
  const evidenceSha256 = digest(reviewedSyntheticPreimage);
  const evidence = syntheticTimeUniformCsAssumptionEvidenceV1Schema.parse({
    ...reviewedSyntheticPreimage,
    evidenceSha256,
  }) as VerifiedSyntheticTimeUniformCsAssumptionEvidenceV1;
  Object.defineProperty(evidence, verifiedEvidence, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  verifiedEvidenceSet.add(evidence);
  recursivelyFreeze(evidence);
  verifiedEvidenceDigests.set(evidence, evidence.evidenceSha256);
  return { status: 'verified', evidence };
}

export function isVerifiedSyntheticTimeUniformCsEvidenceV1(
  value: unknown,
): value is VerifiedSyntheticTimeUniformCsAssumptionEvidenceV1 {
  try {
    if (!value || typeof value !== 'object' || !verifiedEvidenceSet.has(value)) return false;
    const evidence = value as VerifiedSyntheticTimeUniformCsAssumptionEvidenceV1;
    const { evidenceSha256: _digest, ...preimage } = evidence;
    return evidence[verifiedEvidence] === true
      && recursivelyFrozen(evidence)
      && evidence.evidenceSha256 === digest(preimage)
      && verifiedEvidenceDigests.get(evidence) === evidence.evidenceSha256;
  } catch {
    return false;
  }
}

export function isSyntheticTimeUniformCsEvidenceBoundV1(
  evidence: unknown,
  input: unknown,
): boolean {
  if (!isVerifiedSyntheticTimeUniformCsEvidenceV1(evidence)) return false;
  let provenance: SyntheticEvidenceProvenanceV1 | null;
  try {
    provenance = verifiedProvenance(input);
  } catch {
    return false;
  }
  if (!provenance || familyTrajectoryBindingBlockers(provenance).length > 0) return false;
  const { frozenFamilyEvidence: family, holdoutLedgerReceipt: ledger,
    syntheticTrajectoryEvidence: trajectory, syntheticOutcomeEvidence: outcome,
    opeAggregateReceipt: receipt } = provenance;
  const binding = evidence.provenance;
  return binding.frozenFamilySha256 === family.familySha256
    && binding.holdoutLedgerReceiptSha256 === ledger.receiptSha256
    && binding.datasetSha256 === family.dataset.datasetSha256
    && binding.datasetVersion === outcome.datasetVersion
    && binding.trajectoryEvidenceSha256 === trajectory.trajectoryEvidenceSha256
    && binding.syntheticOutcomeEvidenceSha256 === outcome.syntheticOutcomeEvidenceSha256
    && binding.syntheticContextSha256 === trajectory.syntheticContextSha256
    && binding.behaviorPolicyConfigSha256 === trajectory.behaviorPolicyConfigSha256
    && binding.targetPolicyConfigSha256 === trajectory.targetPolicyConfigSha256
    && binding.opeV3ReceiptSha256 === receipt.receiptSha256
    && binding.opeV3StateBindingSha256 === receipt.stateBindingSha256
    && binding.trajectoryCohortSha256 === receipt.trajectoryCohortSha256
    && binding.targetEvidenceRootsSha256 === receipt.targetEvidenceRootsSha256;
}

function verifiedProvenance(input: unknown): SyntheticEvidenceProvenanceV1 | null {
  const chain = verifiedEvidenceChain(input);
  if (!chain || !input || typeof input !== 'object') return null;
  const ledger = (input as Partial<SyntheticEvidenceProvenanceV1>).holdoutLedgerReceipt;
  if (!isVerifiedHoldoutUseLedgerReceiptV1(ledger)
    || ledger.familySha256 !== chain.frozenFamilyEvidence.familySha256
    || ledger.holdoutSha256 !== chain.frozenFamilyEvidence.holdout.holdoutSha256) return null;
  return { ...chain, holdoutLedgerReceipt: ledger };
}

function verifiedEvidenceChain(input: unknown): SyntheticEvidenceChainV1 | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<SyntheticEvidenceProvenanceV1>;
  const family = value.frozenFamilyEvidence;
  const trajectory = value.syntheticTrajectoryEvidence;
  const outcome = value.syntheticOutcomeEvidence;
  const context = value.syntheticContextEvidence;
  const receipt = value.opeAggregateReceipt;
  if (!isVerifiedFrozenEvaluationFamilyV1(family)
    || !isVerifiedSyntheticTrajectoryEvidenceV1(trajectory)
    || !isVerifiedSyntheticOutcomeEvidenceV1(outcome)
    || !isVerifiedSyntheticContextV1(context)
    || !isVerifiedOpeAggregateReceiptV3(receipt)) return null;
  if (trajectory.syntheticOutcomeEvidenceSha256 !== outcome.syntheticOutcomeEvidenceSha256
    || trajectory.syntheticContextSha256 !== context.syntheticContextSha256
    || outcome.datasetVersion !== context.datasetVersion
    || receipt.trajectoryCohortSha256 !== digest([trajectory.trajectoryEvidenceSha256])
    || receipt.outcomeEvidenceRootsSha256 !== digest([trajectory.syntheticOutcomeEvidenceSha256])
    || receipt.contextEvidenceRootsSha256 !== digest([trajectory.syntheticContextSha256])
    || receipt.targetEvidenceRootsSha256 !== digest([{
      targetManifestSha256: trajectory.targetManifestSha256,
      targetVerificationReceiptSha256: trajectory.targetVerificationReceiptSha256,
      targetDistributionNdjsonSha256: trajectory.targetDistributionNdjsonSha256,
    }])
    || receipt.expectedDecisionCount !== 1
    || receipt.observedDecisionCount !== 1
    || receipt.expectedSlotCount !== trajectory.expectedStepCount
    || receipt.observedSlotCount !== trajectory.expectedStepCount) return null;
  return { frozenFamilyEvidence: family,
    syntheticTrajectoryEvidence: trajectory, syntheticOutcomeEvidence: outcome,
    syntheticContextEvidence: context,
    opeAggregateReceipt: receipt };
}

export function auditSyntheticFamilyTrajectoryBindingsV1(input: unknown): {
  status: 'not_evaluable';
  blockers: SyntheticFamilyTrajectoryBindingBlockerV1[];
} {
  let chain: SyntheticEvidenceChainV1 | null;
  try {
    chain = verifiedEvidenceChain(input);
  } catch {
    chain = null;
  }
  return {
    status: 'not_evaluable',
    blockers: chain
      ? familyTrajectoryBindingBlockers(chain)
      : ['synthetic_cs_provenance_unverified'],
  };
}

function familyTrajectoryBindingBlockers(
  input: SyntheticEvidenceChainV1,
): SyntheticFamilyTrajectoryBindingBlockerV1[] {
  const { frozenFamilyEvidence: family, syntheticTrajectoryEvidence: trajectory,
    syntheticOutcomeEvidence: outcome, syntheticContextEvidence: context,
    opeAggregateReceipt: receipt } = input;
  const familySegments = family.segments.map((segment) => ({
    key: segment.segmentKey,
    value: segment.segmentValue,
  }));
  const expectedDatasetSha256 = digest({
    contractVersion: 'synthetic_inference_dataset_binding_v1',
    datasetId: outcome.datasetVersion,
    outcomeEvidenceSha256: outcome.syntheticOutcomeEvidenceSha256,
    contextEvidenceSha256: context.syntheticContextSha256,
    trajectoryEvidenceSha256: trajectory.trajectoryEvidenceSha256,
  });
  const expectedEvidenceBindings = new Map([
    ['outcome_evidence', outcome.syntheticOutcomeEvidenceSha256],
    ['decision_context', context.syntheticContextSha256],
    ['target_distribution', receipt.targetEvidenceRootsSha256],
    ['synthetic_trajectory', trajectory.trajectoryEvidenceSha256],
    ['ope_v3_receipt', receipt.receiptSha256],
  ]);
  const expectedConfigBindings = new Map([
    ['ope_config', receipt.resourceConfigSha256],
  ]);
  const blockers: SyntheticFamilyTrajectoryBindingBlockerV1[] = [];
  if (canonicalDecisionJson(familySegments) !== canonicalDecisionJson(context.segmentAssignments)
    || !family.segments.every((segment) => (
      segment.contextSourceVersion === context.sourceVersion
      && segment.contextSourceSha256 === context.sourceSha256
      && segment.pitBoundary === 'context_at_lte_available_at_lte_decision_at_v1'
    ))) blockers.push('synthetic_cs_segment_binding_mismatch');
  if (family.estimand !== 'mean_reward_per_logged_slot_v1'
    || family.objectives.length !== 1
    || family.objectives[0]?.objective !== outcome.objective) {
    blockers.push('synthetic_cs_objective_tuple_binding_mismatch');
  }
  if (family.candidatePolicies.length !== 1
    || family.candidatePolicies[0]?.policyId !== 'eligible_pool_epsilon_plackett_luce_v1'
    || family.candidatePolicies[0]?.policyVersion !== 'epsilon-pl-v1'
    || family.candidatePolicies[0]?.policyConfigSha256 !== trajectory.targetPolicyConfigSha256) {
    blockers.push('synthetic_cs_policy_binding_mismatch');
  }
  if (family.dataset.datasetId !== outcome.datasetVersion
    || family.dataset.datasetSha256 !== expectedDatasetSha256) {
    blockers.push('synthetic_cs_dataset_binding_mismatch');
  }
  if (family.evidenceBindings.length !== expectedEvidenceBindings.size
    || !family.evidenceBindings.every((binding) => (
      expectedEvidenceBindings.get(binding.bindingId) === binding.sha256
    ))) blockers.push('synthetic_cs_evidence_root_binding_mismatch');
  if (family.configBindings.length !== expectedConfigBindings.size
    || !family.configBindings.every((binding) => (
      expectedConfigBindings.get(binding.bindingId) === binding.sha256
    ))) blockers.push('synthetic_cs_config_binding_mismatch');
  // V3 does not carry estimator/operator/threshold evidence; a family digest cannot self-certify it.
  blockers.push('objective_tuple_evidence_unavailable');
  return blockers;
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
