import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { canonicalDecisionJson } from '../../src/services/recommendation/decisionLog/contracts';
import {
  directionalTestResolutionV2,
  thresholdBootstrapTV2,
} from '../../src/services/recommendation/ope/inference/directionalV2';
import { summarizeClusterScoresV1 } from '../../src/services/recommendation/ope/inference/clusterScores';
import {
  buildFrozenInferenceQualificationProtocolV1,
  runSyntheticSequentialDrQualificationV1,
} from '../../src/services/recommendation/ope/inference/qualification/v2';
import {
  deriveKnownTruthV1,
  generateSyntheticClusterScoreReplicationV1,
  isVerifiedSyntheticClusterScoreReplicationV1,
  syntheticUniform53V1,
} from '../../src/services/recommendation/ope/inference/qualification/v2/dgp';
import {
  probabilityVectorV1,
  rotateProbabilityV1,
} from '../../src/services/recommendation/ope/inference/qualification/v2/dgpMath';
import { setQualificationTestHooksV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/evaluate';
import {
  createQualificationArtifactValidatorV1,
  publishSyntheticQualificationArtifactV1,
  qualificationWorstCaseCanonicalRecordBytesV1,
} from '../../src/services/recommendation/ope/inference/qualification/v2/artifact';
import { setAtomicSinkTestHooksV1 } from '../../src/services/recommendation/offlinePrediction/snapshotV2/atomicSink';
import {
  evaluateFrozenDirectionalFamilyV2,
  holmStepDownV1,
  intersectionUnionAllMustPassV1,
  verifyFrozenPolicyEvaluationFamilyV2,
} from '../../src/services/recommendation/promotion/evaluationProtocol/v2';
import { verifyFrozenEvaluationFamilyV1 } from '../../src/services/recommendation/promotion/evaluationProtocol';
import { issueSyntheticDirectionalHypothesisTestSetFixtureV2 } from '../../src/services/recommendation/promotion/evaluationProtocol/v2/multiplicity';

const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');

function scoreSummary() {
  const result = summarizeClusterScoresV1('dr', [
    { inferenceClusterId: 'cluster-a', y: 2.4, a: 2, importanceMass: 1.1 },
    { inferenceClusterId: 'cluster-b', y: 0.8, a: 2, importanceMass: 0.9 },
    { inferenceClusterId: 'cluster-c', y: 1.6, a: 2, importanceMass: 1.2 },
    { inferenceClusterId: 'cluster-d', y: 2.0, a: 2, importanceMass: 0.8 },
  ]);
  if (result.status !== 'evaluated') throw new Error(result.blocker);
  return result.summary;
}

describe('Phase 12 directional inference contracts', () => {
  it('uses independent inclusive one-sided tails and binds their semantics', () => {
    const summary = scoreSummary();
    const common = {
      summary,
      nullThreshold: 0.5,
      bootstrapReplicates: 127,
      seedMaterial: 'phase12-directional-seed-material',
      inputSha256: 'a'.repeat(64),
      segment: '__all__',
    };
    const greater = thresholdBootstrapTV2({ ...common, direction: 'greater' });
    const less = thresholdBootstrapTV2({ ...common, direction: 'less' });

    expect(greater.status).toBe('evaluated');
    expect(less.status).toBe('evaluated');
    if (greater.status !== 'evaluated' || less.status !== 'evaluated') return;
    expect(greater.pValue).toBeLessThan(less.pValue);
    expect(greater).toMatchObject({
      direction: 'greater',
      alternative: 'theta_greater_than_null_v1',
      bootstrapPurpose: 'directional_threshold_test_v2',
      domainSeparator: 'ope_directional_threshold_test_bootstrap_v2',
      pValueDefinitionVersion: 'add_one_inclusive_directional_tail_v1',
      bootstrapReplicates: 127,
      inputSha256: 'a'.repeat(64),
    });
    expect(greater.thresholdTestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(less.thresholdTestSha256).not.toBe(greater.thresholdTestSha256);
  });

  it('fails before interpretation when the bootstrap p-value cannot reach Holm', () => {
    expect(directionalTestResolutionV2({
      bootstrapReplicates: 127,
      familyAlpha: 0.05,
      hypothesisCount: 6,
      procedure: 'holm_step_down_v1',
    })).toEqual({
      status: 'reachable',
      minimumPValue: 1 / 128,
      firstThreshold: 0.05 / 6,
    });
    expect(directionalTestResolutionV2({
      bootstrapReplicates: 127,
      familyAlpha: 0.05,
      hypothesisCount: 7,
      procedure: 'holm_step_down_v1',
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'directional_test_resolution_insufficient',
    });
    expect(thresholdBootstrapTV2({
      summary: {
        ...scoreSummary(),
        clusters: Array.from({ length: 8_000 }, (_, index) => ({
          inferenceClusterId: `cluster-${index}`,
          y: 1,
          a: 1,
          importanceMass: 1,
          score: 0,
        })),
      },
      nullThreshold: 0.5,
      direction: 'greater',
      bootstrapReplicates: 127,
      seedMaterial: 'phase12-directional-seed-material',
      inputSha256: 'a'.repeat(64),
      segment: '__all__',
    })).toEqual({ status: 'not_evaluable', blocker: 'directional_test_contract_invalid' });
    expect(directionalTestResolutionV2({
      bootstrapReplicates: 127,
      familyAlpha: 0.05,
      hypothesisCount: 1,
      procedure: 'caller_forged_procedure' as never,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'directional_test_resolution_insufficient',
    });
  });

  it('maps hostile inherited family inputs to the stable V1 blocker', () => {
    const hostile = new Proxy(Object.freeze({}), {
      get: () => { throw new Error('hostile getter'); },
    });
    expect(() => verifyFrozenEvaluationFamilyV1(hostile)).not.toThrow();
    expect(verifyFrozenEvaluationFamilyV1(hostile)).toEqual({
      status: 'not_evaluable',
      blocker: 'frozen_evaluation_family_invalid',
    });
  });

  it('freezes directional families and applies inclusive IUT/Holm rules', () => {
    const holm = holmStepDownV1([
      { hypothesisId: 'b', pValue: 0.025 },
      { hypothesisId: 'a', pValue: 0.025 },
    ], 0.05);
    expect(holm).toEqual({
      status: 'evaluated',
      passed: true,
      ordered: [
        { hypothesisId: 'a', pValue: 0.025, threshold: 0.025, rejected: true },
        { hypothesisId: 'b', pValue: 0.025, threshold: 0.05, rejected: true },
      ],
    });
    expect(intersectionUnionAllMustPassV1([
      { hypothesisId: 'a', pValue: 0.05 },
      { hypothesisId: 'b', pValue: 0.01 },
    ], 0.05)).toMatchObject({ status: 'evaluated', passed: true });

    const preimage = {
      contractVersion: 'frozen_policy_evaluation_family_v2' as const,
      familyId: 'phase12-family',
      candidatePolicy: {
        policyId: 'candidate-policy', policyVersion: 'v1', policyConfigSha256: '1'.repeat(64),
      },
      estimand: 'mean_reward_per_logged_slot_v1' as const,
      hypotheses: Array.from({ length: 7 }, (_, index) => ({
        hypothesisId: `h-${index}`,
        objective: 'reward',
        segment: '__all__',
        direction: 'greater' as const,
        nullThreshold: 0.5,
        alternative: 'theta_greater_than_null_v1' as const,
      })),
      familyAlpha: 0.05,
      procedure: 'holm_step_down_v1' as const,
      bootstrapReplicates: 127,
      bootstrapSeedMaterial: 'phase12-frozen-bootstrap-seed',
      qualificationProtocolSha256: '2'.repeat(64),
      dataset: { datasetId: 'synthetic-dataset', datasetSha256: '3'.repeat(64) },
      holdout: { holdoutId: 'synthetic-holdout', holdoutSha256: '4'.repeat(64) },
      configBindings: [{ bindingId: 'inference', sha256: '5'.repeat(64) }],
      frozenAt: '2026-07-27T00:00:00.000Z',
      holdoutRevealNotBefore: '2026-07-28T00:00:00.000Z',
      realDatasetEligible: false as const,
    };
    const verified = verifyFrozenPolicyEvaluationFamilyV2({
      ...preimage,
      familySha256: digest(preimage),
    });
    expect(verified).toEqual({
      status: 'not_evaluable',
      blocker: 'directional_test_resolution_insufficient',
    });

    const twoHypothesisPreimage = {
      ...preimage,
      hypotheses: preimage.hypotheses.slice(0, 2),
    };
    const twoHypothesisFamily = verifyFrozenPolicyEvaluationFamilyV2({
      ...twoHypothesisPreimage,
      familySha256: digest(twoHypothesisPreimage),
    });
    expect(twoHypothesisFamily.status).toBe('verified');
    if (twoHypothesisFamily.status !== 'verified') return;
    const issued = issueSyntheticDirectionalHypothesisTestSetFixtureV2(
      twoHypothesisFamily.family,
    );
    expect(issued.status).toBe('verified');
    if (issued.status !== 'verified') return;
    expect(issued.testSet).toMatchObject({
      contractVersion: 'verified_directional_hypothesis_test_set_v2',
      familySha256: twoHypothesisFamily.family.familySha256,
      qualificationProtocolSha256: twoHypothesisFamily.family.qualificationProtocolSha256,
      realDatasetEligible: false,
    });
    expect(evaluateFrozenDirectionalFamilyV2(
      twoHypothesisFamily.family,
      structuredClone(issued.testSet),
    )).toEqual({
      status: 'not_evaluable', blocker: 'directional_hypothesis_test_set_invalid',
    });
    expect(evaluateFrozenDirectionalFamilyV2(
      twoHypothesisFamily.family,
      issued.testSet,
    )).toMatchObject({ status: 'evaluated', realDatasetEligible: false });
  });
});

describe('Phase 12 frozen synthetic qualification', () => {
  const protocolInput = {
    protocolId: 'phase12-synthetic-qualification',
    generatorSeedMaterial: 'phase12-generator-seed-material-v1',
    bootstrapSeedMaterial: 'phase12-bootstrap-seed-material-v1',
    frozenAt: '2026-07-27T00:00:00.000Z',
  } as const;

  it('freezes reachable resource math and derives truth from the DGP', () => {
    const built = buildFrozenInferenceQualificationProtocolV1(protocolInput);
    expect(built.status).toBe('verified');
    if (built.status !== 'verified') return;

    expect(built.protocol.resources).toMatchObject({
      criticalClusterCounts: [4, 4, 4, 4, 4, 2, 4, 4],
      criticalReplicationsPerScenario: 117,
      criticalClusterScores: 3_510,
      totalClusterScores: 3_512,
      qHatEvaluations: 28_080,
      generatorPrimitiveWorkUnits: 108_812,
      bootstrapWorkUnits: 892_048,
      plannedRecordCount: 5_420,
      plannedBytesUpperBound: 22_205_740,
    });
    expect(built.protocol.reachability).toMatchObject({
      coverageDenominator: 936,
      falsePromotionDenominator: 819,
      invalidRateDenominator: 936,
      reachable: true,
    });
    expect(deriveKnownTruthV1(built.protocol.scenarios.find(
      (scenario) => scenario.scenarioId === 'nominal_positive',
    )!)).toBe(0.55);
    expect(deriveKnownTruthV1(built.protocol.scenarios.find(
      (scenario) => scenario.scenarioId === 'harmful_policy',
    )!)).toBe(0.45);
  });

  it('uses frozen domain-separated random draws and produces immutable private scores', () => {
    expect(syntheticUniform53V1(
      'cluster_shock_v1',
      'a'.repeat(64),
      ['critical', 'nominal_positive', 0, 0],
    )).toBe(0.7298944267974538);
    expect(syntheticUniform53V1(
      'behavior_action_v1',
      'a'.repeat(64),
      ['critical', 'nominal_positive', 0, 0, 1],
    )).toBe(0.47083878038339844);
    expect(syntheticUniform53V1(
      'reward_draw_v1',
      'a'.repeat(64),
      ['critical', 'nominal_positive', 0, 0, 1],
    )).not.toBe(0.47083878038339844);
    expect(rotateProbabilityV1(probabilityVectorV1('positive'), 1)).toEqual([
      0.2, 0.3, 0.4, 0.1,
    ]);

    const built = buildFrozenInferenceQualificationProtocolV1(protocolInput);
    if (built.status !== 'verified') throw new Error(built.blocker);
    const scenario = built.protocol.scenarios.find(
      (candidate) => candidate.scenarioId === 'nominal_positive',
    )!;
    const first = generateSyntheticClusterScoreReplicationV1(built.protocol, scenario, 0);
    const second = generateSyntheticClusterScoreReplicationV1(built.protocol, scenario, 0);
    expect(first.status).toBe('generated');
    expect(second).toEqual(first);
    if (first.status !== 'generated') return;
    expect(isVerifiedSyntheticClusterScoreReplicationV1(first.replication)).toBe(true);
    expect(first.replication).toMatchObject({
      contractVersion: 'verified_synthetic_cluster_score_replication_v1',
      estimator: 'dr',
      knownTruth: 0.55,
      realDatasetEligible: false,
      servable: false,
      canMintVerifiedPredictionStepV2: false,
    });
    expect(Object.isFrozen(first.replication)).toBe(true);
    expect(Object.isFrozen(first.replication.clusterScores)).toBe(true);
    expect(first.replication.clusterScores[0]).toEqual({
      inferenceClusterId: 'cluster-00',
      y: 0.48399999999999993,
      a: 2,
      importanceMass: 1.12,
    });

    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1);
    const early = generateSyntheticClusterScoreReplicationV1(built.protocol, scenario, 1);
    clock.mockReturnValue(9_999_999_999_999);
    const late = generateSyntheticClusterScoreReplicationV1(built.protocol, scenario, 1);
    clock.mockRestore();
    expect(late).toEqual(early);

    const misspecified = built.protocol.scenarios.find(
      (candidate) => candidate.scenarioId === 'synthetic_dr_score_misspecification',
    )!;
    const misspecifiedReplication = generateSyntheticClusterScoreReplicationV1(
      built.protocol, misspecified, 0,
    );
    expect(misspecifiedReplication.status).toBe('generated');
    if (misspecifiedReplication.status === 'generated') {
      expect(misspecifiedReplication.replication.clusterScores[0]!.y).toBe(1);
      expect(misspecifiedReplication.replication.clusterScores[0]!.importanceMass).toBe(2);
    }
  });

  it('rejects resource drift before invoking the private generator', async () => {
    const built = buildFrozenInferenceQualificationProtocolV1(protocolInput);
    if (built.status !== 'verified') throw new Error(built.blocker);
    const tampered = JSON.parse(JSON.stringify(built.protocol));
    tampered.resources.bootstrapWorkUnits += 1;
    let calls = 0;
    setQualificationTestHooksV1({ beforeGenerateReplication: () => { calls += 1; } });
    try {
      const result = await runSyntheticSequentialDrQualificationV1(tampered);
      expect(result.candidateStatus).toBe('not_evaluable');
      expect(result.blockers).toEqual([
        'finite_sample_inference_unavailable',
        'multiplicity_control_unavailable',
        'resource_limit_exceeded',
      ]);
      expect(calls).toBe(0);
    } finally {
      setQualificationTestHooksV1();
    }
  });

  it('keeps honest abstention blockers even when synthetic gates run', async () => {
    const built = buildFrozenInferenceQualificationProtocolV1(protocolInput);
    if (built.status !== 'verified') throw new Error(built.blocker);
    const result = await runSyntheticSequentialDrQualificationV1(built.protocol);
    expect(result.candidateStatus).toBe('failed');
    expect(result.selectedMethod).toBe('diagnostics_only_abstention_v1');
    expect(result.realDatasetEligible).toBe(false);
    expect(result.blockers).toEqual([
      'finite_sample_inference_unavailable',
      'multiplicity_control_unavailable',
      'critical_replication_not_evaluable:few_clusters',
      'critical_replication_not_evaluable:near_zero_propensity',
      'critical_replication_not_evaluable:nominal_null',
      'critical_replication_not_evaluable:prefix_weight_heavy_tail',
      'critical_replication_not_evaluable:synthetic_dr_score_misspecification',
      'coverage_gate_failed',
      'false_promotion_gate_failed',
      'invalid_replicate_gate_failed',
    ]);
    expect(result.metrics).toEqual({
      coverageSuccesses: 663,
      coverageDenominator: 936,
      coverageLowerBound: 0.6615663591637135,
      falsePromotions: 5,
      falsePromotionDenominator: 819,
      falsePromotionUpperBound: 0.05610100449324161,
      invalidReplicates: 99,
      invalidRateDenominator: 936,
      invalidRateUpperBound: 0.15253620493885062,
    });
    expect(result.diagnostics.resources).toMatchObject({
      actualRecordCount: 5_420,
      actualClusterScoreCount: 3_512,
      actualBootstrapWorkUnits: 879_856,
      bootstrapWorkUnits: 892_048,
    });
    expect(result.qualificationSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('enforces the closed artifact grammar and 4096-byte canonical bound', () => {
    const built = buildFrozenInferenceQualificationProtocolV1(protocolInput);
    if (built.status !== 'verified') throw new Error(built.blocker);
    expect(qualificationWorstCaseCanonicalRecordBytesV1()).toBeLessThanOrEqual(4_096);
    const validator = createQualificationArtifactValidatorV1(built.protocol);
    expect(() => validator.accept({
      record: 'cluster_score',
      version: 'synthetic_qualification_cluster_score_v1',
      scenarioKind: 'critical',
      scenarioId: 'nominal_positive',
      replicationIndex: 0,
      clusterId: 'cluster-00',
      y: 0,
      a: 2,
      importanceMass: 1,
    })).toThrow('qualification_artifact_grammar_invalid');
  });

  it('publishes through one bounded spool and preserves post-link uncertainty', async () => {
    const built = buildFrozenInferenceQualificationProtocolV1(protocolInput);
    if (built.status !== 'verified') throw new Error(built.blocker);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'phase12-artifact-test-'));
    const target = path.join(directory, 'qualification.ndjson');
    try {
      setAtomicSinkTestHooksV1({
        syncParentDirectory: async () => { throw new Error('simulated parent fsync failure'); },
      });
      const published = await publishSyntheticQualificationArtifactV1({
        protocol: built.protocol,
        targetPath: target,
      });
      expect(published).toMatchObject({
        status: 'published_durability_unconfirmed',
        publishedByThisAttempt: true,
        finalPathVisibility: 'may_be_visible',
        retryDisposition: 'reconciliation_required',
        reason: 'parent_directory_sync_failed',
        recordCount: 5_420,
      });
      const publishedRaw = await readFile(target, 'utf8');
      expect(publishedRaw.length).toBeGreaterThan(0);
      expect(JSON.parse(publishedRaw.trimEnd().split('\n').at(-1)!)).toMatchObject({
        record: 'artifact_end',
        candidateStatus: 'failed',
        expectedRecordCount: 5_420,
      });

      const existingTarget = path.join(directory, 'already-present.ndjson');
      await writeFile(existingTarget, 'existing');
      const prePublish = await publishSyntheticQualificationArtifactV1({
        protocol: built.protocol,
        targetPath: existingTarget,
      });
      expect(prePublish).toMatchObject({
        status: 'pre_publish_failed',
        publishedByThisAttempt: false,
        finalPathVisibility: 'must_recheck',
        retryDisposition: 'only_after_absence_confirmed',
      });

      setQualificationTestHooksV1({
        beforeGenerateReplication: () => { throw new Error('/private/path/must-not-leak'); },
      });
      const callbackTarget = path.join(directory, 'callback-failure.ndjson');
      expect(await publishSyntheticQualificationArtifactV1({
        protocol: built.protocol,
        targetPath: callbackTarget,
      })).toMatchObject({
        status: 'pre_publish_failed',
        publishedByThisAttempt: false,
        reason: 'qualification_artifact_publish_failed',
      });
      await expect(readFile(callbackTarget)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      setQualificationTestHooksV1();
      setAtomicSinkTestHooksV1();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
