import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import { ActionType } from '../../src/models/UserAction';
import { evaluateOpeV2 } from '../../src/services/recommendation/ope/v2/evaluate';
import { candidatePoolSha256, canonicalDecisionJson, recommendationDecisionLogSchema, type RecommendationDecisionLogV1 } from '../../src/services/recommendation/decisionLog/contracts';
import { verifyDecisionContextEvidenceV1 } from '../../src/services/recommendation/decisionContext/verify';
import { opeProjectionSha256V2, projectVerifiedOpeEvidenceV2 } from '../../src/services/recommendation/ope/v2/project';
import { evaluateRankingPromotionPolicyV2 } from '../../src/services/recommendation/promotion/v2/evaluate';
import * as targetArtifacts from '../../src/services/recommendation/offlinePrediction/artifacts/targetDistribution';
import * as predictionArtifacts from '../../src/services/recommendation/offlinePrediction/artifacts/verify';
import { outcomeEventSha256V1, verifyOutcomeEvidenceV1 } from '../../src/services/recommendation/outcomes/verifiedOutcomeEvidenceV1';
import { evaluateExperimentalClusterInferenceV1, buildRobustInferenceSingleCohortDiagnosticsV1 } from '../../src/services/recommendation/ope/inference/evaluate';
import { nearestRankV1, thresholdBootstrapTV1 } from '../../src/services/recommendation/ope/inference/bootstrap';
import { buildVerifiedClusterScoreSummaryV1, summarizeClusterScoresV1 } from '../../src/services/recommendation/ope/inference/clusterScores';
import { evaluateRobustInferenceSyntheticAblationV1 } from '../../src/services/recommendation/ope/inference/ablation';
import { loadSyntheticFixtureHypothesisSealV1, SYNTHETIC_FIXTURE_ABLATION_PLAN_V1, SYNTHETIC_FIXTURE_ROBUST_CONFIG_V1 } from '../../src/services/recommendation/ope/inference/hypothesisSeal';

const action = (id: string, position: number) => ({ candidateNamespace: 'serving_post_id' as const, candidateId: id, servedPosition: position });
const decisionDigest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; };
const config = {
  estimand: 'mean_reward_per_logged_slot_v1' as const, datasetVersion: 'd', outcomeContractVersion: 'outcome_contract_v1' as const,
  behaviorPolicy: { policyId: 'b', policyVersion: '1' }, targetPolicy: { policyId: 't', policyVersion: '1' }, targetPolicyConfigSha256: '9'.repeat(64),
  decisionVersions: { pipeline: '1', strategy: '1', policy: '1', graph: '1', model: '1', artifact: '1', index: '1' },
  rewardDefinition: { objective: 'r', definitionVersion: '1', horizonMs: 1, weights: { click: 0, like: 0, reply: 0, repost: 0, quote: 0, share: 0, dismiss: 0, blockAuthor: 0, report: 0 }, dwell: { weight: 1, capMs: 10, scaleMs: 1 } },
  clip: 1.5, ci: { method: 'decision_cluster_robust_wald' as const, version: 'decision_cluster_robust_wald_v1' as const, level: 0.95 as const, minDecisionClusters: 2 }, segments: [{ segmentKey: 'country', segmentValue: 'US' }],
};
function slot(decisionId: string, position: number, targetA: number, reward: number, country = 'US') {
  const logged = action(position === 1 ? 'a' : 'b', position); const other = action(position === 1 ? 'b' : 'c', position);
  return { decisionId, servedPosition: position, binding: { decisionId, datasetVersion: 'd', decisionLogSha256: 'a'.repeat(64), candidatePoolSha256: 'b'.repeat(64) }, loggedActionKey: logged, prefixActionKeys: position === 1 ? [] : [action('a', 1)], outcome: { reward, outcomeContractVersion: 'outcome_contract_v1' as const }, behaviorSupport: { status: 'logged_randomized' as const, loggedActionProbability: 0.5, supportActions: [logged, other] }, targetDistribution: { actions: [{ actionKey: logged, probability: targetA }, { actionKey: other, probability: 1 - targetA }] }, segments: { country } };
}
type SlotFixture = ReturnType<typeof slot> & { viewerId?: string; inferenceClusterId?: string; realDatasetEligible?: boolean; prediction?: { predictionSetVersion: string; modelBundleSha256: string; receiptSha256: string; qHat: Array<{ actionKey: ReturnType<typeof action>; value: number }> } };
const drPredictionEvidence = { predictionSetVersion: 'phase10-predictions', modelBundleSha256: 'e'.repeat(64), receiptSha256: 'f'.repeat(64) };
const drEvaluationConfig = { ...config, predictionEvidence: drPredictionEvidence };
const withDrPrediction = (row: ReturnType<typeof slot> & Partial<SlotFixture>): SlotFixture => ({
  ...row,
  prediction: { ...drPredictionEvidence, qHat: row.targetDistribution.actions.map(({ actionKey }) => ({ actionKey, value: 0.5 })) },
});

function input(slots: SlotFixture[], evaluationConfig: typeof config & { predictionEvidence?: { predictionSetVersion: string; modelBundleSha256: string; receiptSha256: string } } = config, shallowTarget = false, mockVerifiedFixture = true, plainEvidence?: 'outcome' | 'context', predictionOverride?: { predictionSetVersion: string; modelBundleSha256: string; receiptSha256: string }) {
  const decisions = [...new Set(slots.map((row) => row.decisionId))].map((decisionId) => {
    const rows = slots.filter((row) => row.decisionId === decisionId);
    const boundVersions = Object.fromEntries(Object.entries(evaluationConfig.decisionVersions).map(([key, version]) => [key, { status: 'bound', version }]));
    const candidateIds = [...new Set(rows.flatMap((row) => [...row.prefixActionKeys, ...row.targetDistribution.actions.map((entry) => entry.actionKey)]).map((entry) => entry.candidateId))];
    const candidates = candidateIds.map((candidateId, index) => {
      const selected = rows.find((row) => row.loggedActionKey.candidateId === candidateId);
      return {
        candidateNamespace: 'serving_post_id' as const,
        candidateId,
        poolRank: index + 1,
        eligible: true,
        score: 1 - index / Math.max(1, candidateIds.length),
        selected: Boolean(selected),
        selectionRank: selected?.servedPosition ?? null,
        served: Boolean(selected),
        servedPosition: selected?.servedPosition ?? null,
        objectiveEvidence: [],
      };
    });
    return recommendationDecisionLogSchema.parse({
      contractVersion: 'recommendation_decision_log_v1',
      positionContractVersion: 'served_position_1_based_v1',
      requestId: decisionId,
      decisionId,
      decisionAt: '2026-07-16T08:00:00.000Z',
      servingOwner: 'node',
      fallbackReason: null,
      behaviorPolicyKind: 'logged_randomized',
      behaviorPolicy: { policyId: evaluationConfig.behaviorPolicy.policyId, policyVersion: { status: 'bound', version: evaluationConfig.behaviorPolicy.policyVersion } },
      versions: boundVersions,
      candidatePool: { supportEvidence: { status: 'complete' }, totalCount: candidates.length, truncated: false, candidates, candidatePoolSha256: candidatePoolSha256(candidates) },
      actions: rows.map((row) => ({ actionKey: row.loggedActionKey, selectionRank: row.servedPosition, behaviorPropensity: { status: 'logged_randomized', selectionProbability: row.behaviorSupport.loggedActionProbability } })),
    });
  });
  const targetDecisions = decisions.map((decision) => ({ decisionId: decision.decisionId, decisionLogSha256: decisionDigest(decision), candidatePoolSha256: decision.candidatePool.candidatePoolSha256, steps: slots.filter((row) => row.decisionId === decision.decisionId).map((row) => ({ servedPosition: row.servedPosition, prefixActionKeys: row.prefixActionKeys, actions: row.targetDistribution.actions })) }));
  const predictionArtifact = predictionOverride ?? evaluationConfig.predictionEvidence;
  const prediction = evaluationConfig.predictionEvidence && predictionArtifact ? freeze({ status: 'verified' as const, receipt: { status: 'verified', verifierVersion: 'cross_fitted_prediction_set_verifier_v1', predictionSetVersion: predictionArtifact.predictionSetVersion, modelBundleSha256: predictionArtifact.modelBundleSha256, verificationReceiptSha256: predictionArtifact.receiptSha256, trainingExamplesNdjsonSha256: '6'.repeat(64) }, members: decisions.map((decision) => ({ datasetVersion: evaluationConfig.datasetVersion, decisionId: decision.decisionId, decisionLogSha256: decisionDigest(decision), candidatePoolSha256: decision.candidatePool.candidatePoolSha256, predictionSetVersion: predictionArtifact.predictionSetVersion, modelBundleSha256: predictionArtifact.modelBundleSha256, objective: evaluationConfig.rewardDefinition.objective, rewardDefinitionVersion: evaluationConfig.rewardDefinition.definitionVersion, horizonMs: evaluationConfig.rewardDefinition.horizonMs, predictions: slots.filter((row) => row.decisionId === decision.decisionId).flatMap((row) => row.prediction?.qHat.map((entry) => ({ actionKey: entry.actionKey, qHat: entry.value })) ?? []) })) } as any) : undefined;
  const evidence = buildBoundEvidence(decisions, slots, evaluationConfig);
  const target = { manifest: { datasetVersion: evaluationConfig.datasetVersion, sourceDecisionNdjsonSha256: '1'.repeat(64), sourceDatasetManifestSha256: '2'.repeat(64), policyConfigSha256: evaluationConfig.targetPolicyConfigSha256, distributionNdjsonSha256: '3'.repeat(64) }, receipt: { status: 'verified', verifierVersion: 'telegram_recommendation_policy_offline_verifier_v1', targetManifestSha256: '4'.repeat(64), sourceDecisionNdjsonSha256: '1'.repeat(64), sourceDatasetManifestSha256: '2'.repeat(64), policyConfigSha256: evaluationConfig.targetPolicyConfigSha256, distributionNdjsonSha256: '3'.repeat(64) }, targetManifestSha256: '4'.repeat(64), targetReceiptRawSha256: '5'.repeat(64), decisions: targetDecisions } as any;
  const targetGuard = mockVerifiedFixture ? vi.spyOn(targetArtifacts, 'isVerifiedTargetDistributionEvidenceV1').mockReturnValueOnce(true) : undefined;
  const predictionGuard = mockVerifiedFixture && prediction ? vi.spyOn(predictionArtifacts, 'isVerifiedCrossFittedPredictionSetResultV1').mockReturnValueOnce(true) : undefined;
  const projected = projectVerifiedOpeEvidenceV2({ config: evaluationConfig, outcomeEvidence: (plainEvidence === 'outcome' ? structuredClone(evidence.outcomeEvidence) : evidence.outcomeEvidence) as any, decisionContextEvidence: (plainEvidence === 'context' ? structuredClone(evidence.decisionContextEvidence) : evidence.decisionContextEvidence) as any, prediction, target: shallowTarget ? Object.freeze(target) : freeze(target) });
  targetGuard?.mockRestore(); predictionGuard?.mockRestore();
  if (projected.status !== 'projected') throw new Error(projected.blocker);
  return projected.input;
}

function buildBoundEvidence(decisions: RecommendationDecisionLogV1[], slots: SlotFixture[], evaluationConfig: typeof config) {
  const context = verifyDecisionContextEvidenceV1({
    datasetVersion: evaluationConfig.datasetVersion,
    crossUserDependence: { status: 'none_observed_in_verified_source_v1' },
    decisions: decisions.map((decision) => ({
      decisionLog: decision,
      subject: { kind: 'viewer' as const, viewerAccountPseudonym: slots.find((row) => row.decisionId === decision.decisionId)?.viewerId ?? `viewer-${decision.decisionId}` },
      contextAt: new Date(Date.parse(decision.decisionAt) - 2).toISOString(),
      availableAt: new Date(Date.parse(decision.decisionAt) - 1).toISOString(),
      sourceSha256: '7'.repeat(64),
      sourceVersion: 'ope-context-fixture-v1',
      inferenceClusterId: slots.find((row) => row.decisionId === decision.decisionId)?.inferenceClusterId ?? `opaque-cluster-${decision.decisionId}`,
      clusterUnitVersion: 'viewer_account_pseudonym_v1' as const,
      realDatasetEligible: slots.find((row) => row.decisionId === decision.decisionId)?.realDatasetEligible ?? true,
      segments: slots.find((row) => row.decisionId === decision.decisionId)?.segments ?? {},
    })),
  });
  if (context.status !== 'verified') throw new Error(context.blocker);
  const outcome = verifyOutcomeEvidenceV1({
    datasetVersion: evaluationConfig.datasetVersion,
    rewardDefinition: evaluationConfig.rewardDefinition,
    decisions: decisions.map((decision) => {
      const impressionAt = Date.parse(decision.decisionAt) + 1;
      const actionRows = slots.filter((row) => row.decisionId === decision.decisionId);
      const traceUserId = slots.find((row) => row.decisionId === decision.decisionId)?.viewerId ?? `viewer-${decision.decisionId}`;
      const events = decision.actions.flatMap((logged) => {
        const reward = actionRows.find((row) => canonicalDecisionJson(row.loggedActionKey) === canonicalDecisionJson(logged.actionKey))?.outcome.reward ?? 1;
        const common = { userId: traceUserId, requestId: decision.requestId, rank: logged.actionKey.servedPosition, metadata: { decisionId: decision.decisionId, candidateNamespace: logged.actionKey.candidateNamespace, candidateId: logged.actionKey.candidateId, positionContractVersion: decision.positionContractVersion } };
        const impressionId = `${decision.decisionId}:${logged.actionKey.servedPosition}:impression`;
        const dwellId = `${decision.decisionId}:${logged.actionKey.servedPosition}:dwell`;
        const impression = { ...common, metadata: { ...common.metadata, recommendationEventKey: impressionId }, action: ActionType.IMPRESSION, timestamp: new Date(impressionAt).toISOString() };
        const dwell = { ...common, metadata: { ...common.metadata, recommendationEventKey: dwellId }, action: ActionType.DWELL, timestamp: new Date(impressionAt + evaluationConfig.rewardDefinition.horizonMs).toISOString(), dwellTimeMs: reward };
        return [
          { eventId: impressionId, eventSha256: outcomeEventSha256V1(impression), event: impression },
          { eventId: dwellId, eventSha256: outcomeEventSha256V1(dwell), event: dwell },
        ];
      });
      return { decisionLog: decision, traceUserId, observedThrough: new Date(impressionAt + evaluationConfig.rewardDefinition.horizonMs).toISOString(), events };
    }),
  });
  if (outcome.status !== 'verified') throw new Error(outcome.blocker);
  return { outcomeEvidence: outcome.evidence, decisionContextEvidence: context.evidence };
}

describe('OPE v2', () => {
  it('uses sequential prefix ratios and slot mean', () => {
    const result = evaluateOpeV2(input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1), slot('00000000-0000-4000-8000-000000000001', 2, 0.25, 2), slot('00000000-0000-4000-8000-000000000002', 1, 1, 3)]));
    expect(result.status).toBe('partial');
    expect(result.estimators.ips).toMatchObject({ status: 'evaluated', estimate: (2 + 1 * 2 + 2 * 3) / 3 });
    expect(result.estimators.clippedIps).toMatchObject({ status: 'evaluated', estimate: (1.5 + 1 * 2 + 1.5 * 3) / 3 });
    expect(result.observations.total).toBe(3);
    expect(result.segments[0]?.observations.total).toBe(3);
  });

  it('blocks the whole cohort for one invalid slot', () => {
    const bad = slot('00000000-0000-4000-8000-000000000001', 2, 0.25, 2); bad.targetDistribution.actions[0]!.probability = -1;
    const result = evaluateOpeV2(input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1), bad]));
    expect(result.status).toBe('not_evaluable');
    expect(result.segments).toEqual([]);
    expect(result.estimators.ips.status).toBe('not_evaluable');
  });

  it('applies prefix weight to the DR target expectation', () => {
    const predictionEvidence = { predictionSetVersion: 'p', modelBundleSha256: 'e'.repeat(64), receiptSha256: 'f'.repeat(64) };
    const projectedConfig = { ...config, predictionEvidence };
    const slots = [slot('00000000-0000-4000-8000-000000000001', 1, 1, 1), slot('00000000-0000-4000-8000-000000000001', 2, 0.25, 2)].map((row) => ({ ...row, prediction: { ...predictionEvidence, qHat: row.targetDistribution.actions.map(({ actionKey }) => ({ actionKey, value: 0.5 })) } }));
    const result = evaluateOpeV2(input(slots, projectedConfig));
    expect(result.estimators.dr).toMatchObject({ status: 'evaluated', estimate: 2 });
  });

  it('scales DR target terms before tiny probability products underflow', () => {
    const predictionEvidence = { predictionSetVersion: 'p', modelBundleSha256: 'e'.repeat(64), receiptSha256: 'f'.repeat(64) };
    const evaluationConfig = { ...config, predictionEvidence };
    const first = slot('00000000-0000-4000-8000-000000000001', 1, 1, 0);
    first.behaviorSupport.loggedActionProbability = 1e-300;
    const second = slot('00000000-0000-4000-8000-000000000001', 2, 1e-300, 1e-100);
    second.behaviorSupport.loggedActionProbability = 1;
    const rows = [first, second].map((row, index) => ({ ...row, prediction: { ...predictionEvidence, qHat: row.targetDistribution.actions.map(({ actionKey }, actionIndex) => ({ actionKey, value: index === 1 && actionIndex === 0 ? 1e-100 : 0 })) } }));
    const result = evaluateOpeV2(input(rows, evaluationConfig));
    expect(result.estimators.dr.status).toBe('evaluated');
    if (result.estimators.dr.status === 'evaluated') expect(result.estimators.dr.estimate / 5e-101).toBeCloseTo(1);
  });

  it('rejects mutation even when the public receipt is recomputed', () => {
    const value = structuredClone(input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1), slot('00000000-0000-4000-8000-000000000001', 2, 0.25, 2)]));
    value.slots[1]!.prefixActionKeys = [];
    const { version: _version, projectionSha256: _sha, ...evidence } = value.projectionReceipt;
    value.projectionReceipt.projectionSha256 = opeProjectionSha256V2(value.config, value.slots, evidence);
    const result = evaluateOpeV2(value);
    expect(result).toMatchObject({ status: 'not_evaluable', blockers: ['unverified_projection'], segments: [] });
  });

  it('owns and recursively freezes the projection without freezing caller config', () => {
    const callerConfig = structuredClone(config);
    const value = input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1)], callerConfig);
    expect(value.config).not.toBe(callerConfig);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.config.rewardDefinition.weights)).toBe(true);
    expect(Object.isFrozen(value.slots[0]?.binding)).toBe(true);
    expect(Object.isFrozen(callerConfig)).toBe(false);
    expect(value.projectionReceipt.outcomeEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(value.projectionReceipt.decisionContextEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => { value.slots[0]!.outcome.reward = 2; }).toThrow(TypeError);
    expect(evaluateOpeV2(value).status).not.toBe('not_evaluable');
    expect(value.slots[0]?.binding).toMatchObject({
      requestId: '00000000-0000-4000-8000-000000000001',
      contextAt: '2026-07-16T07:59:59.998Z',
      availableAt: '2026-07-16T07:59:59.999Z',
      sourceSha256: '7'.repeat(64),
      sourceVersion: 'ope-context-fixture-v1',
      inferenceClusterId: 'opaque-cluster-00000000-0000-4000-8000-000000000001',
      clusterUnitVersion: 'viewer_account_pseudonym_v1',
      realDatasetEligible: true,
      crossUserDependenceStatus: 'none_observed_in_verified_source_v1',
    });
  });

  it('rejects an otherwise valid plain clone without the private projection brand', () => {
    const value = input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1)]);
    expect(evaluateOpeV2(structuredClone(value))).toMatchObject({ status: 'not_evaluable', blockers: ['unverified_projection'] });
  });

  it('evaluates the Phase 9A maximum 2048-action support', () => {
    const row = slot('00000000-0000-4000-8000-000000000001', 1, 1, 1);
    const keys = [row.loggedActionKey, ...Array.from({ length: 2047 }, (_, index) => action(`candidate-${index}`, 1))];
    row.targetDistribution.actions = keys.map((actionKey) => ({ actionKey, probability: 1 / 2048 }));
    row.behaviorSupport.loggedActionProbability = 1 / 2048;
    const result = evaluateOpeV2(input([row]));
    expect(result.estimators.ips).toMatchObject({ status: 'evaluated', estimate: 1 });
  });

  it('keeps clipped IPS evaluable on raw overflow and fails underflow closed', () => {
    const overflow = slot('00000000-0000-4000-8000-000000000001', 1, 1, 2);
    overflow.behaviorSupport.loggedActionProbability = 1e-320;
    const overflowResult = evaluateOpeV2(input([overflow]));
    expect(overflowResult.estimators.ips).toMatchObject({ status: 'not_evaluable', blockers: ['importance_contribution_overflow'] });
    expect(overflowResult.estimators.clippedIps.status).toBe('evaluated');
    if (overflowResult.estimators.clippedIps.status === 'evaluated') expect(overflowResult.estimators.clippedIps.estimate).toBeCloseTo(3);
    expect(overflowResult.diagnostics.effectiveSampleSize).toBeNull();

    const underflowFirst = slot('00000000-0000-4000-8000-000000000002', 1, 1e-200, 2);
    const underflowSecond = slot('00000000-0000-4000-8000-000000000002', 2, 1e-200, 2);
    underflowFirst.behaviorSupport.loggedActionProbability = 1;
    underflowSecond.behaviorSupport.loggedActionProbability = 1;
    const underflowResult = evaluateOpeV2(input([underflowFirst, underflowSecond]));
    expect(underflowResult.estimators.ips).toMatchObject({ status: 'not_evaluable', blockers: ['importance_contribution_underflow'] });
    expect(underflowResult.estimators.clippedIps).toMatchObject({ status: 'not_evaluable', blockers: ['clipped_contribution_underflow'] });
  });

  it('feeds an authentic OPE v2 report into structurally identical promotion bindings', () => {
    const predictionEvidence = { predictionSetVersion: 'p', modelBundleSha256: 'e'.repeat(64), receiptSha256: 'f'.repeat(64) };
    const evaluationConfig = { ...config, predictionEvidence };
    const rows = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'].map((decisionId) => {
      const row = slot(decisionId, 1, 1, 1);
      return { ...row, prediction: { ...predictionEvidence, qHat: row.targetDistribution.actions.map(({ actionKey }) => ({ actionKey, value: 0.5 })) } };
    });
    const report = evaluateOpeV2(input(rows, evaluationConfig));
    expect(report.confidenceIntervals.ips).toMatchObject({ status: 'evaluated', estimate: 2, standardError: 0, criticalValue: 1.959963984540054, halfWidth: 0, decisionClusterCount: 2, level: 0.95, method: 'decision_cluster_robust_wald', version: 'decision_cluster_robust_wald_v1' });
    const fingerprint = 'a'.repeat(64);
    const result = evaluateRankingPromotionPolicyV2({ policy: { contractVersion: 'ranking_promotion_policy_v2', policyId: 'p', policyVersion: '1', estimand: 'mean_reward_per_logged_slot_v1', bindings: report.bindings, targetPolicyFingerprint: fingerprint, minimumSupportCoverage: 1, minimumEffectiveSampleSize: 1, candidateConfidenceInterval: { level: 0.95, maxHalfWidth: 10 }, constraints: [], segmentGuardrails: [] }, evidence: { opeReports: [{ objective: 'r', targetPolicyFingerprint: fingerprint, report }], targetPolicyFingerprint: fingerprint, rollback: { status: 'missing' }, independentApproval: { status: 'missing' } } });
    expect(result.blockers).not.toContain('report_bindings_mismatch');
  });

  it('honors configured minimum decision clusters in CI availability', () => {
    const evaluationConfig = { ...config, ci: { ...config.ci, minDecisionClusters: 3 } };
    const rows = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'].map((decisionId) => slot(decisionId, 1, 1, 1));
    expect(evaluateOpeV2(input(rows, evaluationConfig)).confidenceIntervals.ips).toEqual({ status: 'unavailable', reason: 'insufficient_decision_clusters', decisionClusterCount: 2 });
  });

  it.each(['cycle', 'bigint'] as const)('fails closed when a plain projection clone is mutated with %s', (kind) => {
    const value = structuredClone(input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1)]));
    if (kind === 'cycle') (value.slots[0] as any).cycle = value;
    else (value.slots[0] as any).bigint = 1n;
    expect(evaluateOpeV2(value)).toMatchObject({ status: 'not_evaluable', blockers: ['unverified_projection'] });
  });

  it('rejects served positions outside the bounded 1-64 projection contract', () => {
    expect(() => input([slot('00000000-0000-4000-8000-000000000001', 65, 1, 1)]))
      .toThrow('served_position_out_of_range');
  });

  it.each([
    ['outcome', 'unverified_outcome_evidence'],
    ['context', 'unverified_decision_context_evidence'],
  ] as const)('rejects a recursively frozen plain clone of %s evidence', (kind, blocker) => {
    expect(() => input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1)], config, false, true, kind)).toThrow(blocker);
  });

  it('rejects shallow-frozen evidence with mutable nested members', () => {
    expect(() => input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1)], config, true)).toThrow('target_evidence_mutable');
  });

  it('rejects a recursively frozen but unbranded target lookalike', () => {
    expect(() => input([slot('00000000-0000-4000-8000-000000000001', 1, 1, 1)], config, false, false)).toThrow('unverified_target_evidence');
  });

  it('accepts the real target verifier brand and fails closed on its unavailable decision versions', () => {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/target_policy_distribution_stream_v1.json'), 'utf8'));
    const verified = targetArtifacts.verifyTargetDistributionEvidenceV1({ sourceDecisionNdjson: fixture.sourceDecisionNdjson, sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw, policyConfigRaw: fixture.policyConfigRaw, distributionNdjson: fixture.expectedDistributionNdjson, targetManifestRaw: fixture.expectedTargetManifestRaw, verificationReceiptRaw: `${JSON.stringify(fixture.expectedReceipt)}\n` });
    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') return;
    expect(targetArtifacts.isVerifiedTargetDistributionEvidenceV1(verified.evidence)).toBe(true);
    const decisions = fixture.sourceDecisionNdjson.trim().split('\n').map((line: string) => recommendationDecisionLogSchema.parse(JSON.parse(line)));
    const decision = decisions[0]!;
    const decisionVersions = Object.fromEntries(Object.entries(decision.versions).map(([name, evidence]) => [name, (evidence as { status: string; version?: string }).version]));
    const realConfig = { ...config, datasetVersion: verified.evidence.manifest.datasetVersion, behaviorPolicy: { policyId: decision.behaviorPolicy.policyId, policyVersion: decision.behaviorPolicy.policyVersion.status === 'bound' ? decision.behaviorPolicy.policyVersion.version : 'unbound' }, decisionVersions, targetPolicyConfigSha256: verified.evidence.manifest.policyConfigSha256, segments: [] } as typeof config;
    const evidenceRows = decisions.flatMap((sourceDecision) => sourceDecision.actions.map((logged) => ({
      ...slot(sourceDecision.decisionId, logged.actionKey.servedPosition, 1, 1),
      loggedActionKey: logged.actionKey,
      segments: {},
    })));
    const evidence = buildBoundEvidence(decisions, evidenceRows, realConfig);
    const projected = projectVerifiedOpeEvidenceV2({ config: realConfig, target: verified.evidence, outcomeEvidence: evidence.outcomeEvidence, decisionContextEvidence: evidence.decisionContextEvidence });
    expect(projected).toEqual({ status: 'not_evaluable', blocker: 'decision_version_mismatch' });
  });

  it('clusters two decisions from one verified viewer as one inference unit', () => {
    const shared = { viewerId: 'viewer-shared', inferenceClusterId: 'opaque-viewer-shared' };
    const rows = [
      { ...slot('00000000-0000-4000-8000-000000000001', 1, 1, 1), ...shared },
      { ...slot('00000000-0000-4000-8000-000000000002', 1, 1, 3), ...shared },
    ];
    const report = evaluateOpeV2(input(rows));
    expect(report.observations.uniqueDecisionClusters).toBe(1);
    expect(report.diagnostics.decisionCount).toBe(1);
    expect(report.confidenceIntervals.ips).toEqual({ status: 'unavailable', reason: 'insufficient_decision_clusters', decisionClusterCount: 1 });
  });

  it('keeps threshold and diagnostic bootstrap populations deterministic and domain-separated', () => {
    const phase10Rows = [0, 1, 3, 7].map((reward, index) => withDrPrediction({ ...slot(`00000000-0000-4000-8000-00000000000${index + 1}`, 1, 0.5, reward), realDatasetEligible: false }));
    const projection = input(phase10Rows, drEvaluationConfig);
    const hypothesisEvidence = loadSyntheticFixtureHypothesisSealV1();
    const inferenceInput = {
      projection,
      config: SYNTHETIC_FIXTURE_ROBUST_CONFIG_V1,
      hypothesisEvidence,
    };
    const first = evaluateExperimentalClusterInferenceV1(inferenceInput);
    const second = evaluateExperimentalClusterInferenceV1(inferenceInput);
    expect(first).toEqual(second);
    expect(first.status).toBe('evaluated');
    expect(first.blockers).toEqual(['finite_sample_inference_unavailable']);
    expect(first.thresholdTest?.purposeSeedSha256).not.toBe(first.diagnosticCi?.purposeSeedSha256);
    expect(first.thresholdTest?.thresholdTestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.diagnosticCi?.diagnosticCiSha256).toMatch(/^[0-9a-f]{64}$/);
    if (first.thresholdTest) {
      const { thresholdTestSha256, ...preimage } = first.thresholdTest;
      expect(decisionDigest(preimage)).toBe(thresholdTestSha256);
      expect(decisionDigest({ ...preimage, purposeSeedSha256: '0'.repeat(64) })).not.toBe(thresholdTestSha256);
    }
    if (first.diagnosticCi) {
      const { diagnosticCiSha256, ...preimage } = first.diagnosticCi;
      expect(decisionDigest(preimage)).toBe(diagnosticCiSha256);
      expect(decisionDigest({ ...preimage, purposeSeedSha256: '0'.repeat(64) })).not.toBe(diagnosticCiSha256);
    }
    expect(evaluateExperimentalClusterInferenceV1({ ...inferenceInput, config: { ...SYNTHETIC_FIXTURE_ROBUST_CONFIG_V1, maximumScoreShare: 0.9 } })).toMatchObject({ status: 'not_evaluable', blockers: ['inference_config_digest_mismatch'] });
    const productionProjection = input([0, 1, 3, 7].map((reward, index) => withDrPrediction(slot(`00000000-0000-4000-8000-00000000000${index + 1}`, 1, 0.5, reward))), drEvaluationConfig);
    expect(evaluateExperimentalClusterInferenceV1({ ...inferenceInput, projection: productionProjection })).toMatchObject({ status: 'not_evaluable', blockers: ['hypothesis_seal_trust_root_unavailable'] });
    const tamperedSeal = structuredClone(hypothesisEvidence) as any;
    tamperedSeal.hypothesis.bootstrapSeedMaterial = 'outcome-selected-seed-material';
    expect(evaluateExperimentalClusterInferenceV1({ ...inferenceInput, hypothesisEvidence: tamperedSeal })).toMatchObject({ status: 'not_evaluable', blockers: ['hypothesis_seal_trust_root_unavailable'] });
    const diagnostics = buildRobustInferenceSingleCohortDiagnosticsV1(inferenceInput);
    expect(diagnostics.selectedMethod).toBe('diagnostics_only_abstention_v1');
    expect(diagnostics.methods.selfNormalizedTruncatedBoundAudit).toEqual({ status: 'not_applicable', reason: 'required_bound_assumptions_unavailable' });

    const withoutPrediction = input([0, 1, 3, 7].map((reward, index) => ({ ...slot(`00000000-0000-4000-8000-00000000000${index + 1}`, 1, 0.5, reward), realDatasetEligible: false })));
    expect(evaluateExperimentalClusterInferenceV1({ ...inferenceInput, projection: withoutPrediction })).toMatchObject({ status: 'not_evaluable', blockers: ['prediction_support_incomplete'] });
    const mismatchedPrediction = input(phase10Rows, drEvaluationConfig, false, true, undefined, { ...drPredictionEvidence, receiptSha256: '1'.repeat(64) });
    expect(evaluateExperimentalClusterInferenceV1({ ...inferenceInput, projection: mismatchedPrediction })).toMatchObject({ status: 'not_evaluable', blockers: ['prediction_bundle_digest_mismatch'] });
    const invalidOpeConfig = { ...drEvaluationConfig, clip: 0 };
    const invalidProjection = input(phase10Rows, invalidOpeConfig as typeof drEvaluationConfig);
    expect(evaluateExperimentalClusterInferenceV1({ ...inferenceInput, projection: invalidProjection })).toMatchObject({ status: 'not_evaluable', blockers: ['invalid_input'] });
    expect(evaluateExperimentalClusterInferenceV1(null)).toMatchObject({ status: 'not_evaluable', blockers: ['unverified_projection'] });
    expect(buildRobustInferenceSingleCohortDiagnosticsV1({ projection: null })).toMatchObject({ status: 'not_evaluable', methods: null });

    const tooManyClusters = Array.from({ length: 20 }, (_, index) => withDrPrediction({ ...slot(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, 1, 0.5, index / 2), realDatasetEligible: false }));
    expect(evaluateExperimentalClusterInferenceV1({ ...inferenceInput, projection: input(tooManyClusters, drEvaluationConfig) })).toMatchObject({ status: 'not_evaluable', blockers: ['resource_limit_exceeded'] });
  });

  it('fails the entire bootstrap estimator on an invalid replicate studentizer', () => {
    const summary = summarizeClusterScoresV1('ips', [
      { inferenceClusterId: 'a', y: 0, a: 1, importanceMass: 2 },
      { inferenceClusterId: 'b', y: 2, a: 1, importanceMass: 1 },
    ]);
    expect(summary.status).toBe('evaluated');
    if (summary.status !== 'evaluated') return;
    expect(summary.summary).toMatchObject({ thetaHat: 1, a: 2, standardError: 1, clusterEss: 1.8, maximumScoreShare: 0.5 });
    expect(thresholdBootstrapTV1(summary.summary, 1, 64, 'phase10-invalid-replicate-seed', 'a'.repeat(64), '__all__')).toEqual({ status: 'not_evaluable', blocker: 'bootstrap_replicate_invalid' });
    expect(nearestRankV1([1, 2, 3], 0)).toBe(1);
    expect(nearestRankV1([1, 2, 3], 1)).toBe(3);
    expect(nearestRankV1([0, 10, 20, 30], 0.6)).toBe(20);
  });

  it('uses estimator-specific clipped mass and SNIPS/DR denominators', () => {
    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    const clipped = buildVerifiedClusterScoreSummaryV1(input(ids.map((id, index) => slot(id, 1, 1, index + 1))), 'clippedIps', '__all__');
    expect(clipped.status).toBe('evaluated');
    if (clipped.status === 'evaluated') expect(clipped.summary.clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({ a: 1, importanceMass: 1.5 }),
      expect.objectContaining({ a: 1, importanceMass: 1.5 }),
    ]));

    const snips = buildVerifiedClusterScoreSummaryV1(input(ids.map((id, index) => slot(id, 1, 0.25, index + 1))), 'snips', '__all__');
    expect(snips.status).toBe('evaluated');
    if (snips.status === 'evaluated') expect(snips.summary.clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({ a: 0.5, importanceMass: 0.5 }),
      expect.objectContaining({ a: 0.5, importanceMass: 0.5 }),
    ]));

    const predictionEvidence = { predictionSetVersion: 'p', modelBundleSha256: 'e'.repeat(64), receiptSha256: 'f'.repeat(64) };
    const evaluationConfig = { ...config, predictionEvidence };
    const drRows = ids.map((id, index) => {
      const row = slot(id, 1, 0.5, index * 2 + 1);
      return { ...row, prediction: { ...predictionEvidence, qHat: row.targetDistribution.actions.map(({ actionKey }) => ({ actionKey, value: 0.5 })) } };
    });
    const dr = buildVerifiedClusterScoreSummaryV1(input(drRows, evaluationConfig), 'dr', '__all__');
    expect(dr.status).toBe('evaluated');
    if (dr.status === 'evaluated') expect(dr.summary.clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({ a: 1, importanceMass: 1 }),
      expect.objectContaining({ a: 1, importanceMass: 1 }),
    ]));
  });

  it('computes bounded multi-scenario ablation gates without dropping invalid scenarios', () => {
    const rewards = {
      heavy_tail: [0, 1, 3, 7],
      nominal: [1, 2, 3, 4],
      null: [0, 0.2, 0.7, 1.1],
      invalid_studentizer: [0, 2],
    } as const;
    const scenarios = SYNTHETIC_FIXTURE_ABLATION_PLAN_V1.scenarios.map((descriptor) => ({
      ...descriptor,
      projection: input(rewards[descriptor.scenarioKind].map((reward, index) => withDrPrediction({ ...slot(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, 1, 0.5, reward), realDatasetEligible: false })), drEvaluationConfig),
    }));
    const report = evaluateRobustInferenceSyntheticAblationV1({
      config: SYNTHETIC_FIXTURE_ROBUST_CONFIG_V1,
      hypothesisEvidence: loadSyntheticFixtureHypothesisSealV1(),
      gates: SYNTHETIC_FIXTURE_ABLATION_PLAN_V1.gates,
      scenarios,
    });
    expect(report).toMatchObject({ status: 'failed_gates', selectedMethod: 'diagnostics_only_abstention_v1', scenarioCount: 4 });
    expect(report.scenarioResults).toHaveLength(4);
    expect(report.methods?.clusterMultiplierBootstrapT).toMatchObject({
      evaluableScenarioCount: 3,
      falsePromotionEligibleCount: 1,
      falsePromotionRate: 0,
      invalidReplicateCount: 1,
      invalidReplicateRate: 0.25,
    });
    const bootstrapMetrics = report.methods?.clusterMultiplierBootstrapT;
    expect(bootstrapMetrics?.nominalCoverage).toBe((bootstrapMetrics?.coveredScenarioCount ?? 0) / 3);
    expect(report.methods?.selfNormalizedTruncatedBoundAudit).toEqual({ status: 'not_applicable', reason: 'required_bound_assumptions_unavailable' });
    expect(report.gates?.failures).toContain('synthetic_invalid_replicate_gate_failed');
    expect(report.blockers[0]).toBe('finite_sample_inference_unavailable');

    const changedHeavyTailProjection = input(
      [0, 1, 3, 6].map((reward, index) => withDrPrediction({
        ...slot(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, 1, 0.5, reward),
        realDatasetEligible: false,
      })),
      drEvaluationConfig,
    );
    const projectionDrift = evaluateRobustInferenceSyntheticAblationV1({
      config: SYNTHETIC_FIXTURE_ROBUST_CONFIG_V1,
      hypothesisEvidence: loadSyntheticFixtureHypothesisSealV1(),
      gates: SYNTHETIC_FIXTURE_ABLATION_PLAN_V1.gates,
      scenarios: scenarios.map((scenario, index) => (
        index === 0 ? { ...scenario, projection: changedHeavyTailProjection } : scenario
      )),
    });
    expect(projectionDrift).toMatchObject({
      status: 'not_evaluable',
      blockers: ['finite_sample_inference_unavailable', 'synthetic_scenario_set_mismatch'],
      scenarioCount: 0,
    });

    expect(evaluateRobustInferenceSyntheticAblationV1(null)).toMatchObject({
      status: 'not_evaluable',
      blockers: ['finite_sample_inference_unavailable', 'hypothesis_seal_trust_root_unavailable'],
    });
    const throwingInput = new Proxy({}, {
      get: () => { throw new Error('malformed ablation input'); },
    });
    expect(() => evaluateRobustInferenceSyntheticAblationV1(throwingInput)).not.toThrow();
    expect(evaluateRobustInferenceSyntheticAblationV1(throwingInput)).toMatchObject({
      status: 'not_evaluable',
      blockers: ['finite_sample_inference_unavailable', 'synthetic_ablation_evaluation_failed'],
    });
    expect(() => buildRobustInferenceSingleCohortDiagnosticsV1(throwingInput)).not.toThrow();
    expect(buildRobustInferenceSingleCohortDiagnosticsV1(throwingInput)).toMatchObject({
      status: 'not_evaluable',
      blockers: ['inference_math_failed'],
      methods: null,
    });
  });
});
