import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { opeEvaluationReportSha256V2 } from '../../ope/v2/evaluate';
import {
  RANKING_PROMOTION_FIXED_BLOCKERS_V2, RANKING_PROMOTION_POLICY_V2_VERSION,
  rankingPromotionPolicyV2InputSchema, type RankingPromotionPolicyInputV2, type RankingPromotionPolicyResultV2,
} from './contracts';

const digest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
const stable = (values: string[]) => [...new Set(values)].sort();
const zFor = (level: number) => level === 0.9 ? 1.6448536269514722 : level === 0.99 ? 2.5758293035489004 : 1.959963984540054;

export function evaluateRankingPromotionPolicyV2(input: unknown): RankingPromotionPolicyResultV2 {
  try {
  const parsed = rankingPromotionPolicyV2InputSchema.safeParse(input);
  if (!parsed.success) return invalidResult();
  const value = parsed.data;
  const policySha256 = digest(value.policy);
  const reports = [...value.evidence.opeReports].sort((left, right) => canonicalDecisionJson(left).localeCompare(canonicalDecisionJson(right)));
  const evidenceSha256 = digest({ targetPolicyFingerprint: value.evidence.targetPolicyFingerprint, opeReports: reports });
  const blockers: string[] = [];
  const objectives = reports.map((item) => item.objective);
  const required = new Set([...value.policy.constraints.map((item) => item.objective), ...value.policy.segmentGuardrails.map((item) => item.objective)]);
  if (new Set(objectives).size !== objectives.length) blockers.push('report_objective_duplicate');
  for (const objective of required) if (!objectives.includes(objective)) blockers.push('report_objective_missing');
  for (const item of reports) validateReport(value, item, blockers);
  if (value.evidence.targetPolicyFingerprint !== value.policy.targetPolicyFingerprint) blockers.push('target_policy_fingerprint_mismatch');
  validateAttestations(value, policySha256, evidenceSha256, blockers);
  const variableBlockers = stable(blockers);
  return { contractVersion: RANKING_PROMOTION_POLICY_V2_VERSION, verdict: 'blocked', blockers: [...RANKING_PROMOTION_FIXED_BLOCKERS_V2, ...variableBlockers], policySha256, evidenceSha256, bindings: value.policy.bindings, diagnostics: { reportObjectives: [...objectives].sort(), variableBlockers } };
  } catch {
    return invalidResult();
  }
}

export const evaluatePromotionPolicyV2 = evaluateRankingPromotionPolicyV2;

function validateReport(input: RankingPromotionPolicyInputV2, item: RankingPromotionPolicyInputV2['evidence']['opeReports'][number], blockers: string[]) {
  const report = item.report;
  const policy = input.policy;
  if (item.objective !== report.bindings?.rewardDefinition.objective) blockers.push('report_objective_mismatch');
  if (report.contractVersion !== 'ope_evaluation_v2' || report.estimand !== policy.estimand) blockers.push('estimand_mismatch');
  if (item.targetPolicyFingerprint !== policy.targetPolicyFingerprint) blockers.push('target_policy_fingerprint_mismatch');
  if (!report.bindings || !sameBindings(report.bindings, policy.bindings)) blockers.push('report_bindings_mismatch');
  if (!report.fingerprints || report.fingerprints.estimand !== policy.estimand || report.fingerprints.evaluationSha256 !== opeEvaluationReportSha256V2(report)) blockers.push('report_fingerprint_mismatch');
  if (!report.fingerprints || !report.bindings || report.fingerprints.ciConfigSha256 !== digest(report.bindings.ci)) blockers.push('ci_config_fingerprint_mismatch');
  if (!report.fingerprints || !report.bindings || report.fingerprints.targetPolicyConfigSha256 !== report.bindings.targetPolicyConfigSha256) blockers.push('target_policy_config_fingerprint_mismatch');
  validateCiClusterIdentity(report, blockers);
  for (const segment of report.segments) validateCiClusterIdentity(segment, blockers);
  if (report.status !== 'evaluated' && report.status !== 'partial') blockers.push('report_not_evaluable');
  const support = report.diagnostics?.supportCoverage;
  if (!Number.isFinite(support) || support < policy.minimumSupportCoverage) blockers.push('minimum_support_coverage_not_met');
  const ess = report.diagnostics?.effectiveSampleSize;
  if (typeof ess !== 'number' || !Number.isFinite(ess) || ess < policy.minimumEffectiveSampleSize) blockers.push('minimum_effective_sample_size_not_met');
  const objective = item.objective;
  for (const constraint of policy.constraints.filter((entry) => entry.objective === objective)) validateConstraint(report, constraint, blockers, false, policy);
  for (const guardrail of policy.segmentGuardrails.filter((entry) => entry.objective === objective)) {
    const segment = report.segments.find((entry) => entry.segmentKey === guardrail.segmentKey && entry.segmentValue === guardrail.value);
    if (!segment) { blockers.push('segment_missing'); continue; }
    if (!Number.isFinite(segment.diagnostics?.supportCoverage) || segment.diagnostics.supportCoverage < policy.minimumSupportCoverage) blockers.push('segment_support_coverage_not_met');
    if (typeof segment.diagnostics.effectiveSampleSize !== 'number' || !Number.isFinite(segment.diagnostics.effectiveSampleSize) || segment.diagnostics.effectiveSampleSize < guardrail.minimumESS) blockers.push('segment_minimum_effective_sample_size_not_met');
    validateConstraint(segment, guardrail, blockers, true, policy);
  }
}

function validateCiClusterIdentity(report: RankingPromotionPolicyInputV2['evidence']['opeReports'][number]['report'] | RankingPromotionPolicyInputV2['evidence']['opeReports'][number]['report']['segments'][number], blockers: string[]) {
  if (report.observations.uniqueDecisionClusters !== report.diagnostics.decisionCount || Object.values(report.confidenceIntervals).some((interval) => interval.decisionClusterCount !== report.observations.uniqueDecisionClusters)) blockers.push('decision_cluster_count_mismatch');
}

function validateConstraint(report: RankingPromotionPolicyInputV2['evidence']['opeReports'][number]['report'] | RankingPromotionPolicyInputV2['evidence']['opeReports'][number]['report']['segments'][number], constraint: { estimator: 'ips' | 'clippedIps' | 'snips' | 'dr'; operator: 'gte' | 'lte'; threshold: number }, blockers: string[], segment: boolean, policy: RankingPromotionPolicyInputV2['policy']) {
  const estimator = report.estimators?.[constraint.estimator];
  const interval = report.confidenceIntervals?.[constraint.estimator];
  if (!estimator || estimator.status !== 'evaluated') { blockers.push(segment ? 'segment_estimator_not_evaluated' : `constraint_${constraint.operator}_estimator_not_evaluated`); return; }
  if (!interval || interval.status !== 'evaluated') { blockers.push('missing_ci'); return; }
  if (interval.level !== policy.candidateConfidenceInterval.level || interval.method !== policy.bindings.ci.method || interval.version !== policy.bindings.ci.version) { blockers.push('ci_binding_mismatch'); return; }
  if (!Number.isFinite(interval.lower) || !Number.isFinite(interval.upper) || interval.lower > interval.upper) { blockers.push('ci_invalid'); return; }
  if (estimator.clusteredVariance.status !== 'evaluated' || interval.decisionClusterCount < policy.bindings.ci.minDecisionClusters || interval.estimate !== estimator.estimate || interval.criticalValue !== zFor(interval.level) || Math.abs(interval.standardError * interval.standardError - estimator.clusteredVariance.variance) > 1e-10 || Math.abs(interval.halfWidth - interval.criticalValue * interval.standardError) > 1e-10 || Math.abs(interval.lower - (interval.estimate - interval.halfWidth)) > 1e-10 || Math.abs(interval.upper - (interval.estimate + interval.halfWidth)) > 1e-10) { blockers.push('ci_audit_mismatch'); return; }
  if ((interval.upper - interval.lower) / 2 > policy.candidateConfidenceInterval.maxHalfWidth) { blockers.push('ci_half_width_exceeded'); return; }
  const bound = constraint.operator === 'gte' ? interval.lower : interval.upper;
  if (!Number.isFinite(bound) || (constraint.operator === 'gte' ? bound < constraint.threshold : bound > constraint.threshold)) blockers.push(segment ? 'segment_constraint_not_satisfied' : `constraint_${constraint.operator}_not_satisfied`);
}

function sameBindings(actual: RankingPromotionPolicyInputV2['policy']['bindings'], expected: RankingPromotionPolicyInputV2['policy']['bindings']): boolean {
  return canonicalDecisionJson(actual) === canonicalDecisionJson(expected);
}

function validateAttestations(input: RankingPromotionPolicyInputV2, policySha256: string, evidenceSha256: string, blockers: string[]) {
  const rollback = input.evidence.rollback;
  if (rollback.status === 'missing') blockers.push('rollback_evidence_missing');
  else if (rollback.policySha256 !== policySha256 || rollback.evidenceSha256 !== evidenceSha256) blockers.push('rollback_digest_mismatch');
  const approval = input.evidence.independentApproval;
  if (approval.status === 'missing') blockers.push('independent_approval_missing');
  else {
    if (approval.policySha256 !== policySha256 || approval.evidenceSha256 !== evidenceSha256) blockers.push('approval_digest_mismatch');
    if (approval.preparedBy === approval.approvedBy) blockers.push('approval_not_independent');
  }
}

function invalidResult(): RankingPromotionPolicyResultV2 {
  return { contractVersion: RANKING_PROMOTION_POLICY_V2_VERSION, verdict: 'blocked', blockers: [...RANKING_PROMOTION_FIXED_BLOCKERS_V2, 'invalid_input'], policySha256: null, evidenceSha256: null, bindings: null, diagnostics: { reportObjectives: [], variableBlockers: ['invalid_input'] } };
}
