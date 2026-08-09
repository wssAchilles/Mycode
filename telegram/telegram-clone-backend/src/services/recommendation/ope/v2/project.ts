import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { isVerifiedDecisionContextEvidenceV1, type VerifiedDecisionContextEvidenceV1 } from '../../decisionContext/verify';
import { isVerifiedTargetDistributionEvidenceV1, type VerifiedTargetDistributionEvidenceV1 } from '../../offlinePrediction/artifacts/targetDistribution';
import { isVerifiedCrossFittedPredictionSetResultV1, type VerifyCrossFittedPredictionSetResultV1 } from '../../offlinePrediction/artifacts/verify';
import { isVerifiedOutcomeEvidenceV1, outcomeRewardDefinitionSha256V1, type VerifiedOutcomeEvidenceV1 } from '../../outcomes/verifiedOutcomeEvidenceV1';
import {
  OPE_EVALUATION_V2_VERSION, OPE_V2_PROJECTION_VERSION,
  type OpeEvaluationConfigV2, type OpeEvaluationInputV2, type OpeSlotV2,
} from './contracts';

type VerifiedPrediction = Extract<VerifyCrossFittedPredictionSetResultV1, { status: 'verified' }>;
const verifiedProjection = Symbol('verifiedOpeProjectionV2');
const verifiedProjectionDigests = new WeakMap<object, string>();
export type VerifiedProjectedOpeInputV2 = OpeEvaluationInputV2 & { readonly [verifiedProjection]: true };
export type OpeVerifiedProjectionInputV2 = {
  config: OpeEvaluationConfigV2;
  target: VerifiedTargetDistributionEvidenceV1;
  prediction?: VerifiedPrediction;
  outcomeEvidence: VerifiedOutcomeEvidenceV1;
  decisionContextEvidence: VerifiedDecisionContextEvidenceV1;
};
export type OpeVerifiedProjectionResultV2 = { status: 'projected'; input: VerifiedProjectedOpeInputV2 } | { status: 'not_evaluable'; blocker: string };

const digest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Reflect.ownKeys(value).every((property) => recursivelyFrozen(Reflect.get(value, property), seen));
}
export const opeProjectionSha256V2 = (config: OpeEvaluationConfigV2, slots: OpeSlotV2[], evidence: Omit<OpeEvaluationInputV2['projectionReceipt'], 'version' | 'projectionSha256'>) => digest({ config, slots, evidence });
export function isVerifiedProjectedOpeInputV2(value: unknown): value is VerifiedProjectedOpeInputV2 {
  try {
    if (!value || typeof value !== 'object' || (value as Partial<VerifiedProjectedOpeInputV2>)[verifiedProjection] !== true) return false;
    const input = value as VerifiedProjectedOpeInputV2;
    return recursivelyFrozen(input) && verifiedProjectionDigests.get(input) === digest(input);
  } catch {
    return false;
  }
}

export function projectVerifiedOpeEvidenceV2(source: OpeVerifiedProjectionInputV2): OpeVerifiedProjectionResultV2 {
  const target = source.target;
  if (!isVerifiedTargetDistributionEvidenceV1(target)) return { status: 'not_evaluable', blocker: 'unverified_target_evidence' };
  if (!recursivelyFrozen(target)) return { status: 'not_evaluable', blocker: 'target_evidence_mutable' };
  if (target.receipt.status !== 'verified' || target.receipt.verifierVersion !== 'telegram_recommendation_policy_offline_verifier_v1') return { status: 'not_evaluable', blocker: 'target_receipt_unverified' };
  if (target.manifest.datasetVersion !== source.config.datasetVersion) return { status: 'not_evaluable', blocker: 'dataset_version_mismatch' };
  if (target.manifest.policyConfigSha256 !== source.config.targetPolicyConfigSha256) return { status: 'not_evaluable', blocker: 'target_policy_config_digest_mismatch' };
  if (target.receipt.targetManifestSha256 !== target.targetManifestSha256 || target.receipt.sourceDecisionNdjsonSha256 !== target.manifest.sourceDecisionNdjsonSha256 || target.receipt.sourceDatasetManifestSha256 !== target.manifest.sourceDatasetManifestSha256 || target.receipt.policyConfigSha256 !== target.manifest.policyConfigSha256 || target.receipt.distributionNdjsonSha256 !== target.manifest.distributionNdjsonSha256) return { status: 'not_evaluable', blocker: 'target_receipt_digest_mismatch' };
  const prediction = source.prediction;
  if (prediction && !isVerifiedCrossFittedPredictionSetResultV1(prediction)) return { status: 'not_evaluable', blocker: 'unverified_prediction_evidence' };
  if (prediction && !recursivelyFrozen(prediction)) return { status: 'not_evaluable', blocker: 'prediction_evidence_mutable' };
  if (prediction && (prediction.receipt.status !== 'verified' || prediction.receipt.verifierVersion !== 'cross_fitted_prediction_set_verifier_v1')) return { status: 'not_evaluable', blocker: 'prediction_receipt_unverified' };
  if (!isVerifiedOutcomeEvidenceV1(source.outcomeEvidence)) return { status: 'not_evaluable', blocker: 'unverified_outcome_evidence' };
  if (!isVerifiedDecisionContextEvidenceV1(source.decisionContextEvidence)) return { status: 'not_evaluable', blocker: 'unverified_decision_context_evidence' };
  if (source.decisionContextEvidence.crossUserDependence.status !== 'none_observed_in_verified_source_v1') return { status: 'not_evaluable', blocker: 'multiway_cluster_inference_unavailable' };
  if (source.outcomeEvidence.datasetVersion !== source.config.datasetVersion || source.decisionContextEvidence.datasetVersion !== source.config.datasetVersion) return { status: 'not_evaluable', blocker: 'dataset_version_mismatch' };
  let configuredRewardDefinitionSha256: string;
  try {
    configuredRewardDefinitionSha256 = outcomeRewardDefinitionSha256V1(source.config.rewardDefinition);
  } catch {
    return { status: 'not_evaluable', blocker: 'reward_definition_invalid' };
  }
  if (source.outcomeEvidence.rewardDefinitionSha256 !== configuredRewardDefinitionSha256) return { status: 'not_evaluable', blocker: 'reward_definition_mismatch' };

  const targetDecisionIds = source.target.decisions.map((decision) => decision.decisionId);
  const contextDecisionIds = source.decisionContextEvidence.decisions.map((decision) => decision.decisionId);
  const outcomeDecisionIds = source.outcomeEvidence.decisions.map((decision) => decision.decisionId);
  if (!sameMembers(targetDecisionIds, contextDecisionIds) || !sameMembers(targetDecisionIds, outcomeDecisionIds)) return { status: 'not_evaluable', blocker: 'evidence_decision_membership_mismatch' };

  const contexts = new Map(source.decisionContextEvidence.decisions.map((context) => [context.decisionId, context]));
  const outcomeDecisions = new Map(source.outcomeEvidence.decisions.map((outcome) => [outcome.decisionId, outcome]));
  const outcomes = new Map(source.outcomeEvidence.decisions.flatMap((decision) => decision.outcomes.map((outcome) => [
    actionIdentity(outcome.decisionId, outcome.actionKey),
    outcome,
  ] as const)));
  const members = new Map(prediction?.members.map((member) => [member.decisionId, member]) ?? []);
  const slots: OpeSlotV2[] = [];
  for (const targetDecision of target.decisions) {
    const context = contexts.get(targetDecision.decisionId);
    const outcomeDecision = outcomeDecisions.get(targetDecision.decisionId);
    const decision = context?.decisionLog;
    if (!context || !outcomeDecision || !decision || context.datasetVersion !== source.config.datasetVersion || context.requestId !== decision.requestId || context.decisionAt !== decision.decisionAt || context.decisionLogSha256 !== targetDecision.decisionLogSha256 || context.candidatePoolSha256 !== targetDecision.candidatePoolSha256 || digest(decision) !== targetDecision.decisionLogSha256 || decision.candidatePool.candidatePoolSha256 !== targetDecision.candidatePoolSha256) return { status: 'not_evaluable', blocker: 'decision_digest_mismatch' };
    if (outcomeDecision.requestId !== decision.requestId || outcomeDecision.decisionLogSha256 !== targetDecision.decisionLogSha256 || outcomeDecision.candidatePoolSha256 !== targetDecision.candidatePoolSha256) return { status: 'not_evaluable', blocker: 'outcome_decision_binding_mismatch' };
    const subjectTraceUserId = context.subject.kind === 'viewer' ? context.subject.viewerAccountPseudonym : context.subject.syntheticViewerId;
    if (subjectTraceUserId !== outcomeDecision.traceUserId) return { status: 'not_evaluable', blocker: 'decision_subject_mismatch' };
    if (decision.candidatePool.truncated || decision.candidatePool.supportEvidence.status !== 'complete') return { status: 'not_evaluable', blocker: 'behavior_support_incomplete' };
    if (decision.behaviorPolicy.policyId !== source.config.behaviorPolicy.policyId || decision.behaviorPolicy.policyVersion.status !== 'bound' || decision.behaviorPolicy.policyVersion.version !== source.config.behaviorPolicy.policyVersion) return { status: 'not_evaluable', blocker: 'behavior_policy_binding_mismatch' };
    for (const version of Object.keys(source.config.decisionVersions) as Array<keyof typeof source.config.decisionVersions>) {
      if (decision.versions[version].status !== 'bound' || decision.versions[version].version !== source.config.decisionVersions[version]) return { status: 'not_evaluable', blocker: 'decision_version_mismatch' };
    }
    const member = members.get(decision.decisionId);
    if (prediction && (!member || member.datasetVersion !== source.config.datasetVersion || member.decisionLogSha256 !== targetDecision.decisionLogSha256 || member.candidatePoolSha256 !== targetDecision.candidatePoolSha256 || member.predictionSetVersion !== prediction.receipt.predictionSetVersion || member.modelBundleSha256 !== prediction.receipt.modelBundleSha256 || member.objective !== source.config.rewardDefinition.objective || member.rewardDefinitionVersion !== source.config.rewardDefinition.definitionVersion || member.horizonMs !== source.config.rewardDefinition.horizonMs)) return { status: 'not_evaluable', blocker: 'prediction_set_membership_mismatch' };
    for (const step of targetDecision.steps) {
      if (step.servedPosition < 1 || step.servedPosition > 64) return { status: 'not_evaluable', blocker: 'served_position_out_of_range' };
      const loggedAtPosition = decision.actions.filter((action) => action.actionKey.servedPosition === step.servedPosition);
      const logged = loggedAtPosition.length === 1 ? loggedAtPosition[0] : undefined;
      const outcome = logged ? outcomes.get(actionIdentity(decision.decisionId, logged.actionKey)) : undefined;
      if (!logged || !outcome || canonicalDecisionJson(step.prefixActionKeys) !== canonicalDecisionJson(slots.filter((slot) => slot.decisionId === decision.decisionId).map((slot) => slot.loggedActionKey))) return { status: 'not_evaluable', blocker: 'prefix_identity_mismatch' };
      if (decision.behaviorPolicyKind !== 'logged_randomized' || logged.behaviorPropensity.status !== 'logged_randomized') return { status: 'not_evaluable', blocker: 'deterministic_top_no_logged_probability' };
      const prefixIdentities = new Set(step.prefixActionKeys.map((actionKey) => `${actionKey.candidateNamespace}\u0000${actionKey.candidateId}`));
      const supportActions = decision.candidatePool.candidates.filter((candidate) => candidate.eligible && !prefixIdentities.has(`${candidate.candidateNamespace}\u0000${candidate.candidateId}`)).map((candidate) => ({ candidateNamespace: candidate.candidateNamespace, candidateId: candidate.candidateId, servedPosition: step.servedPosition }));
      const predictions = member?.predictions.filter((entry) => entry.actionKey.servedPosition === step.servedPosition).map((entry) => ({ actionKey: entry.actionKey, value: entry.qHat }));
      slots.push({ decisionId: decision.decisionId, servedPosition: step.servedPosition, binding: { decisionId: decision.decisionId, requestId: decision.requestId, datasetVersion: source.config.datasetVersion, decisionLogSha256: targetDecision.decisionLogSha256, candidatePoolSha256: targetDecision.candidatePoolSha256, contextAt: context.contextAt, availableAt: context.availableAt, sourceSha256: context.sourceSha256, sourceVersion: context.sourceVersion, inferenceClusterId: context.inferenceClusterId, clusterUnitVersion: context.clusterUnitVersion, realDatasetEligible: context.realDatasetEligible, crossUserDependenceStatus: source.decisionContextEvidence.crossUserDependence.status, decisionVersions: { ...source.config.decisionVersions } }, loggedActionKey: { ...logged.actionKey }, prefixActionKeys: step.prefixActionKeys.map((actionKey) => ({ ...actionKey })), outcome: { reward: outcome.reward, outcomeContractVersion: outcome.outcome.contractVersion }, behaviorSupport: { status: 'logged_randomized', loggedActionProbability: logged.behaviorPropensity.selectionProbability, supportActions }, targetDistribution: { actions: step.actions.map((entry) => ({ actionKey: { ...entry.actionKey }, probability: entry.probability })) }, segments: Object.keys(context.segments).length > 0 ? { ...context.segments } : undefined, prediction: prediction && member && predictions ? { predictionSetVersion: member.predictionSetVersion, modelBundleSha256: member.modelBundleSha256, receiptSha256: prediction.receipt.verificationReceiptSha256, trainingReplaySha256: prediction.receipt.trainingExamplesNdjsonSha256, qHat: predictions.map((entry) => ({ actionKey: { ...entry.actionKey }, value: entry.value })) } : undefined });
    }
  }
  const evidence = { targetManifestSha256: target.targetManifestSha256, targetReceiptSha256: target.targetReceiptRawSha256, outcomeEvidenceSha256: source.outcomeEvidence.outcomeEvidenceSha256, decisionContextEvidenceSha256: source.decisionContextEvidence.decisionContextEvidenceSha256, predictionReceiptSha256: prediction?.receipt.verificationReceiptSha256, trainingReplaySha256: prediction?.receipt.trainingExamplesNdjsonSha256 };
  let projectedConfig: OpeEvaluationConfigV2;
  let projectedSlots: OpeSlotV2[];
  try {
    projectedConfig = structuredClone(source.config);
    projectedSlots = structuredClone(slots);
  } catch {
    return { status: 'not_evaluable', blocker: 'projection_clone_failed' };
  }
  const input = { contractVersion: OPE_EVALUATION_V2_VERSION, config: projectedConfig, slots: projectedSlots, projectionReceipt: { version: OPE_V2_PROJECTION_VERSION, projectionSha256: opeProjectionSha256V2(projectedConfig, projectedSlots, evidence), ...evidence } } as VerifiedProjectedOpeInputV2;
  Object.defineProperty(input, verifiedProjection, { value: true, enumerable: false, configurable: false });
  recursivelyFreeze(input);
  verifiedProjectionDigests.set(input, digest(input));
  return { status: 'projected', input };
}

export const projectVerifiedTargetDistributionV2 = projectVerifiedOpeEvidenceV2;
export const projectVerifiedPredictionEvidenceV2 = projectVerifiedOpeEvidenceV2;

function actionIdentity(
  decisionId: string,
  actionKey: { candidateNamespace: string; candidateId: string; servedPosition: number },
): string {
  return `${decisionId}\u0000${actionKey.candidateNamespace}\u0000${actionKey.candidateId}\u0000${actionKey.servedPosition}`;
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightMembers = new Set(right);
  return rightMembers.size === right.length && left.every((value) => rightMembers.has(value));
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, property), seen);
  Object.freeze(value);
  return value;
}
