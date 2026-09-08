import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../decisionLog/contracts';
import {
  RANKING_PROMOTION_FIXED_BLOCKERS,
  RANKING_PROMOTION_POLICY_VERSION,
  rankingPromotionPolicyInputSchema,
  type RankingPromotionPolicyInputV1,
  type RankingPromotionPolicyResultV1,
} from './contracts';

const digest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
const matches = (actual: number, operator: 'gte' | 'lte', threshold: number) => (
  operator === 'gte' ? actual >= threshold : actual <= threshold
);

export function evaluateRankingPromotionPolicyV1(input: unknown): RankingPromotionPolicyResultV1 {
  try {
    const parsed = rankingPromotionPolicyInputSchema.safeParse(input);
    if (!parsed.success) return invalidResult();
    return evaluateParsed(parsed.data);
  } catch {
    return invalidResult();
  }
}

function evaluateParsed(input: RankingPromotionPolicyInputV1): RankingPromotionPolicyResultV1 {
  const policySha256 = digest(input.policy);
  const reports = input.evidence.opeReports
    .map((item) => ({
      item,
      key: canonicalDecisionJson([item.objective, item.targetPolicyFingerprint, item.report]),
    }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map(({ item }) => item);
  const evidenceSha256 = digest({ targetPolicyFingerprint: input.evidence.targetPolicyFingerprint, opeReports: reports });
  const blockers: string[] = [];
  const objectives = reports.map(({ objective }) => objective);
  if (new Set(objectives).size !== objectives.length) blockers.push('report_objective_duplicate');
  const requiredObjectives = new Set([
    ...input.policy.constraints.map(({ objective }) => objective),
    ...input.policy.segmentGuardrails.map(({ objective }) => objective),
  ]);
  for (const objective of requiredObjectives) {
    if (!objectives.includes(objective)) blockers.push('report_objective_missing');
  }
  for (const item of reports) validateReport(input, item, blockers);
  validateRollbackAndApproval(input, policySha256, evidenceSha256, blockers);
  const variableBlockers = stable(blockers);
  return {
    contractVersion: RANKING_PROMOTION_POLICY_VERSION,
    verdict: 'blocked',
    blockers: [...RANKING_PROMOTION_FIXED_BLOCKERS, ...variableBlockers],
    policySha256, evidenceSha256, bindings: input.policy.bindings,
    diagnostics: { reportObjectives: objectives.sort(), variableBlockers },
  };
}

function validateReport(input: RankingPromotionPolicyInputV1, item: RankingPromotionPolicyInputV1['evidence']['opeReports'][number], blockers: string[]) {
  const { policy } = input;
  const report = item.report;
  if (report.bindings.status !== 'bound' || item.objective !== report.bindings.rewardDefinition.objective) {
    blockers.push('report_objective_mismatch');
  }
  if (report.status === 'not_evaluable') blockers.push('report_not_evaluable');
  if (!reportStatisticsValid(report)) blockers.push('report_statistics_invalid');
  if (item.targetPolicyFingerprint !== policy.targetPolicyFingerprint || input.evidence.targetPolicyFingerprint !== policy.targetPolicyFingerprint) blockers.push('target_policy_fingerprint_mismatch');
  if (report.bindings.status !== 'bound' || report.fingerprints.status !== 'bound') blockers.push('report_bindings_mismatch');
  else if (!sameBindings(report.bindings, policy.bindings)) blockers.push('report_bindings_mismatch');
  if (report.behaviorSupport.status !== 'complete') blockers.push('behavior_support_incomplete');
  if (report.behaviorSupport.coverage < policy.minimumSupportCoverage) blockers.push('minimum_support_coverage_not_met');
  if (report.diagnostics.effectiveSampleSize.status !== 'evaluated') blockers.push('effective_sample_size_not_evaluated');
  else if (report.diagnostics.effectiveSampleSize.value < policy.minimumEffectiveSampleSize) blockers.push('minimum_effective_sample_size_not_met');
  for (const constraint of policy.constraints.filter(({ objective }) => objective === item.objective)) {
    const estimator = report.estimators[constraint.estimator];
    if (estimator.status !== 'evaluated') blockers.push(`constraint_${constraint.kind}_estimator_not_evaluated`);
    else if (!matches(estimator.estimate, constraint.operator, constraint.threshold)) blockers.push(`constraint_${constraint.kind}_not_satisfied`);
  }
  for (const guardrail of policy.segmentGuardrails.filter(({ objective }) => objective === item.objective)) {
    const segment = report.segments.find((candidate) => candidate.segmentKey === guardrail.segmentKey && candidate.segmentValue === guardrail.value);
    if (!segment) { blockers.push('segment_missing'); continue; }
    if (segment.diagnostics.effectiveSampleSize.status !== 'evaluated') blockers.push('segment_effective_sample_size_not_evaluated');
    else if (segment.diagnostics.effectiveSampleSize.value < guardrail.minimumESS) blockers.push('segment_minimum_effective_sample_size_not_met');
    const estimator = segment.estimators[guardrail.estimator];
    if (estimator.status !== 'evaluated') blockers.push('segment_estimator_not_evaluated');
    else if (!matches(estimator.estimate, guardrail.operator, guardrail.threshold)) blockers.push('segment_constraint_not_satisfied');
  }
}

function sameBindings(actual: Extract<RankingPromotionPolicyInputV1['evidence']['opeReports'][number]['report']['bindings'], { status: 'bound' }>, expected: RankingPromotionPolicyInputV1['policy']['bindings']) {
  return actual.datasetVersion === expected.datasetVersion
    && actual.outcomeContractVersion === expected.outcomeContractVersion
    && actual.behaviorPolicy.policyId === expected.behaviorPolicy.policyId
    && actual.behaviorPolicy.policyVersion === expected.behaviorPolicy.policyVersion
    && actual.targetPolicy.policyId === expected.targetPolicy.policyId
    && actual.targetPolicy.policyVersion === expected.targetPolicy.policyVersion
    && canonicalDecisionJson(actual.decisionVersions) === canonicalDecisionJson(expected.decisionVersions)
    && actual.predictionArtifactVersion === expected.predictionArtifactVersion;
}

function reportStatisticsValid(report: RankingPromotionPolicyInputV1['evidence']['opeReports'][number]['report']): boolean {
  return summaryStatisticsValid(report.observations)
    && report.behaviorSupport.completeObservations <= report.behaviorSupport.totalObservations
    && report.behaviorSupport.totalObservations === report.observations.total
    && coverageMatches(report.behaviorSupport.coverage, report.behaviorSupport.completeObservations, report.behaviorSupport.totalObservations)
    && countTotal(report.behaviorSupport.reasonCounts) === report.behaviorSupport.totalObservations - report.behaviorSupport.completeObservations
    && (report.behaviorSupport.status !== 'complete' || (
      report.behaviorSupport.totalObservations > 0
      && report.behaviorSupport.completeObservations === report.behaviorSupport.totalObservations
      && report.behaviorSupport.coverage === 1
    ))
    && effectiveSampleSizeValid(report.diagnostics.effectiveSampleSize, report.observations.accepted)
    && segmentsWithinReport(report.segments, report.observations)
    && report.segments.every((segment) => (
      summaryStatisticsValid(segment.observations)
      && segment.observations.total <= report.observations.total
      && segment.observations.accepted <= report.observations.accepted
      && segment.observations.rejected <= report.observations.rejected
      && segment.observations.uniqueDecisionClusters <= report.observations.uniqueDecisionClusters
      && effectiveSampleSizeValid(segment.diagnostics.effectiveSampleSize, segment.observations.accepted)
    ));
}

function summaryStatisticsValid(summary: { total: number; accepted: number; rejected: number; coverage: number; uniqueDecisionClusters: number; rejectedReasonCounts: Record<string, number> }): boolean {
  return summary.total === summary.accepted + summary.rejected
    && coverageMatches(summary.coverage, summary.accepted, summary.total)
    && summary.uniqueDecisionClusters <= summary.accepted
    && countTotal(summary.rejectedReasonCounts) === summary.rejected;
}

function coverageMatches(coverage: number, accepted: number, total: number): boolean {
  return Math.abs(coverage - (total === 0 ? 0 : accepted / total)) <= 1e-8;
}

function effectiveSampleSizeValid(value: RankingPromotionPolicyInputV1['evidence']['opeReports'][number]['report']['diagnostics']['effectiveSampleSize'], accepted: number): boolean {
  return value.status !== 'evaluated' || value.value <= accepted + 1e-8;
}

function segmentsWithinReport(
  segments: RankingPromotionPolicyInputV1['evidence']['opeReports'][number]['report']['segments'],
  parent: RankingPromotionPolicyInputV1['evidence']['opeReports'][number]['report']['observations'],
): boolean {
  const aggregates = new Map<string, {
    values: Set<string>;
    total: number;
    accepted: number;
    rejected: number;
  }>();
  for (const segment of segments) {
    const aggregate = aggregates.get(segment.segmentKey) ?? {
      values: new Set<string>(), total: 0, accepted: 0, rejected: 0,
    };
    if (aggregate.values.has(segment.segmentValue)) return false;
    aggregate.values.add(segment.segmentValue);
    aggregate.total += segment.observations.total;
    aggregate.accepted += segment.observations.accepted;
    aggregate.rejected += segment.observations.rejected;
    if (
      aggregate.total > parent.total
      || aggregate.accepted > parent.accepted
      || aggregate.rejected > parent.rejected
    ) return false;
    aggregates.set(segment.segmentKey, aggregate);
  }
  return true;
}

function countTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

function validateRollbackAndApproval(input: RankingPromotionPolicyInputV1, policySha256: string, evidenceSha256: string, blockers: string[]) {
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

function invalidResult(): RankingPromotionPolicyResultV1 {
  return {
    contractVersion: RANKING_PROMOTION_POLICY_VERSION, verdict: 'blocked',
    blockers: [...RANKING_PROMOTION_FIXED_BLOCKERS, 'invalid_input'],
    policySha256: null, evidenceSha256: null, bindings: null,
    diagnostics: { reportObjectives: [], variableBlockers: ['invalid_input'] },
  };
}

function stable(values: string[]) { return [...new Set(values)].sort(); }
