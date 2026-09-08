import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { ActionType } from '../../src/models/UserAction';
import { verifySyntheticContextV1 } from '../../src/services/recommendation/decisionContext/syntheticContextV1';
import { canonicalDecisionJson } from '../../src/services/recommendation/decisionLog/contracts';
import { canonicalWireJsonV1 } from '../../src/services/recommendation/offlinePrediction/artifacts/canonical';
import { verifySyntheticTrajectoryEvidenceV1 } from '../../src/services/recommendation/offlinePrediction/streamingV2';
import { verifyTargetDistributionStreamV2 } from '../../src/services/recommendation/offlinePrediction/targetEvidence';
import {
  evaluateInferenceQualificationV1,
  auditSyntheticFamilyTrajectoryBindingsV1,
  inferenceQualificationResultV1Schema,
  isVerifiedInferenceQualificationResultV1,
  issueSyntheticTimeUniformCsEvidenceV1,
} from '../../src/services/recommendation/ope/inference/qualification';
import {
  createOpeAggregateStateV3,
  finalizeOpeAggregateReceiptV3,
  replayOpeTrajectoryV3,
} from '../../src/services/recommendation/ope/v3';
import {
  syntheticOutcomeEventSha256V1,
  verifySyntheticOutcomeEvidenceV1,
} from '../../src/services/recommendation/outcomes/syntheticOutcomeEvidenceV1';
import {
  loadSyntheticFixtureEvaluationProtocolV1,
  verifyFrozenEvaluationFamilyV1,
} from '../../src/services/recommendation/promotion/evaluationProtocol';

const fixtureDirectory = path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures',
);
const sha256 = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
const stream = (raw: string) => async function* () { yield Buffer.from(raw); };
const diagnosticReferences = {
  clusterMultiplierBootstrapT: {
    method: 'cluster_score_multiplier_bootstrap_t_v1' as const,
    reference: { status: 'unavailable' as const },
  },
  clusteredWald: {
    method: 'decision_cluster_robust_wald_v1' as const,
    reference: { status: 'unavailable' as const },
  },
};

async function verifiedChain(country = 'US') {
  const behaviorFixture = JSON.parse(readFileSync(path.join(
    fixtureDirectory, 'phase11_synthetic_behavior_trajectory_v1.json',
  ), 'utf8'));
  const targetFixture = JSON.parse(readFileSync(path.join(
    fixtureDirectory, 'target_policy_distribution_stream_v1.json',
  ), 'utf8'));
  const targetReceipt = JSON.parse(readFileSync(path.join(
    fixtureDirectory, 'target_distribution_stream_receipt_v2.json',
  ), 'utf8'));
  const target = await verifyTargetDistributionStreamV2({
    trustScope: 'synthetic_fixture',
    sourceDecisionStream: stream(targetFixture.sourceDecisionNdjson),
    distributionStream: stream(targetFixture.expectedDistributionNdjson),
    sourceDatasetManifestRaw: targetFixture.sourceDatasetManifestRaw,
    policyConfigRaw: targetFixture.policyConfigRaw,
    targetManifestRaw: targetFixture.expectedTargetManifestRaw,
    verificationReceiptRaw: `${canonicalWireJsonV1(targetReceipt.expectedReceipt)}\n`,
  });
  if (target.status !== 'verified') throw new Error(target.blocker);

  const source = behaviorFixture.input.sourceDecisionLog;
  const syntheticDecisionLog = {
    contractVersion: 'synthetic_decision_log_v1',
    decisionId: source.decisionId,
    requestId: source.requestId,
    decisionAt: source.decisionAt,
    sourceDecisionLogSha256: behaviorFixture.input.sourceDecisionLogSha256,
    sourceCandidatePoolSha256: source.candidatePool.candidatePoolSha256,
    behaviorPolicy: behaviorFixture.input.config,
    behaviorPolicyConfigSha256: behaviorFixture.behaviorPolicyConfigSha256,
    uniformDraws: behaviorFixture.input.uniformDraws,
    actions: behaviorFixture.expected.orderedActions.map((action: any, index: number) => ({
      actionKey: action.actionKey,
      selectionRank: index + 1,
      behaviorPropensity: {
        status: 'simulated_propensity',
        plackettLuceProbability: action.plackettLuceProbability,
        conditionalSelectionProbability: action.conditionalSelectionProbability,
      },
    })),
    evidenceKind: 'simulated_propensity',
    realDatasetEligible: false,
    servable: false,
  };
  const syntheticDecisionLogSha256 = sha256(syntheticDecisionLog);
  const rewardDefinition = {
    objective: 'synthetic_dwell',
    definitionVersion: 'phase11-synthetic-v1',
    horizonMs: 100,
    weights: {
      click: 0, like: 0, reply: 0, repost: 0, quote: 0,
      share: 0, dismiss: 0, blockAuthor: 0, report: 0,
    },
    dwell: { weight: 1, capMs: 10, scaleMs: 1 },
  };
  const impressionAt = Date.parse(source.decisionAt) + 1;
  const events = syntheticDecisionLog.actions.flatMap((action: any, index: number) => {
    const common = {
      userId: 'phase11-synthetic-user',
      requestId: source.requestId,
      rank: action.actionKey.servedPosition,
      metadata: {
        decisionId: source.decisionId,
        candidateNamespace: action.actionKey.candidateNamespace,
        candidateId: action.actionKey.candidateId,
        positionContractVersion: 'served_position_1_based_v1',
      },
    };
    return [
      {
        ...common, action: ActionType.IMPRESSION,
        timestamp: new Date(impressionAt).toISOString(),
        metadata: { ...common.metadata, recommendationEventKey: `impression-${index}` },
      },
      {
        ...common, action: ActionType.DWELL,
        timestamp: new Date(impressionAt + 1).toISOString(), dwellTimeMs: index + 1,
        metadata: { ...common.metadata, recommendationEventKey: `dwell-${index}` },
      },
    ].map((event) => ({
      eventId: event.metadata.recommendationEventKey,
      eventSha256: syntheticOutcomeEventSha256V1(event),
      event,
    }));
  });
  const outcome = verifySyntheticOutcomeEvidenceV1({
    contractVersion: 'synthetic_outcome_verification_input_v1',
    datasetVersion: 'phase11-synthetic-dataset',
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    traceUserId: 'phase11-synthetic-user',
    observedThrough: new Date(impressionAt + rewardDefinition.horizonMs).toISOString(),
    rewardDefinition,
    events,
  });
  if (outcome.status !== 'verified') throw new Error(outcome.blocker);
  const context = verifySyntheticContextV1({
    contractVersion: 'synthetic_context_verification_input_v1',
    datasetVersion: 'phase11-synthetic-dataset',
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    contextAt: new Date(Date.parse(source.decisionAt) - 2).toISOString(),
    availableAt: new Date(Date.parse(source.decisionAt) - 1).toISOString(),
    sourceSha256: 'c'.repeat(64),
    sourceVersion: 'phase11-context-v1',
    inferenceClusterId: 'cluster-a',
    segments: { country },
  });
  if (context.status !== 'verified') throw new Error(context.blocker);
  const trajectory = await verifySyntheticTrajectoryEvidenceV1({
    contractVersion: 'synthetic_trajectory_verification_input_v1',
    behaviorFixture,
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    outcomeEvidence: outcome.evidence,
    contextEvidence: context.evidence,
    targetEvidence: target.evidence,
    evidenceKind: 'simulated_propensity',
    realDatasetEligible: false,
    servable: false,
  });
  if (trajectory.status !== 'verified') throw new Error(trajectory.blocker);
  const state = createOpeAggregateStateV3({
    limits: {
      maxDecisions: 2, maxSlots: 4, maxClusters: 2, maxSegmentKeys: 4,
      maxObjectives: 2, maxAggregateStateEntries: 8,
      maxEstimatedAggregateStateBytes: 32_768,
      maxBufferedActions: 4_096, maxBufferedRecords: 2_049,
      maxBufferedBytes: 1_048_576,
    },
    trajectories: [trajectory.evidence],
  });
  if (state.status !== 'created') throw new Error(state.blocker);
  const replay = await replayOpeTrajectoryV3(state.state, trajectory.evidence);
  if (replay.status !== 'verified') throw new Error(replay.blocker);
  const aggregate = finalizeOpeAggregateReceiptV3(state.state);
  if (aggregate.status !== 'verified') throw new Error(aggregate.blocker);
  const protocol = await loadSyntheticFixtureEvaluationProtocolV1();
  return {
    frozenFamilyEvidence: protocol.family,
    holdoutLedgerReceipt: protocol.receipt,
    syntheticTrajectoryEvidence: trajectory.evidence,
    syntheticOutcomeEvidence: outcome.evidence,
    syntheticContextEvidence: context.evidence,
    opeAggregateReceipt: aggregate.receipt,
  };
}

function semanticFamily(
  chain: Awaited<ReturnType<typeof verifiedChain>>,
  mutate: (family: any) => void = () => undefined,
) {
  const outcome = chain.syntheticOutcomeEvidence;
  const context = chain.syntheticContextEvidence;
  const trajectory = chain.syntheticTrajectoryEvidence;
  const receipt = chain.opeAggregateReceipt;
  const canonicalSort = (values: unknown[]) => values.sort((left, right) => Buffer.compare(
    Buffer.from(canonicalDecisionJson(left)),
    Buffer.from(canonicalDecisionJson(right)),
  ));
  const preimage: any = {
    contractVersion: 'frozen_evaluation_family_v1',
    familyId: 'phase11-semantic-audit-family-v1',
    candidatePolicies: [{
      policyId: 'eligible_pool_epsilon_plackett_luce_v1',
      policyVersion: 'epsilon-pl-v1',
      policyConfigSha256: trajectory.targetPolicyConfigSha256,
    }],
    objectives: [{
      objective: outcome.objective,
      estimator: 'ips',
      operator: 'gte',
      threshold: 0,
    }],
    segments: context.segmentAssignments.map((segment) => ({
      segmentKey: segment.key,
      segmentValue: segment.value,
      contextSourceVersion: context.sourceVersion,
      contextSourceSha256: context.sourceSha256,
      pitBoundary: 'context_at_lte_available_at_lte_decision_at_v1',
    })),
    estimand: 'mean_reward_per_logged_slot_v1',
    dataset: {
      datasetId: outcome.datasetVersion,
      datasetSha256: sha256({
        contractVersion: 'synthetic_inference_dataset_binding_v1',
        datasetId: outcome.datasetVersion,
        outcomeEvidenceSha256: outcome.syntheticOutcomeEvidenceSha256,
        contextEvidenceSha256: context.syntheticContextSha256,
        trajectoryEvidenceSha256: trajectory.trajectoryEvidenceSha256,
      }),
    },
    holdout: { holdoutId: 'semantic-audit-holdout', holdoutSha256: '4'.repeat(64) },
    seedMaterial: 'phase11-semantic-audit-seed',
    evidenceBindings: canonicalSort([
      { bindingId: 'outcome_evidence', sha256: outcome.syntheticOutcomeEvidenceSha256 },
      { bindingId: 'decision_context', sha256: context.syntheticContextSha256 },
      { bindingId: 'target_distribution', sha256: receipt.targetEvidenceRootsSha256 },
      { bindingId: 'synthetic_trajectory', sha256: trajectory.trajectoryEvidenceSha256 },
      { bindingId: 'ope_v3_receipt', sha256: receipt.receiptSha256 },
    ]),
    configBindings: [{ bindingId: 'ope_config', sha256: receipt.resourceConfigSha256 }],
    frozenAt: '2026-07-20T07:00:00.000Z',
    holdoutRevealNotBefore: '2026-07-20T08:00:00.000Z',
    multiplicityProcedure: 'intersection_union_all_must_pass_v1',
    realDatasetEligible: false,
  };
  mutate(preimage);
  const result = verifyFrozenEvaluationFamilyV1({
    ...preimage,
    familySha256: sha256(preimage),
  });
  if (result.status !== 'verified') throw new Error(result.blocker);
  return result.family;
}

function semanticAuditInput(
  chain: Awaited<ReturnType<typeof verifiedChain>>,
  family = semanticFamily(chain),
) {
  return { ...chain, frozenFamilyEvidence: family };
}

async function verifiedInput() {
  const provenance = await verifiedChain();
  const receipt = provenance.opeAggregateReceipt;
  return {
    contractVersion: 'inference_qualification_request_v1' as const,
    resourceLimits: {
      contractVersion: 'inference_qualification_resource_limits_v1' as const,
      maximumScenarioCount: 4,
      maximumRecordCount: 16,
      maximumClusterCount: 16,
      maximumEstimatedStateBytes: 32_768,
    },
    highWater: {
      contractVersion: 'inference_qualification_high_water_v1' as const,
      scenarioCount: 1,
      recordCount: receipt.observedSlotCount,
      clusterCount: receipt.highWaterDiagnostics.clusters,
      estimatedStateBytes: receipt.highWaterDiagnostics.estimatedAggregateStateBytes,
    },
    diagnosticReferences,
    ...provenance,
    timeUniformCsEvidence: null,
  };
}

describe('Phase 11 inference qualification', () => {
  it('fails closed when hostile qualification and provenance inputs throw', () => {
    const ownKeysTrap = new Proxy(Object.freeze({}), {
      ownKeys: () => { throw new Error('hostile_own_keys'); },
    });
    expect(evaluateInferenceQualificationV1(ownKeysTrap)).toMatchObject({
      status: 'completed_with_abstention',
      blockers: expect.arrayContaining(['inference_qualification_contract_invalid']),
    });
    expect(issueSyntheticTimeUniformCsEvidenceV1(ownKeysTrap)).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_cs_provenance_unverified',
    });
    expect(auditSyntheticFamilyTrajectoryBindingsV1(ownKeysTrap)).toEqual({
      status: 'not_evaluable', blockers: ['synthetic_cs_provenance_unverified'],
    });
  });

  it('fails closed when nested confidence-sequence evidence throws', async () => {
    const ownKeysTrap = new Proxy(Object.freeze({}), {
      ownKeys: () => { throw new Error('hostile_own_keys'); },
    });
    const result = evaluateInferenceQualificationV1({
      ...await verifiedInput(),
      timeUniformCsEvidence: ownKeysTrap,
    });

    expect(result.methods.timeUniformConfidenceSequence).toMatchObject({
      status: 'not_applicable',
      confidenceSequence: null,
      reasons: expect.arrayContaining([
        'verified_synthetic_assumption_evidence_unavailable',
        'objective_tuple_evidence_unavailable',
      ]),
    });
  });

  it('refuses placeholder roots and exposes missing objective-tuple evidence', async () => {
    const placeholder = await verifiedChain('US');
    expect(auditSyntheticFamilyTrajectoryBindingsV1(placeholder).blockers).toEqual(
      expect.arrayContaining([
        'synthetic_cs_segment_binding_mismatch',
        'synthetic_cs_objective_tuple_binding_mismatch',
        'synthetic_cs_policy_binding_mismatch',
        'synthetic_cs_dataset_binding_mismatch',
        'synthetic_cs_evidence_root_binding_mismatch',
        'synthetic_cs_config_binding_mismatch',
        'objective_tuple_evidence_unavailable',
      ]),
    );
    expect(issueSyntheticTimeUniformCsEvidenceV1(placeholder).status).toBe('not_evaluable');

    const chain = await verifiedChain('US');
    expect(auditSyntheticFamilyTrajectoryBindingsV1(semanticAuditInput(chain))).toEqual({
      status: 'not_evaluable',
      blockers: ['objective_tuple_evidence_unavailable'],
    });
  });

  it.each([
    ['segment', (family: any) => { family.segments[0].segmentValue = 'DE'; }, 'synthetic_cs_segment_binding_mismatch'],
    ['objective tuple', (family: any) => { family.objectives[0].operator = 'lte'; }, 'objective_tuple_evidence_unavailable'],
    ['policy', (family: any) => { family.candidatePolicies[0].policyVersion = 'other-v1'; }, 'synthetic_cs_policy_binding_mismatch'],
    ['dataset', (family: any) => { family.dataset.datasetSha256 = 'd'.repeat(64); }, 'synthetic_cs_dataset_binding_mismatch'],
    ['evidence root', (family: any) => { family.evidenceBindings[0].sha256 = 'e'.repeat(64); }, 'synthetic_cs_evidence_root_binding_mismatch'],
  ])('isolates the %s semantic guard', async (_name, mutate, blocker) => {
    const chain = await verifiedChain('US');
    const family = semanticFamily(chain, mutate);
    const audit = auditSyntheticFamilyTrajectoryBindingsV1(semanticAuditInput(chain, family));
    expect(audit.blockers).toContain(blocker);
    expect(audit.blockers).toContain('objective_tuple_evidence_unavailable');
  });

  it('returns a branded abstention with no mixed-chain bindings', async () => {
    const result = evaluateInferenceQualificationV1(await verifiedInput());

    expect(inferenceQualificationResultV1Schema.safeParse(result).success).toBe(true);
    expect(isVerifiedInferenceQualificationResultV1(result)).toBe(true);
    expect(result.bindings).toEqual({
      frozenFamilySha256: null,
      holdoutLedgerReceiptSha256: null,
      timeUniformCsEvidenceSha256: null,
      trajectoryEvidenceSha256: null,
      opeV3ReceiptSha256: null,
    });
    expect(result.methods.timeUniformConfidenceSequence).toMatchObject({
      status: 'not_applicable',
      confidenceSequence: null,
      reasons: [
        'verified_synthetic_assumption_evidence_unavailable',
        'objective_tuple_evidence_unavailable',
      ],
    });
    expect(result.methods.clusterMultiplierBootstrapT).toEqual({
      method: 'cluster_score_multiplier_bootstrap_t_v1',
      status: 'unavailable', evidenceSha256: null,
    });
    expect(result.blockers).toEqual([
      'finite_sample_inference_unavailable', 'multiplicity_control_unavailable',
    ]);
    expect(result).toMatchObject({
      selectedMethod: 'diagnostics_only_abstention_v1', realDatasetEligible: false,
    });
  });

  it('rejects cloned and forged qualification results despite schema validity', async () => {
    const result = evaluateInferenceQualificationV1(await verifiedInput());
    const cloned = structuredClone(result);
    expect(inferenceQualificationResultV1Schema.safeParse(cloned).success).toBe(true);
    expect(isVerifiedInferenceQualificationResultV1(cloned)).toBe(false);
    expect(isVerifiedInferenceQualificationResultV1({
      ...cloned, qualificationSha256: 'f'.repeat(64),
    })).toBe(false);
  });

  it('returns a valid result capability with all bindings null for a crossed chain', async () => {
    const input = await verifiedInput();
    const other = await verifiedChain('DE');
    const result = evaluateInferenceQualificationV1({
      ...input,
      syntheticTrajectoryEvidence: other.syntheticTrajectoryEvidence,
      syntheticOutcomeEvidence: other.syntheticOutcomeEvidence,
      syntheticContextEvidence: other.syntheticContextEvidence,
      opeAggregateReceipt: other.opeAggregateReceipt,
    });
    expect(isVerifiedInferenceQualificationResultV1(result)).toBe(true);
    expect(Object.values(result.bindings)).toEqual([null, null, null, null, null]);
  });

  it('does not mint assumption evidence from caller-cloned provenance', async () => {
    const provenance = await verifiedChain();
    expect(issueSyntheticTimeUniformCsEvidenceV1({
      ...provenance,
      opeAggregateReceipt: structuredClone(provenance.opeAggregateReceipt),
    })).toEqual({ status: 'not_evaluable', blocker: 'synthetic_cs_provenance_unverified' });
  });

  it('rejects caller-declared diagnostic availability without removing fixed blockers', async () => {
    const input = await verifiedInput();
    const result = evaluateInferenceQualificationV1({
      ...input,
      diagnosticReferences: {
        ...diagnosticReferences,
        clusteredWald: {
          method: 'decision_cluster_robust_wald_v1',
          reference: { status: 'available', evidenceSha256: 'a'.repeat(64) },
        },
      },
    });
    expect(result.blockers).toEqual([
      'inference_qualification_contract_invalid',
      'holdout_ledger_completeness_unverified',
      'finite_sample_inference_unavailable',
      'multiplicity_control_unavailable',
    ]);
    expect(result.methods.clusteredWald).toEqual({
      method: 'decision_cluster_robust_wald_v1', status: 'unavailable', evidenceSha256: null,
    });
    expect(result.realDatasetEligible).toBe(false);
  });
});
