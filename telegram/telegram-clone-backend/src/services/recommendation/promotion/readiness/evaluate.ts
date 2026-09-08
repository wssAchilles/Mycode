import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  PROMOTION_STATISTICAL_READINESS_V1,
  promotionStatisticalReadinessInputV1Schema,
} from './contracts';

export function evaluatePromotionStatisticalReadinessV1(input: unknown) {
  const parsed = promotionStatisticalReadinessInputV1Schema.safeParse(input);
  if (!parsed.success) return blocked(['multiplicity_control_unavailable', 'invalid_input'], null);
  const value = parsed.data;
  const blockers: string[] = ['multiplicity_control_unavailable'];
  if (value.candidatePolicies.length !== 1) blockers.push('single_candidate_required');
  if (new Set(value.candidatePolicies.map((policy) => canonicalDecisionJson(policy))).size !== value.candidatePolicies.length) blockers.push('candidate_policy_duplicate');
  if (new Set(value.objectives).size !== value.objectives.length) blockers.push('objective_duplicate');
  if (new Set(value.segments.map((segment) => canonicalDecisionJson(segment))).size !== value.segments.length) blockers.push('segment_duplicate');
  if (Date.parse(value.frozenAt) >= Date.parse(value.holdoutRevealedAt)) blockers.push('hypothesis_not_frozen_before_holdout');
  if (new Set(value.trainingDecisionIds).size !== value.trainingDecisionIds.length || new Set(value.holdoutDecisionIds).size !== value.holdoutDecisionIds.length) blockers.push('decision_set_duplicate');
  const training = new Set(value.trainingDecisionIds);
  if (value.holdoutDecisionIds.some((decisionId) => training.has(decisionId))) blockers.push('decision_set_overlap');
  blockers.push(value.holdoutUseEvidence.status === 'missing' ? 'holdout_use_evidence_missing' : 'holdout_use_registry_unavailable');
  return blocked(blockers, digest(value));
}

function blocked(blockers: string[], readinessSha256: string | null) {
  return {
    contractVersion: PROMOTION_STATISTICAL_READINESS_V1,
    verdict: 'blocked' as const,
    blockers: [...new Set(blockers)],
    readinessSha256,
    realDatasetEligible: false as const,
  };
}

const digest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
