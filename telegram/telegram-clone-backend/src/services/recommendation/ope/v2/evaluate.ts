import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { isVerifiedProjectedOpeInputV2 } from './project';
import {
  OPE_EVALUATION_V2_VERSION, OPE_V2_CI_METHOD, OPE_V2_CI_VERSION, OPE_V2_ESTIMAND,
  opeEvaluationV2InputSchema, type OpeEvaluationConfigV2, type OpeEvaluationInputV2,
  type OpeEvaluationResultV2, type OpeSlotV2, type V2Confidence, type V2Estimator,
} from './contracts';

const digest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
export const opeEvaluationReportSha256V2 = (report: Omit<OpeEvaluationResultV2, 'fingerprints'> | OpeEvaluationResultV2) => {
  const { fingerprints: _fingerprints, ...body } = report as OpeEvaluationResultV2;
  return digest(body);
};
const zFor = (level: number) => level === 0.9 ? 1.6448536269514722 : level === 0.99 ? 2.5758293035489004 : 1.959963984540054;
const key = (value: unknown) => canonicalDecisionJson(value);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

type NumericalBlocker = 'importance_weight_overflow' | 'importance_weight_underflow' | 'importance_contribution_overflow' | 'importance_contribution_underflow' | 'clipped_contribution_overflow' | 'clipped_contribution_underflow';
export type OpeContributionRowV2 = { slot: OpeSlotV2; reward: number; logPrefix: number; logWeight: number; prefix?: number; weight?: number; clipped?: number; ips?: number; clippedIps?: number; weightBlocker?: NumericalBlocker; rawContributionBlocker?: NumericalBlocker; clippedContributionBlocker?: NumericalBlocker };
type Row = OpeContributionRowV2;
const LOG_MAX = Math.log(Number.MAX_VALUE);
const LOG_MIN = Math.log(Number.MIN_VALUE);
function scaled(logFactor: number, value: number, prefix: 'importance' | 'clipped'): { value?: number; blocker?: NumericalBlocker } {
  if (value === 0 || logFactor === Number.NEGATIVE_INFINITY) return { value: 0 };
  const logProduct = logFactor + Math.log(Math.abs(value));
  if (logProduct > LOG_MAX) return { blocker: `${prefix}_contribution_overflow` };
  if (logProduct < LOG_MIN) return { blocker: `${prefix}_contribution_underflow` };
  return { value: Math.sign(value) * Math.exp(logProduct) };
}

export function evaluateOpeV2(input: unknown): OpeEvaluationResultV2 {
  if (!isVerifiedProjectedOpeInputV2(input)) return invalidResult('unverified_projection');
  const parsed = opeEvaluationV2InputSchema.safeParse(input);
  if (!parsed.success) return invalidResult('invalid_input');
  const value = parsed.data;
  const inputSha256 = digest(value);
  const structural = validateStructure(value);
  const bindings = {
    estimand: OPE_V2_ESTIMAND, datasetVersion: value.config.datasetVersion,
    outcomeContractVersion: value.config.outcomeContractVersion, behaviorPolicy: value.config.behaviorPolicy,
    targetPolicy: value.config.targetPolicy, targetPolicyConfigSha256: value.config.targetPolicyConfigSha256, decisionVersions: value.config.decisionVersions,
    rewardDefinition: value.config.rewardDefinition, ci: value.config.ci, predictionEvidence: value.config.predictionEvidence,
  } as const;
  if (structural.length) return blocked(value, inputSha256, structural, bindings);

  const rows = buildRows(value);
  if (!rows) return blocked(value, inputSha256, ['non_finite_aggregate'], bindings);
  const predictionBlocker = predictionPreflight(value, rows);
  const core = summarize(rows, value.config, predictionBlocker);
  const result = {
    contractVersion: OPE_EVALUATION_V2_VERSION, estimand: OPE_V2_ESTIMAND,
    status: Object.values(core.estimators).every((estimator) => estimator.status === 'evaluated') ? 'evaluated' as const : 'partial' as const,
    observations: { total: rows.length, accepted: rows.length, rejected: 0, coverage: 1, uniqueDecisionClusters: clusterCount(rows) },
    estimators: core.estimators, confidenceIntervals: core.confidenceIntervals, diagnostics: core.diagnostics,
    segments: segmentReports(rows, value.config, predictionBlocker), bindings, fingerprints: null as OpeEvaluationResultV2['fingerprints'],
  };
  result.fingerprints = { inputSha256, evaluationSha256: opeEvaluationReportSha256V2(result), estimand: OPE_V2_ESTIMAND, ciConfigSha256: digest(value.config.ci), targetPolicyConfigSha256: value.config.targetPolicyConfigSha256 };
  return result;
}

export const evaluateOpeEvaluationV2 = evaluateOpeV2;

function validateStructure(input: OpeEvaluationInputV2): string[] {
  if (input.slots.length === 0) return ['empty_observations'];
  const blockers: string[] = [];
  const expectedProjection = digest({ config: input.config, slots: input.slots, evidence: {
    targetManifestSha256: input.projectionReceipt.targetManifestSha256,
    targetReceiptSha256: input.projectionReceipt.targetReceiptSha256,
    outcomeEvidenceSha256: input.projectionReceipt.outcomeEvidenceSha256,
    decisionContextEvidenceSha256: input.projectionReceipt.decisionContextEvidenceSha256,
    predictionReceiptSha256: input.projectionReceipt.predictionReceiptSha256,
    trainingReplaySha256: input.projectionReceipt.trainingReplaySha256,
  } });
  if (expectedProjection !== input.projectionReceipt.projectionSha256) blockers.push('projection_digest_mismatch');
  const decisionIds = new Set(input.slots.map((slot) => slot.decisionId));
  if (decisionIds.size > 100_000) blockers.push('decision_count_limit_exceeded');
  const byDecision = new Map<string, OpeSlotV2[]>();
  const bindingDigests = new Map<string, string>();
  for (const slot of input.slots) {
    const rows = byDecision.get(slot.decisionId) ?? [];
    rows.push(slot); byDecision.set(slot.decisionId, rows);
    const digestValue = key(slot.binding);
    const previous = bindingDigests.get(slot.decisionId);
    if (previous && previous !== digestValue) blockers.push('decision_binding_mismatch');
    bindingDigests.set(slot.decisionId, digestValue);
    if (slot.binding.decisionId && slot.binding.decisionId !== slot.decisionId) blockers.push('decision_identity_mismatch');
    if (slot.binding.datasetVersion !== input.config.datasetVersion) blockers.push('dataset_version_mismatch');
    if (slot.binding.decisionVersions && key(slot.binding.decisionVersions) !== key(input.config.decisionVersions)) blockers.push('decision_version_mismatch');
    if (!slot.outcome.outcomeContractVersion || slot.outcome.outcomeContractVersion !== input.config.outcomeContractVersion) blockers.push('outcome_version_mismatch');
    const behavior = slot.behaviorSupport.supportActions;
    const target = slot.targetDistribution.actions;
    if (behavior.some((actionKey) => actionKey.servedPosition !== slot.servedPosition) || target.some((entry) => entry.actionKey.servedPosition !== slot.servedPosition) || slot.loggedActionKey.servedPosition !== slot.servedPosition) blockers.push('slot_identity_mismatch');
    if (!distributionValid(target)) blockers.push('probability_invalid');
    if (new Set(behavior.map(key)).size !== behavior.length) blockers.push('behavior_support_duplicate');
    if (new Set(target.map((entry) => key(entry.actionKey))).size !== target.length) blockers.push('target_support_duplicate');
    const b = new Set(behavior.map(key));
    for (const entry of target) if (entry.probability > 0 && !b.has(key(entry.actionKey))) blockers.push('support_incomplete');
    if (!b.has(key(slot.loggedActionKey))) blockers.push('behavior_support_missing_logged_action');
    if (!Number.isFinite(slot.outcome.reward)) blockers.push('non_finite_reward');
  }
  for (const rows of byDecision.values()) {
    rows.sort((a, b) => a.servedPosition - b.servedPosition);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      if (row.servedPosition !== index + 1) blockers.push('prefix_identity_mismatch');
      const expectedPrefix = rows.slice(0, index).map((prior) => prior.loggedActionKey);
      if (key(row.prefixActionKeys) !== key(expectedPrefix)) blockers.push('prefix_identity_mismatch');
    }
  }
  return stable(blockers);
}

function distributionValid(values: Array<{ probability: number }>): boolean {
  const total = sum(values.map((entry) => entry.probability));
  return Number.isFinite(total) && values.every((entry) => Number.isFinite(entry.probability) && entry.probability >= 0 && entry.probability <= 1) && Math.abs(total - 1) <= 1e-8;
}

export function buildOpeContributionRowsV2(input: OpeEvaluationInputV2): OpeContributionRowV2[] | undefined {
  const byDecision = new Map<string, OpeSlotV2[]>();
  for (const slot of input.slots) (byDecision.get(slot.decisionId) ?? (byDecision.set(slot.decisionId, []), byDecision.get(slot.decisionId)!)).push(slot);
  const rows: Row[] = [];
  for (const slots of byDecision.values()) {
    slots.sort((a, b) => a.servedPosition - b.servedPosition);
    let logPrefix = 0;
    for (const slot of slots) {
      const target = new Map(slot.targetDistribution.actions.map((entry) => [key(entry.actionKey), entry.probability]));
      const actionKey = key(slot.loggedActionKey);
      const targetProbability = target.get(actionKey) ?? 0;
      const logRatio = targetProbability === 0 ? Number.NEGATIVE_INFINITY : Math.log(targetProbability) - Math.log(slot.behaviorSupport.loggedActionProbability);
      const logWeight = logPrefix + logRatio;
      const weightBlocker = logWeight > LOG_MAX ? 'importance_weight_overflow' : logWeight < LOG_MIN && logWeight !== Number.NEGATIVE_INFINITY ? 'importance_weight_underflow' : undefined;
      const prefix = logPrefix <= LOG_MAX && logPrefix >= LOG_MIN ? Math.exp(logPrefix) : undefined;
      const weight = weightBlocker ? undefined : logWeight === Number.NEGATIVE_INFINITY ? 0 : Math.exp(logWeight);
      const clippedLog = Math.min(logWeight, Math.log(input.config.clip));
      const clipped = clippedLog < LOG_MIN && clippedLog !== Number.NEGATIVE_INFINITY ? undefined : clippedLog === Number.NEGATIVE_INFINITY ? 0 : Math.exp(clippedLog);
      const rawContribution = scaled(logWeight, slot.outcome.reward, 'importance');
      const clippedContribution = scaled(clippedLog, slot.outcome.reward, 'clipped');
      const row: Row = { slot, reward: slot.outcome.reward, logPrefix, logWeight, prefix, weight, clipped, weightBlocker, ips: rawContribution.value, clippedIps: clippedContribution.value, rawContributionBlocker: rawContribution.blocker, clippedContributionBlocker: clippedContribution.blocker };
      rows.push(row);
      logPrefix = logWeight;
    }
  }
  return rows;
}

const buildRows = buildOpeContributionRowsV2;

function predictionPreflight(input: OpeEvaluationInputV2, rows: Row[]): string | undefined {
  const expected = input.config.predictionEvidence;
  if (!expected || rows.some(({ slot }) => !slot.prediction)) return 'prediction_support_incomplete';
  let versionMismatch = false;
  let bundleMismatch = false;
  let membershipMismatch = false;
  let supportIncomplete = false;
  let replayMismatch = false;
  for (const { slot } of rows) {
    const prediction = slot.prediction!;
    if (prediction.predictionSetVersion !== expected.predictionSetVersion) versionMismatch = true;
    if (prediction.modelBundleSha256 !== expected.modelBundleSha256 || prediction.receiptSha256 !== expected.receiptSha256) bundleMismatch = true;
    if (expected.trainingReplaySha256 && prediction.trainingReplaySha256 !== expected.trainingReplaySha256) replayMismatch = true;
    const qKeys = prediction.qHat.map((entry) => key(entry.actionKey));
    if (new Set(qKeys).size !== qKeys.length) membershipMismatch = true;
    const q = new Set(qKeys);
    for (const entry of slot.targetDistribution.actions) if (entry.probability > 0 && !q.has(key(entry.actionKey))) supportIncomplete = true;
    if (!q.has(key(slot.loggedActionKey))) supportIncomplete = true;
  }
  return versionMismatch ? 'prediction_set_version_mismatch' : bundleMismatch ? 'prediction_bundle_digest_mismatch' : membershipMismatch ? 'prediction_set_membership_mismatch' : supportIncomplete ? 'prediction_support_incomplete' : replayMismatch ? 'prediction_training_replay_mismatch' : undefined;
}

function summarize(rows: Row[], config: OpeEvaluationConfigV2, predictionBlocker?: string) {
  const weightBlocker = rows.find((row) => row.weightBlocker)?.weightBlocker;
  const rawBlocker = rows.find((row) => row.rawContributionBlocker)?.rawContributionBlocker;
  const clippedBlocker = rows.find((row) => row.clippedContributionBlocker)?.clippedContributionBlocker;
  const weights = rows.flatMap((row) => row.weight === undefined ? [] : [row.weight]);
  const ipsValues = rows.flatMap((row) => row.ips === undefined ? [] : [row.ips]);
  const clippedValues = rows.flatMap((row) => row.clippedIps === undefined ? [] : [row.clippedIps]);
  const ips = rawBlocker ? notEval(rawBlocker) : estimator(rows, ipsValues, weights);
  const clippedIps = clippedBlocker ? notEval(clippedBlocker) : estimator(rows, clippedValues, rows.map(() => 0));
  const weightSum = sum(weights);
  const snipsBlocker = rawBlocker ?? weightBlocker;
  const snips = snipsBlocker ? notEval(snipsBlocker) : weightSum > 0 && Number.isFinite(weightSum) ? estimator(rows, ipsValues, weights, weightSum, true) : notEval('zero_weight_sum');
  const dr = predictionBlocker ? notEval(predictionBlocker) : drEstimator(rows);
  return { estimators: { ips, clippedIps, snips, dr }, confidenceIntervals: { ips: ci(ips, rows, config), clippedIps: ci(clippedIps, rows, config), snips: ci(snips, rows, config, weightSum), dr: ci(dr, rows, config) }, diagnostics: diagnostics(rows, config.clip) };
}

function estimator(rows: Row[], contributions: number[], weights: number[], denominator = rows.length, ratio = false): V2Estimator {
  const estimate = sum(contributions) / denominator;
  if (!Number.isFinite(estimate)) return notEval('non_finite_aggregate');
  const centered = ratio ? contributions.map((value, index) => value - estimate * weights[index]!) : contributions;
  return { status: 'evaluated', estimate, clusteredVariance: variance(rows, centered, estimate, !ratio, denominator) };
}

function drEstimator(rows: Row[]): V2Estimator {
  const result = buildDrContributionsV2(rows);
  if ('blocker' in result) return notEval(result.blocker);
  return estimator(rows, result.contributions, rows.map((row) => row.weight!));
}

export function buildDrContributionsV2(rows: OpeContributionRowV2[]): { contributions: number[] } | { blocker: string } {
  const contributions: number[] = [];
  for (const row of rows) {
    if (!row.slot.prediction) return { blocker: 'prediction_support_incomplete' };
    const qMap = new Map(row.slot.prediction!.qHat.map((entry) => [key(entry.actionKey), entry.value]));
    const logged = qMap.get(key(row.slot.loggedActionKey));
    const targetTerms: number[] = [];
    for (const entry of row.slot.targetDistribution.actions) {
      const qHat = qMap.get(key(entry.actionKey));
      if (qHat === undefined) return { blocker: 'prediction_support_incomplete' };
      const term = scaled(entry.probability === 0 ? Number.NEGATIVE_INFINITY : row.logPrefix + Math.log(entry.probability), qHat, 'importance');
      if (term.blocker) return { blocker: `dr_target_${term.blocker}` };
      targetTerms.push(term.value ?? NaN);
    }
    const targetTerm = sum(targetTerms);
    if (!Number.isFinite(targetTerm)) return { blocker: 'dr_target_sum_non_finite' };
    const residualTerm = scaled(row.logWeight, row.reward - (logged ?? NaN), 'importance');
    if (residualTerm.blocker) return { blocker: `dr_residual_${residualTerm.blocker}` };
    const value = targetTerm + (residualTerm.value ?? NaN);
    if (!Number.isFinite(value)) return { blocker: 'dr_contribution_sum_non_finite' };
    contributions.push(value);
  }
  return { contributions };
}

function variance(rows: Row[], contributions: number[], estimate: number, additive: boolean, denominator: number): { status: 'evaluated'; variance: number } | { status: 'unavailable'; reason: string } {
  const clusters = new Map<string, { total: number; count: number }>();
  rows.forEach((row, index) => { const clusterId = row.slot.binding.inferenceClusterId; const current = clusters.get(clusterId) ?? { total: 0, count: 0 }; current.total += contributions[index]!; current.count += 1; clusters.set(clusterId, current); });
  if (clusters.size < 2) return { status: 'unavailable', reason: 'fewer_than_two_clusters' };
  const values = [...clusters.values()].map((cluster) => additive ? cluster.total - cluster.count * estimate : cluster.total);
  const value = clusters.size / (clusters.size - 1) * sum(values.map((entry) => entry * entry)) / (denominator * denominator);
  return Number.isFinite(value) && value >= 0 ? { status: 'evaluated', variance: value } : { status: 'unavailable', reason: 'non_finite_cluster_variance' };
}

function ci(estimator: V2Estimator, rows: Row[], config: OpeEvaluationConfigV2, denominator?: number): V2Confidence {
  const decisionClusterCount = clusterCount(rows);
  if (decisionClusterCount < config.ci.minDecisionClusters) return { status: 'unavailable', reason: 'insufficient_decision_clusters', decisionClusterCount };
  if (estimator.status !== 'evaluated') return { status: 'unavailable', reason: estimator.blockers[0]!, decisionClusterCount };
  if (estimator.clusteredVariance.status !== 'evaluated') return { status: 'unavailable', reason: estimator.clusteredVariance.reason, decisionClusterCount };
  const standardError = Math.sqrt(estimator.clusteredVariance.variance);
  const criticalValue = zFor(config.ci.level);
  const halfWidth = criticalValue * standardError;
  return Number.isFinite(halfWidth) ? { status: 'evaluated', estimate: estimator.estimate, standardError, criticalValue, halfWidth, level: config.ci.level, method: OPE_V2_CI_METHOD, version: OPE_V2_CI_VERSION, lower: estimator.estimate - halfWidth, upper: estimator.estimate + halfWidth, decisionClusterCount } : { status: 'unavailable', reason: 'non_finite_cluster_variance', decisionClusterCount };
}

function diagnostics(rows: Row[], clip: number) {
  const weights = rows.flatMap((row) => row.weight === undefined ? [] : [row.weight]); const total = sum(weights); const squares = sum(weights.map((weight) => weight * weight));
  let maxWeight: number | null = null;
  for (const weight of weights) if (maxWeight === null || weight > maxWeight) maxWeight = weight;
  const rawAvailable = weights.length === rows.length;
  return { effectiveSampleSize: rawAvailable && Number.isFinite(total) && Number.isFinite(squares) && squares > 0 ? total * total / squares : null, maxWeight: rawAvailable ? maxWeight : null, clippingRate: rows.length ? rows.filter((row) => row.logWeight > Math.log(clip)).length / rows.length : null, supportCoverage: 1, slotCount: rows.length, decisionCount: clusterCount(rows) };
}

function segmentReports(rows: Row[], config: OpeEvaluationConfigV2, predictionBlocker?: string): OpeEvaluationResultV2['segments'] {
  const configured = new Set(config.segments.map(({ segmentKey, segmentValue }) => key([segmentKey, segmentValue])));
  const indexed = new Map<string, Row[]>();
  for (const row of rows) for (const [segmentKey, segmentValue] of Object.entries(row.slot.segments ?? {})) {
    const identity = key([segmentKey, segmentValue]);
    if (configured.has(identity)) (indexed.get(identity) ?? (indexed.set(identity, []), indexed.get(identity)!)).push(row);
  }
  return config.segments.map(({ segmentKey, segmentValue }) => {
    const selected = indexed.get(key([segmentKey, segmentValue])) ?? [];
    if (selected.length === 0) {
      const blocked = notEval('empty_segment');
      const unavailable: V2Confidence = { status: 'unavailable', reason: 'empty_segment', decisionClusterCount: 0 };
      return { segmentKey, segmentValue, status: 'not_evaluable' as const, observations: { total: 0, accepted: 0, rejected: 0, coverage: 0, uniqueDecisionClusters: 0 }, estimators: { ips: blocked, clippedIps: blocked, snips: blocked, dr: blocked }, confidenceIntervals: { ips: unavailable, clippedIps: unavailable, snips: unavailable, dr: unavailable }, diagnostics: { effectiveSampleSize: null, maxWeight: null, clippingRate: null, supportCoverage: 0, slotCount: 0, decisionCount: 0 } };
    }
    const core = summarize(selected, config, predictionBlocker);
    return { segmentKey, segmentValue, status: Object.values(core.estimators).every((estimator) => estimator.status === 'evaluated') ? 'evaluated' : 'partial', observations: { total: selected.length, accepted: selected.length, rejected: 0, coverage: selected.length ? 1 : 0, uniqueDecisionClusters: clusterCount(selected) }, estimators: core.estimators, confidenceIntervals: core.confidenceIntervals, diagnostics: core.diagnostics };
  });
}

function notEval(blocker: string): V2Estimator { return { status: 'not_evaluable', blockers: [blocker] }; }
function stable(values: string[]) { return [...new Set(values)].sort(); }
function blocked(input: OpeEvaluationInputV2, inputSha256: string, blockers: string[], bindings: OpeEvaluationResultV2['bindings']): OpeEvaluationResultV2 {
  const estimator = notEval(blockers[0] ?? 'structural_gate_failed'); const confidence: V2Confidence = { status: 'unavailable', reason: 'structural_gate_failed', decisionClusterCount: 0 };
  return { contractVersion: OPE_EVALUATION_V2_VERSION, estimand: OPE_V2_ESTIMAND, status: 'not_evaluable', blockers, observations: { total: input.slots.length, accepted: 0, rejected: input.slots.length, coverage: 0, uniqueDecisionClusters: 0 }, estimators: { ips: estimator, clippedIps: estimator, snips: estimator, dr: estimator }, confidenceIntervals: { ips: confidence, clippedIps: confidence, snips: confidence, dr: confidence }, diagnostics: { effectiveSampleSize: null, maxWeight: null, clippingRate: null, supportCoverage: 0, slotCount: input.slots.length, decisionCount: new Set(input.slots.map((slot) => slot.binding.inferenceClusterId)).size }, segments: [], bindings, fingerprints: { inputSha256, evaluationSha256: digest({ blockers, inputSha256 }), estimand: OPE_V2_ESTIMAND, ciConfigSha256: digest(input.config.ci), targetPolicyConfigSha256: input.config.targetPolicyConfigSha256 } };
}
function invalidResult(blocker: string): OpeEvaluationResultV2 { const unavailable = { status: 'unavailable' as const, reason: blocker, decisionClusterCount: 0 }; return { contractVersion: OPE_EVALUATION_V2_VERSION, estimand: OPE_V2_ESTIMAND, status: 'not_evaluable', blockers: [blocker], observations: { total: 0, accepted: 0, rejected: 0, coverage: 0, uniqueDecisionClusters: 0 }, estimators: { ips: notEval(blocker), clippedIps: notEval(blocker), snips: notEval(blocker), dr: notEval(blocker) }, confidenceIntervals: { ips: unavailable, clippedIps: unavailable, snips: unavailable, dr: unavailable }, diagnostics: { effectiveSampleSize: null, maxWeight: null, clippingRate: null, supportCoverage: 0, slotCount: 0, decisionCount: 0 }, segments: [], bindings: null, fingerprints: null }; }

function clusterCount(rows: Row[]): number {
  return new Set(rows.map((row) => row.slot.binding.inferenceClusterId)).size;
}
