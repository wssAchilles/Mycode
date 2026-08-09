import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import {
  candidatePoolSha256,
  decisionLogSha256,
  recommendationDecisionLogSchema,
  type RecommendationDecisionLogV1,
} from '../../src/services/recommendation/decisionLog/contracts';
import {
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SEARCH_STATES,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SLATE_SIZE,
  MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SUPPORT_ACTIONS,
  multiObjectiveShadowPolicyInputSchema,
  type MultiObjectiveShadowPolicyInputV1,
} from '../../src/services/recommendation/shadowPolicy/contracts';
import { evaluateMultiObjectiveShadowPolicyV1 } from '../../src/services/recommendation/shadowPolicy/evaluate';

const VERSION = {
  pipeline: 'pipeline-v1',
  strategy: 'strategy-v1',
  policy: 'policy-v1',
  graph: 'graph-v1',
  model: 'model-v1',
  artifact: 'artifact-v1',
  index: 'index-v1',
} as const;
const HORIZON_MS = 60_000;
const CANDIDATE_IDS = ['candidate-a', 'candidate-b', 'candidate-c', 'candidate-d'] as const;

function actionKey(candidateId: string, servedPosition: number) {
  return {
    candidateNamespace: 'serving_post_id' as const,
    candidateId,
    servedPosition,
  };
}

function buildDecision(): RecommendationDecisionLogV1 {
  const candidates = CANDIDATE_IDS.map((candidateId, index) => ({
    candidateNamespace: 'serving_post_id' as const,
    candidateId,
    poolRank: index + 1,
    eligible: true,
    score: 1 - index / 10,
    selected: index === 0,
    selectionRank: index === 0 ? 1 : null,
    served: index === 0,
    servedPosition: index === 0 ? 1 : null,
    objectiveEvidence: [],
  }));
  return recommendationDecisionLogSchema.parse({
    contractVersion: 'recommendation_decision_log_v1',
    positionContractVersion: 'served_position_1_based_v1',
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    decisionId: '11111111-1111-4111-8111-111111111111',
    decisionAt: '2026-07-17T08:00:00.000Z',
    servingOwner: 'rust',
    fallbackReason: null,
    behaviorPolicyKind: 'deterministic_top_k',
    behaviorPolicy: {
      policyId: 'behavior-v1',
      policyVersion: { status: 'bound', version: VERSION.policy },
    },
    versions: Object.fromEntries(Object.entries(VERSION).map(([key, version]) => [
      key,
      { status: 'bound', version },
    ])),
    candidatePool: {
      supportEvidence: { status: 'complete' },
      totalCount: candidates.length,
      truncated: false,
      candidates,
      candidatePoolSha256: candidatePoolSha256(candidates),
    },
    actions: [{
      actionKey: actionKey('candidate-a', 1),
      selectionRank: 1,
      behaviorPropensity: {
        status: 'not_evaluable_deterministic',
        reason: 'deterministic_top_k_no_logged_probability',
      },
    }],
  });
}

function validInput(): MultiObjectiveShadowPolicyInputV1 {
  const decisionLog = buildDecision();
  const digest = decisionLogSha256(decisionLog);
  const actions = CANDIDATE_IDS.map((candidateId, index) => actionKey(candidateId, index + 1));
  const binding = {
    decisionId: decisionLog.decisionId,
    decisionLogSha256: digest,
    candidatePoolSha256: decisionLog.candidatePool.candidatePoolSha256,
    datasetVersion: 'dataset-v1',
  };
  const predictions = {
    click: [0.5, 0.75, 0.75, 1],
    risk: [0.125, 0.25, 0.25, 0.875],
  } as const;

  return multiObjectiveShadowPolicyInputSchema.parse({
    config: {
      contractVersion: 'multi_objective_shadow_policy_v1',
      policyId: 'shadow-policy',
      policyVersion: 'v1',
      datasetVersion: 'dataset-v1',
      decisionVersions: { ...VERSION },
      horizonMs: HORIZON_MS,
      slateSize: 2,
      maxSearchStates: 1_000,
      objectives: [
        {
          objective: 'click',
          predictionArtifactVersion: 'click-prediction-v1',
          rewardDefinitionVersion: 'click-reward-v1',
          weight: 1,
        },
        {
          objective: 'risk',
          predictionArtifactVersion: 'risk-prediction-v1',
          rewardDefinitionVersion: 'risk-reward-v1',
          weight: -1,
        },
      ],
      candidateSafetyLimit: { objective: 'risk', maxPrediction: 0.8 },
      slateSafetyConstraint: { objective: 'risk', maxMeanPrediction: 0.3 },
    },
    decisionLog,
    decisionLogSha256: digest,
    behaviorSupport: { ...binding, status: 'complete', actions },
    predictionArtifacts: [
      {
        ...binding,
        artifactVersion: 'click-prediction-v1',
        objective: 'click',
        rewardDefinitionVersion: 'click-reward-v1',
        horizonMs: HORIZON_MS,
        predictions: actions.map((key, index) => ({ actionKey: key, qHat: predictions.click[index] })),
      },
      {
        ...binding,
        artifactVersion: 'risk-prediction-v1',
        objective: 'risk',
        rewardDefinitionVersion: 'risk-reward-v1',
        horizonMs: HORIZON_MS,
        predictions: actions.map((key, index) => ({ actionKey: key, qHat: predictions.risk[index] })),
      },
    ],
  });
}

function rebindDecision(
  input: MultiObjectiveShadowPolicyInputV1,
  decisionLog: RecommendationDecisionLogV1,
): void {
  const digest = decisionLogSha256(decisionLog);
  const binding = {
    decisionId: decisionLog.decisionId,
    decisionLogSha256: digest,
    candidatePoolSha256: decisionLog.candidatePool.candidatePoolSha256,
    datasetVersion: input.config.datasetVersion,
  };
  input.decisionLog = decisionLog;
  input.decisionLogSha256 = digest;
  input.behaviorSupport = { ...input.behaviorSupport, ...binding };
  input.predictionArtifacts = input.predictionArtifacts.map((artifact) => ({ ...artifact, ...binding }));
}

type FailureCase = {
  name: string;
  mutate: (input: MultiObjectiveShadowPolicyInputV1) => void;
  expectedBlockers: string[];
};

const FAILURE_CASES: FailureCase[] = [
  {
    name: 'missing objective artifact',
    mutate: (input) => { input.predictionArtifacts.pop(); },
    expectedBlockers: ['prediction_artifact_set_mismatch'],
  },
  {
    name: 'duplicate objective artifact',
    mutate: (input) => { input.predictionArtifacts.push(structuredClone(input.predictionArtifacts[0])); },
    expectedBlockers: ['prediction_artifact_set_mismatch'],
  },
  {
    name: 'missing artifact coverage',
    mutate: (input) => { input.predictionArtifacts[0].predictions.pop(); },
    expectedBlockers: ['prediction_coverage_mismatch'],
  },
  {
    name: 'extra artifact coverage',
    mutate: (input) => {
      input.predictionArtifacts[0].predictions.push({
        actionKey: actionKey('candidate-extra', 5),
        qHat: 0.1,
      });
    },
    expectedBlockers: ['prediction_coverage_mismatch'],
  },
  {
    name: 'duplicate artifact action',
    mutate: (input) => {
      input.predictionArtifacts[0].predictions[1] = structuredClone(
        input.predictionArtifacts[0].predictions[0],
      );
    },
    expectedBlockers: ['prediction_action_duplicate'],
  },
  {
    name: 'decision digest mismatch',
    mutate: (input) => { input.decisionLogSha256 = '0'.repeat(64); },
    expectedBlockers: [
      'behavior_support_binding_mismatch',
      'decision_log_digest_mismatch',
      'prediction_artifact_binding_mismatch',
    ],
  },
  {
    name: 'candidate pool digest mismatch',
    mutate: (input) => { input.behaviorSupport.candidatePoolSha256 = '0'.repeat(64); },
    expectedBlockers: ['behavior_support_binding_mismatch'],
  },
  {
    name: 'dataset mismatch',
    mutate: (input) => { input.config.datasetVersion = 'other-dataset'; },
    expectedBlockers: [
      'behavior_support_binding_mismatch',
      'prediction_artifact_binding_mismatch',
    ],
  },
  {
    name: 'horizon mismatch',
    mutate: (input) => { input.predictionArtifacts[0].horizonMs += 1; },
    expectedBlockers: ['prediction_artifact_binding_mismatch'],
  },
  {
    name: 'decision version mismatch',
    mutate: (input) => { input.config.decisionVersions.pipeline = 'other-pipeline'; },
    expectedBlockers: ['decision_version_mismatch'],
  },
  {
    name: 'unbound decision version',
    mutate: (input) => {
      const decision = recommendationDecisionLogSchema.parse({
        ...input.decisionLog,
        versions: {
          ...input.decisionLog.versions,
          model: { status: 'unavailable', reason: 'not_recorded' },
        },
      });
      rebindDecision(input, decision);
    },
    expectedBlockers: ['decision_version_mismatch'],
  },
  {
    name: 'artifact version mismatch',
    mutate: (input) => { input.predictionArtifacts[0].artifactVersion = 'other-artifact'; },
    expectedBlockers: ['prediction_artifact_binding_mismatch'],
  },
  {
    name: 'reward definition version mismatch',
    mutate: (input) => { input.predictionArtifacts[0].rewardDefinitionVersion = 'other-reward'; },
    expectedBlockers: ['prediction_artifact_binding_mismatch'],
  },
  {
    name: 'incomplete behavior support',
    mutate: (input) => {
      input.behaviorSupport = {
        ...input.behaviorSupport,
        status: 'incomplete',
        reason: 'support_not_logged',
      };
    },
    expectedBlockers: ['behavior_support_incomplete'],
  },
  {
    name: 'duplicate support action key',
    mutate: (input) => {
      input.behaviorSupport.actions.push(structuredClone(input.behaviorSupport.actions[0]));
    },
    expectedBlockers: ['behavior_support_action_duplicate'],
  },
  {
    name: 'support action outside eligible pool',
    mutate: (input) => {
      const outsideAction = actionKey('candidate-extra', 5);
      input.behaviorSupport.actions.push(outsideAction);
      input.predictionArtifacts.forEach((artifact) => {
        artifact.predictions.push({ actionKey: outsideAction, qHat: 0.1 });
      });
    },
    expectedBlockers: ['behavior_support_candidate_ineligible_or_missing'],
  },
  {
    name: 'candidate safety leaves too few actions',
    mutate: (input) => { input.config.candidateSafetyLimit.maxPrediction = 0.1; },
    expectedBlockers: ['candidate_safety_insufficient'],
  },
  {
    name: 'derived utility is non-finite',
    mutate: (input) => {
      input.config.objectives[0].weight = Number.MAX_VALUE;
      input.predictionArtifacts[0].predictions[0].qHat = Number.MAX_VALUE;
    },
    expectedBlockers: ['non_finite_utility'],
  },
];

describe('multi_objective_shadow_policy_v1', () => {
  it('requires a positive integer feasible-slate search budget', () => {
    const input = validInput();

    expect(multiObjectiveShadowPolicyInputSchema.safeParse({
      ...input,
      config: { ...input.config, maxSearchStates: 1_000 },
    }).success).toBe(true);
    expect(multiObjectiveShadowPolicyInputSchema.safeParse({
      ...input,
      config: { ...input.config, maxSearchStates: 0 },
    }).success).toBe(false);
    expect(multiObjectiveShadowPolicyInputSchema.safeParse({
      ...input,
      config: { ...input.config, maxSearchStates: 1.5 },
    }).success).toBe(false);
  });

  it('rejects search inputs above the fixed resource limits', () => {
    const input = validInput();
    const oversized = [
      { ...input, config: { ...input.config, maxSearchStates: MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SEARCH_STATES + 1 } },
      { ...input, config: { ...input.config, slateSize: MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SLATE_SIZE + 1 } },
      {
        ...input,
        behaviorSupport: {
          ...input.behaviorSupport,
          actions: Array.from(
            { length: MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SUPPORT_ACTIONS + 1 },
            () => input.behaviorSupport.actions[0],
          ),
        },
      },
    ];

    oversized.forEach((candidate) => {
      expect(multiObjectiveShadowPolicyInputSchema.safeParse(candidate).success).toBe(false);
      expect(evaluateMultiObjectiveShadowPolicyV1(candidate)).toMatchObject({
        status: 'not_evaluable',
        blockers: ['invalid_input'],
      });
    });
  });

  it('fails closed before deep parsing oversized prediction or candidate arrays', () => {
    const oversizedPredictions = validInput();
    oversizedPredictions.predictionArtifacts[0].predictions = Array.from(
      { length: 257 },
      () => structuredClone(oversizedPredictions.predictionArtifacts[0].predictions[0]),
    );
    const oversizedCandidates = validInput();
    oversizedCandidates.decisionLog.candidatePool.candidates = Array.from(
      { length: 2_049 },
      () => structuredClone(oversizedCandidates.decisionLog.candidatePool.candidates[0]),
    );
    const oversizedObjectiveEvidence = validInput();
    oversizedObjectiveEvidence.decisionLog.candidatePool.candidates[0].objectiveEvidence = Array.from(
      { length: 33 },
      () => ({
        status: 'available' as const,
        objective: 'click',
        prediction: 0,
        artifactVersion: 'click-prediction-v1',
      }),
    );

    [oversizedPredictions, oversizedCandidates, oversizedObjectiveEvidence].forEach((input) => {
      expect(evaluateMultiObjectiveShadowPolicyV1(input)).toMatchObject({
        status: 'not_evaluable',
        blockers: ['invalid_input'],
        fingerprint: { status: 'unavailable', reason: 'input_too_large' },
      });
    });
  });

  it('ranks two objectives deterministically while enforcing candidate and slate safety', () => {
    const input = validInput();
    const result = evaluateMultiObjectiveShadowPolicyV1(input);
    const reordered = structuredClone(input);
    reordered.predictionArtifacts.reverse();
    reordered.predictionArtifacts.forEach((artifact) => artifact.predictions.reverse());
    const reorderedResult = evaluateMultiObjectiveShadowPolicyV1(reordered);

    expect(result).toMatchObject({
      contractVersion: 'multi_objective_shadow_policy_v1',
      status: 'evaluated',
      servable: false,
    });
    expect(result.rankedActions).toEqual([
      {
        actionKey: actionKey('candidate-b', 2),
        shadowRank: 1,
        utility: 0.5,
        objectivePredictions: [
          { objective: 'click', qHat: 0.75 },
          { objective: 'risk', qHat: 0.25 },
        ],
      },
      {
        actionKey: actionKey('candidate-c', 3),
        shadowRank: 2,
        utility: 0.5,
        objectivePredictions: [
          { objective: 'click', qHat: 0.75 },
          { objective: 'risk', qHat: 0.25 },
        ],
      },
    ]);
    expect(result.constraintDiagnostics).toEqual({
      candidateSafetyLimit: {
        status: 'evaluated',
        objective: 'risk',
        maxPrediction: 0.8,
        excludedActions: [{ actionKey: actionKey('candidate-d', 4), prediction: 0.875 }],
        safeActionCount: 3,
      },
      slateSafetyConstraint: {
        status: 'evaluated',
        objective: 'risk',
        maxMeanPrediction: 0.3,
        selectedMeanPrediction: 0.25,
        satisfied: true,
      },
    });
    expect(result.fingerprint).toMatchObject({ status: 'available', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(reorderedResult).toEqual(result);
    expect(evaluateMultiObjectiveShadowPolicyV1(input)).toEqual(result);
    result.rankedActions.forEach((ranked) => {
      expect(Object.keys(ranked)).toEqual([
        'actionKey',
        'shadowRank',
        'utility',
        'objectivePredictions',
      ]);
    });
    expect(JSON.stringify(result)).not.toMatch(/"(?:post|author|content|servingOwner|fallbackReason)"/);
  });

  it('finds the highest-utility feasible slate when the top utility slice is unsafe', () => {
    const input = validInput();
    input.config.slateSafetyConstraint.maxMeanPrediction = 0.2;

    const result = evaluateMultiObjectiveShadowPolicyV1(input);

    expect(result.status).toBe('evaluated');
    expect(result.rankedActions.map(({ actionKey: key }) => key)).toEqual([
      actionKey('candidate-b', 2),
      actionKey('candidate-a', 1),
    ]);
    expect(result.constraintDiagnostics.slateSafetyConstraint).toEqual({
      status: 'evaluated',
      objective: 'risk',
      maxMeanPrediction: 0.2,
      selectedMeanPrediction: 0.1875,
      satisfied: true,
    });
  });

  it('keeps a finite mean utility when the equivalent total would overflow', () => {
    const input = validInput();
    input.config.slateSize = 3;
    input.predictionArtifacts[0].predictions.forEach((prediction) => {
      prediction.qHat = Number.MAX_VALUE / 2;
    });
    input.predictionArtifacts[1].predictions.forEach((prediction) => {
      prediction.qHat = 0;
    });

    const result = evaluateMultiObjectiveShadowPolicyV1(input);

    expect(result).toMatchObject({ status: 'evaluated', servable: false });
    expect(result.rankedActions).toHaveLength(3);
    expect(result.rankedActions.every(({ utility }) => utility === Number.MAX_VALUE / 2)).toBe(true);
  });

  it('fails closed when floating-point mean accumulation becomes non-finite', () => {
    const input = validInput();
    input.config.slateSize = 3;
    input.predictionArtifacts[0].predictions.forEach((prediction) => {
      prediction.qHat = Number.MAX_VALUE;
    });
    input.predictionArtifacts[1].predictions.forEach((prediction) => {
      prediction.qHat = 0;
    });

    expect(evaluateMultiObjectiveShadowPolicyV1(input)).toMatchObject({
      status: 'not_evaluable',
      blockers: ['non_finite_search_arithmetic'],
      servable: false,
      rankedActions: [],
    });
  });

  it('fails closed when scoring or scaling loses non-zero terms', () => {
    const safetyUnderflow = validInput();
    safetyUnderflow.config.slateSafetyConstraint.maxMeanPrediction = 0;
    safetyUnderflow.predictionArtifacts[1].predictions.forEach((prediction) => {
      prediction.qHat = Number.MIN_VALUE;
    });

    const utilityUnderflow = validInput();
    utilityUnderflow.predictionArtifacts[0].predictions.forEach((prediction) => {
      prediction.qHat = Number.MIN_VALUE;
    });
    utilityUnderflow.predictionArtifacts[1].predictions.forEach((prediction) => {
      prediction.qHat = 0;
    });

    const scoringUnderflow = validInput();
    scoringUnderflow.config.objectives[0].weight = 0.5;
    scoringUnderflow.predictionArtifacts[0].predictions.forEach((prediction) => {
      prediction.qHat = Number.MIN_VALUE;
    });
    scoringUnderflow.predictionArtifacts[1].predictions.forEach((prediction) => {
      prediction.qHat = 0;
    });

    [safetyUnderflow, utilityUnderflow].forEach((input) => {
      expect(evaluateMultiObjectiveShadowPolicyV1(input)).toMatchObject({
        status: 'not_evaluable',
        blockers: ['non_finite_search_arithmetic'],
        servable: false,
        rankedActions: [],
      });
    });
    expect(evaluateMultiObjectiveShadowPolicyV1(scoringUnderflow)).toMatchObject({
      status: 'not_evaluable',
      blockers: ['non_finite_utility'],
      servable: false,
      rankedActions: [],
    });
  });

  it('distinguishes an exhausted feasible-slate search from a complete infeasibility proof', () => {
    const exhaustedInput = validInput();
    exhaustedInput.config.maxSearchStates = 1;
    const exhausted = evaluateMultiObjectiveShadowPolicyV1(exhaustedInput);

    expect(exhausted).toMatchObject({
      status: 'not_evaluable',
      blockers: ['feasible_slate_search_exhausted'],
    });
    expect((exhausted as { blockers: string[] }).blockers).not.toContain(
      'slate_safety_no_feasible_slate',
    );

    const infeasibleInput = validInput();
    infeasibleInput.config.slateSafetyConstraint.maxMeanPrediction = 0.1;
    expect(evaluateMultiObjectiveShadowPolicyV1(infeasibleInput)).toMatchObject({
      status: 'not_evaluable',
      blockers: ['slate_safety_no_feasible_slate'],
    });
  });

  it('accepts repeated support candidates and positions while selecting a unique slate', () => {
    const input = validInput();
    const repeatedCandidate = actionKey('candidate-a', 2);
    const repeatedPosition = actionKey('candidate-c', 2);
    input.behaviorSupport.actions[1] = repeatedCandidate;
    input.behaviorSupport.actions[2] = repeatedPosition;
    input.predictionArtifacts.forEach((artifact) => {
      artifact.predictions[1].actionKey = repeatedCandidate;
      artifact.predictions[2].actionKey = repeatedPosition;
    });

    const result = evaluateMultiObjectiveShadowPolicyV1(input);

    expect(result.status).toBe('evaluated');
    expect(result.rankedActions.map(({ actionKey: key }) => key)).toEqual([
      repeatedPosition,
      actionKey('candidate-a', 1),
    ]);
  });

  it('fingerprints the actual decision log and feasible-slate search budget', () => {
    const firstInput = validInput();
    const secondInput = validInput();
    firstInput.decisionLog = recommendationDecisionLogSchema.parse({
      ...firstInput.decisionLog,
      decisionAt: '2026-07-17T08:01:00.000Z',
    });
    secondInput.decisionLog = recommendationDecisionLogSchema.parse({
      ...secondInput.decisionLog,
      decisionAt: '2026-07-17T08:02:00.000Z',
    });
    firstInput.decisionLogSha256 = '0'.repeat(64);
    secondInput.decisionLogSha256 = '0'.repeat(64);

    const first = evaluateMultiObjectiveShadowPolicyV1(firstInput);
    const second = evaluateMultiObjectiveShadowPolicyV1(secondInput);

    expect(first).toMatchObject({
      status: 'not_evaluable',
      blockers: expect.arrayContaining(['decision_log_digest_mismatch']),
      fingerprint: { status: 'available' },
    });
    expect(second).toMatchObject({
      status: 'not_evaluable',
      blockers: expect.arrayContaining(['decision_log_digest_mismatch']),
      fingerprint: { status: 'available' },
    });
    if (first.fingerprint.status !== 'available' || second.fingerprint.status !== 'available') {
      throw new Error('expected available fingerprints');
    }
    expect(first.fingerprint.sha256).not.toBe(second.fingerprint.sha256);

    const budgetInput = validInput();
    budgetInput.config.maxSearchStates += 1;
    const baseline = evaluateMultiObjectiveShadowPolicyV1(validInput());
    const changedBudget = evaluateMultiObjectiveShadowPolicyV1(budgetInput);
    expect(baseline.status).toBe('evaluated');
    expect(changedBudget.status).toBe('evaluated');
    if (
      baseline.fingerprint.status !== 'available'
      || changedBudget.fingerprint.status !== 'available'
    ) throw new Error('expected available fingerprints');
    expect(baseline.fingerprint.sha256).not.toBe(changedBudget.fingerprint.sha256);
  });

  it.each(FAILURE_CASES)('fails closed for $name', ({ mutate, expectedBlockers }) => {
    const input = validInput();
    mutate(input);

    const first = evaluateMultiObjectiveShadowPolicyV1(input);
    const second = evaluateMultiObjectiveShadowPolicyV1(input);

    expect(first.status).toBe('not_evaluable');
    expect(first.servable).toBe(false);
    expect(first.rankedActions).toEqual([]);
    expect(first).toHaveProperty('blockers');
    expect((first as { blockers: string[] }).blockers).toEqual(expectedBlockers);
    expect(second).toEqual(first);
  });

  it('does not throw for invalid input and has no serving/runtime import boundary', () => {
    const invalid = { ...validInput(), unexpected: true };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => evaluateMultiObjectiveShadowPolicyV1(invalid)).not.toThrow();
    expect(evaluateMultiObjectiveShadowPolicyV1(invalid)).toMatchObject({
      status: 'not_evaluable',
      servable: false,
      rankedActions: [],
      fingerprint: { status: 'available' },
    });
    expect(() => evaluateMultiObjectiveShadowPolicyV1(cyclic)).not.toThrow();
    expect(evaluateMultiObjectiveShadowPolicyV1(cyclic)).toMatchObject({
      status: 'not_evaluable',
      servable: false,
      rankedActions: [],
      fingerprint: { status: 'unavailable', reason: 'input_not_canonicalizable' },
    });

    const source = [
      'contracts.ts',
      'evaluate.ts',
    ].map((file) => readFileSync(path.resolve(
      __dirname,
      `../../src/services/recommendation/shadowPolicy/${file}`,
    ), 'utf8')).join('\n');
    expect(source).not.toMatch(
      /FeedCandidate|SpaceService|Pipeline|selector|scorer|RecommendationTrace|mongoose|express|process\.env|runtimeOwnership/,
    );
  });

  it('loads the shadow contract graph without mongoose', async () => {
    vi.resetModules();
    vi.doMock('mongoose', () => {
      throw new Error('shadow contracts must not load mongoose');
    });
    try {
      await expect(import('../../src/services/recommendation/shadowPolicy/contracts')).resolves.toMatchObject({
        MULTI_OBJECTIVE_SHADOW_POLICY_VERSION: 'multi_objective_shadow_policy_v1',
      });
    } finally {
      vi.doUnmock('mongoose');
    }
  });
});
