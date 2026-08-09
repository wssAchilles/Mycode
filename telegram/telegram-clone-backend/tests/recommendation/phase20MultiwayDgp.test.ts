import { describe, expect, it, vi } from 'vitest';

const brands = vi.hoisted(() => ({
  phase19Handoffs: new WeakSet<object>(),
}));

vi.mock(
  '../../src/services/recommendation/ope/inference/qualification/v9/handoff',
  async (importOriginal) => ({
    ...(await importOriginal<typeof import(
      '../../src/services/recommendation/ope/inference/qualification/v9/handoff'
    )>()),
    isVerifiedPhase19SameProcessNoCandidateHandoffV1: (value: unknown) => (
      !!value && typeof value === 'object' && brands.phase19Handoffs.has(value)
    ),
  }),
);

import {
  buildFrozenMultiwayDgpProtocolV2,
  deriveKnownTruthV2,
  generateFrozenMultiwayDgpReplicationV2,
  isVerifiedFrozenMultiwayDgpProtocolV2,
  isVerifiedFrozenMultiwayDgpReplicationV2,
  MULTIWAY_DGP_DRAW_DOMAINS_V2,
  preflightFrozenMultiwayDgpV2,
  scenarioInventoryV2,
  selectActionV2,
  setMultiwayDgpTestHooksV2,
  syntheticUniform53V2,
} from '../../src/services/recommendation/ope/inference/qualification/v10/dgp';
import * as dgpGenerator from '../../src/services/recommendation/ope/inference/qualification/v10/dgp/generator';
import {
  buildVerifiedMultiwayScoreSurfaceV1,
  isVerifiedMultiwayScoreSurfaceV1,
  type ScoreSurfaceAggregateV1,
  type ScoreSurfaceSlotAtomV1,
} from '../../src/services/recommendation/ope/inference/qualification/v10/scoreSurface';
import { PHASE19_HANDOFF_BLOCKERS_V1 } from '../../src/services/recommendation/ope/inference/qualification/v9/handoff';
import {
  buildPhase20SameProcessNoCandidateHandoffV1,
  isVerifiedPhase20SameProcessNoCandidateHandoffV1,
  PHASE20_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v10/handoff';

const input = {
  protocolId: 'phase20-frozen-multiway-v2',
  generatorSeedMaterial: 'phase20-test-seed-material-v2',
  frozenAt: '2026-08-05T00:00:00.000Z',
} as const;

type ProtocolInput = Readonly<{
  protocolId: string;
  generatorSeedMaterial: string;
  frozenAt: string;
}>;

function protocol(overrides: Partial<ProtocolInput> = {}) {
  const result = buildFrozenMultiwayDgpProtocolV2({ ...input, ...overrides });
  if (result.status !== 'verified') throw new Error(result.blocker);
  return result.protocol;
}

function scoreSurface(owner = protocol()) {
  const result = buildVerifiedMultiwayScoreSurfaceV1({ protocol: owner });
  if (result.status !== 'verified') throw new Error(result.blocker);
  return result.surface;
}

function phase19Handoff(overrides: Record<string, unknown> = {}) {
  const value = Object.freeze({
    contractVersion: 'phase19_same_process_offline_diagnostic_handoff_v1',
    handoffScope: 'same_process_offline_diagnostic_v1',
    developmentStatus: 'completed_multiway_qhat_retraining_no_candidate_selected',
    multiwayQHatProvenanceStatus: 'verified_synthetic_only',
    trainingApplied: true,
    trainingEvidenceScope: 'mechanical_training_e2e_only',
    dgpV2LaunchReadiness: 'ready_for_frozen_design',
    commonTimeShockHandlingVerified: false,
    researchCandidateMethod: null,
    candidateSelectionStatus: 'no_candidate_selected',
    candidateQualificationStatus: 'not_run',
    candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
    selectedMethod: 'diagnostics_only_abstention_v1',
    qualificationEvidenceEligible: false,
    candidateEvidenceEligible: false,
    realDatasetEligible: false,
    servable: false,
    sealedQualificationStatus: 'not_ready',
    nextPhaseHandoff: 'ready_to_design_frozen_dgp_v2',
    phase18HandoffSha256: '1'.repeat(64),
    phase18ProvenanceSha256: '2'.repeat(64),
    phase18PlanSha256: '3'.repeat(64),
    sourcePredictionVerificationReceiptSha256: '4'.repeat(64),
    predictionV4SetVersion: 'phase19-test-prediction-v4',
    predictionV4ModelBundleSha256: '5'.repeat(64),
    predictionV4StreamSha256: '6'.repeat(64),
    predictionV4VerificationReceiptSha256: '7'.repeat(64),
    blockers: PHASE19_HANDOFF_BLOCKERS_V1,
    handoffSha256: '8'.repeat(64),
    ...overrides,
  });
  brands.phase19Handoffs.add(value);
  return value;
}

type AggregateLevel = ScoreSurfaceAggregateV1['level'];

function recomputeAggregates(
  atoms: readonly ScoreSurfaceSlotAtomV1[],
  level: AggregateLevel,
): readonly ScoreSurfaceAggregateV1[] {
  const grouped = new Map<string, {
    scenarioKind: string;
    scenarioId: string;
    replicationIndex: number;
    decisionId?: string;
    viewerClusterId?: string;
    timeClusterId?: string;
    slotCount: number;
    decisionIds: Set<string>;
    drContributionSum: number;
    ipsContributionSum: number;
    importanceMass: number;
  }>();
  for (const atom of atoms) {
    const key = aggregateKey(atom, level);
    const aggregate = grouped.get(key) ?? {
      scenarioKind: atom.scenarioKind,
      scenarioId: atom.scenarioId,
      replicationIndex: atom.replicationIndex,
      ...(level === 'decision' ? { decisionId: atom.decisionId } : {}),
      ...(level === 'viewer_time_cell' || level === 'viewer'
        ? { viewerClusterId: atom.viewerClusterId }
        : {}),
      ...(level === 'viewer_time_cell' || level === 'time'
        ? { timeClusterId: atom.timeClusterId }
        : {}),
      slotCount: 0,
      decisionIds: new Set<string>(),
      drContributionSum: 0,
      ipsContributionSum: 0,
      importanceMass: 0,
    };
    aggregate.slotCount += 1;
    aggregate.decisionIds.add(atom.decisionId);
    aggregate.drContributionSum += atom.drContribution;
    aggregate.ipsContributionSum += atom.ipsContribution;
    aggregate.importanceMass += atom.weight;
    grouped.set(key, aggregate);
  }
  return [...grouped.entries()].map(([key, aggregate]) => ({
    scenarioKind: aggregate.scenarioKind,
    scenarioId: aggregate.scenarioId,
    replicationIndex: aggregate.replicationIndex,
    ...(aggregate.decisionId === undefined ? {} : { decisionId: aggregate.decisionId }),
    ...(aggregate.viewerClusterId === undefined
      ? {}
      : { viewerClusterId: aggregate.viewerClusterId }),
    ...(aggregate.timeClusterId === undefined
      ? {}
      : { timeClusterId: aggregate.timeClusterId }),
    level,
    key,
    slotCount: aggregate.slotCount,
    decisionCount: aggregate.decisionIds.size,
    drContributionSum: aggregate.drContributionSum,
    ipsContributionSum: aggregate.ipsContributionSum,
    importanceMass: aggregate.importanceMass,
    dr: aggregate.drContributionSum / aggregate.slotCount,
    ips: aggregate.ipsContributionSum / aggregate.slotCount,
  })).sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
}

function aggregateKey(atom: ScoreSurfaceSlotAtomV1, level: AggregateLevel): string {
  if (level === 'decision') {
    return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.decisionId}`;
  }
  if (level === 'viewer_time_cell') {
    return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.viewerClusterId}\0${atom.timeClusterId}`;
  }
  if (level === 'viewer') {
    return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.viewerClusterId}`;
  }
  if (level === 'time') {
    return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.timeClusterId}`;
  }
  return `${atom.scenarioId}\0${atom.replicationIndex}\0__overall__`;
}

function expectClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    1e-10 * Math.max(1, Math.abs(actual), Math.abs(expected)),
  );
}

describe('Phase 20 frozen multiway DGP', () => {
  it('brands a recursively frozen protocol and rejects clones or digest tampering', () => {
    const value = protocol();
    expect(isVerifiedFrozenMultiwayDgpProtocolV2(value)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.scenarios[0])).toBe(true);
    expect(isVerifiedFrozenMultiwayDgpProtocolV2(structuredClone(value))).toBe(false);

    const tampered = { ...value, protocolSha256: '0'.repeat(64) };
    expect(isVerifiedFrozenMultiwayDgpProtocolV2(tampered)).toBe(false);

    const hostile = new Proxy({}, {
      get: () => { throw new Error('hostile getter'); },
      ownKeys: () => { throw new Error('hostile keys'); },
    });
    expect(() => isVerifiedFrozenMultiwayDgpProtocolV2(hostile)).not.toThrow();
    expect(isVerifiedFrozenMultiwayDgpProtocolV2(hostile)).toBe(false);
    expect(preflightFrozenMultiwayDgpV2(hostile)).toEqual({
      status: 'not_evaluable',
      blocker: 'multiway_dgp_protocol_invalid',
    });
  });

  it('does not read unbranded protocol scenarios or resources during preflight', () => {
    const reads = { scenarios: 0, resources: 0, ownKeys: 0 };
    const unbranded = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'scenarios') reads.scenarios += 1;
        if (key === 'resources') reads.resources += 1;
        throw new Error('unbranded protocol getter');
      },
      ownKeys: () => {
        reads.ownKeys += 1;
        return ['scenarios', 'resources'];
      },
    });

    expect(preflightFrozenMultiwayDgpV2(unbranded)).toEqual({
      status: 'not_evaluable',
      blocker: 'multiway_dgp_protocol_invalid',
    });
    expect(reads).toEqual({ scenarios: 0, resources: 0, ownKeys: 0 });
  });

  it('derives truth by exact finite target-trajectory enumeration', () => {
    const scenarios = scenarioInventoryV2();
    for (const scenario of scenarios) {
      expect(scenario.knownTruth).toBe(deriveKnownTruthV2(scenario));
      expect(Number.isFinite(scenario.knownTruth)).toBe(true);
    }
    expect(scenarios.map((scenario) => scenario.scenarioId)).toHaveLength(10);
    expect(scenarios.find(
      (scenario) => scenario.scenarioId === 'near_zero_propensity_heavy_prefix',
    )?.stressEvidenceScope).toBe('analytical_support_envelope_only');
    expect(scenarios.filter(
      (scenario) => scenario.scenarioId !== 'near_zero_propensity_heavy_prefix',
    ).every((scenario) => scenario.stressEvidenceScope === 'generated_distribution')).toBe(true);
  });

  it('uses deterministic, domain-separated uniforms', () => {
    const seed = 'a'.repeat(64);
    const indices = ['g_axis', 0, 1];
    expect(new Set(Object.values(MULTIWAY_DGP_DRAW_DOMAINS_V2)).size).toBe(6);
    const viewer = syntheticUniform53V2(MULTIWAY_DGP_DRAW_DOMAINS_V2.viewerShock, seed, indices);
    const time = syntheticUniform53V2(MULTIWAY_DGP_DRAW_DOMAINS_V2.timeShock, seed, indices);
    expect(viewer).toBe(syntheticUniform53V2(
      MULTIWAY_DGP_DRAW_DOMAINS_V2.viewerShock,
      seed,
      indices,
    ));
    expect(viewer).not.toBe(time);
    expect(viewer).toBeGreaterThanOrEqual(0);
    expect(viewer).toBeLessThan(1);
  });

  it('performs the four action comparisons bound by the resource plan', () => {
    const selectWithReads = (uniform: number) => {
      let reads = 0;
      const probabilities = new Proxy([0.1, 0.2, 0.3, 0.4] as const, {
        get: (target, property, receiver) => {
          if (typeof property === 'string' && /^[0-3]$/.test(property)) reads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      return { action: selectActionV2(probabilities, uniform), reads };
    };

    expect([
      selectWithReads(0.05),
      selectWithReads(0.15),
      selectWithReads(0.45),
      selectWithReads(0.95),
    ]).toEqual([
      { action: 0, reads: 4 },
      { action: 1, reads: 4 },
      { action: 2, reads: 4 },
      { action: 3, reads: 4 },
    ]);
  });

  it('completes preflight before any generator hook is reachable', () => {
    const calls = {
      beforeGenerateReplication: 0,
      afterGenerateReplication: 0,
      beforeRandomDraw: 0,
      beforeQHatEvaluation: 0,
      beforeScoreEvaluation: 0,
      beforeAggregation: 0,
    };
    setMultiwayDgpTestHooksV2({
      beforeGenerateReplication: () => { calls.beforeGenerateReplication += 1; },
      afterGenerateReplication: () => { calls.afterGenerateReplication += 1; },
      beforeRandomDraw: () => { calls.beforeRandomDraw += 1; },
      beforeQHatEvaluation: () => { calls.beforeQHatEvaluation += 1; },
      beforeScoreEvaluation: () => { calls.beforeScoreEvaluation += 1; },
      beforeAggregation: () => { calls.beforeAggregation += 1; },
    });
    try {
      const ready = preflightFrozenMultiwayDgpV2(protocol());
      expect(ready.status).toBe('ready');
      expect(calls).toEqual({
        beforeGenerateReplication: 0,
        afterGenerateReplication: 0,
        beforeRandomDraw: 0,
        beforeQHatEvaluation: 0,
        beforeScoreEvaluation: 0,
        beforeAggregation: 0,
      });
    } finally {
      setMultiwayDgpTestHooksV2();
    }

    const generationHooks = {
      beforeGenerateReplication: vi.fn(),
      afterGenerateReplication: vi.fn(),
      beforeEvaluateSequentialDr: vi.fn(),
      afterEvaluateSequentialDr: vi.fn(),
      beforeRandomDraw: vi.fn(),
      beforeQHatEvaluation: vi.fn(),
      beforeScoreEvaluation: vi.fn(),
      beforeAggregation: vi.fn(),
    };
    const rejected = buildVerifiedMultiwayScoreSurfaceV1({
      protocol: structuredClone(protocol()),
      generationHooks,
    });
    expect(rejected).toMatchObject({
      status: 'not_evaluable',
      blocker: 'multiway_score_surface_source_unverified',
      diagnostics: { preflightCompleted: false },
    });
    for (const hook of Object.values(generationHooks)) expect(hook).not.toHaveBeenCalled();
  });

  it('generates verified atoms with finite DR/IPS contributions and stable replay', () => {
    const owner = protocol();
    const scenario = owner.scenarios.find((entry) => entry.scenarioId === 'balanced_positive')!;
    const first = generateFrozenMultiwayDgpReplicationV2(owner, scenario, 0);
    const second = generateFrozenMultiwayDgpReplicationV2(owner, scenario, 0);
    expect(first.status).toBe('generated');
    expect(second).toEqual(first);
    if (first.status !== 'generated') return;
    expect(isVerifiedFrozenMultiwayDgpReplicationV2(first.replication)).toBe(true);
    expect(isVerifiedFrozenMultiwayDgpReplicationV2(
      structuredClone(first.replication),
    )).toBe(false);
    const slots = first.replication.records.filter((record) => record.recordKind === 'slot');
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(Number.isFinite(slot.atom.drContribution)).toBe(true);
      expect(Number.isFinite(slot.atom.ipsContribution)).toBe(true);
      expect(slot.atom.weight).toBeGreaterThan(0);
    }
  });

  it('isolates per-call hooks from the ambient module hooks', () => {
    const owner = protocol();
    const scenario = owner.scenarios.find((entry) => entry.scenarioId === 'balanced_positive')!;
    const ambientBeforeGenerate = vi.fn();
    const ambientBeforeRandom = vi.fn();
    const callBeforeGenerate = vi.fn();
    const callBeforeRandom = vi.fn();
    setMultiwayDgpTestHooksV2({
      beforeGenerateReplication: ambientBeforeGenerate,
      beforeRandomDraw: ambientBeforeRandom,
    });
    try {
      const generated = generateFrozenMultiwayDgpReplicationV2(owner, scenario, 0, {
        beforeGenerateReplication: callBeforeGenerate,
        beforeRandomDraw: callBeforeRandom,
      });
      expect(generated.status).toBe('generated');
      expect(callBeforeGenerate).toHaveBeenCalledWith(scenario.scenarioId, 0);
      expect(callBeforeRandom).toHaveBeenCalled();
      expect([...new Set(callBeforeRandom.mock.calls.map(([domain]) => domain))].sort())
        .toEqual(Object.values(MULTIWAY_DGP_DRAW_DOMAINS_V2).sort());
      expect(ambientBeforeGenerate).not.toHaveBeenCalled();
      expect(ambientBeforeRandom).not.toHaveBeenCalled();

      const ambientGenerated = generateFrozenMultiwayDgpReplicationV2(owner, scenario, 0);
      expect(ambientGenerated.status).toBe('generated');
      expect(ambientBeforeGenerate).toHaveBeenCalledWith(scenario.scenarioId, 0);
      expect(ambientBeforeRandom).toHaveBeenCalled();
    } finally {
      setMultiwayDgpTestHooksV2();
    }
  });

  it('binds the revised resource plan to 40 replications and 1,504 atoms', () => {
    const resources = protocol().resources;
    const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
    const decisionCount = sum(resources.scenarioDecisionCounts);
    const slotCount = sum(resources.scenarioSlotCounts);
    const cellCount = sum(resources.scenarioCellCounts);
    const viewerCount = sum(resources.scenarioViewerCounts);
    const timeCount = sum(resources.scenarioTimeCounts);

    expect(resources.totalReplications).toBe(40);
    expect(slotCount).toBe(1_504);
    expect(resources.plannedRecordCount).toBe(
      2 * resources.totalReplications + slotCount + decisionCount
        + cellCount + viewerCount + timeCount,
    );
    expect(resources.plannedBytesUpperBound).toBe(
      resources.plannedRecordCount * resources.maximumCanonicalRecordBytes,
    );
    expect(resources.actionDrawWorkUnits).toBe(slotCount);
    expect(resources.actionSelectionComparisonWorkUnits).toBe(4 * slotCount);
    expect(resources.rewardDrawWorkUnits).toBe(slotCount);
    expect(resources.qHatEvaluationWorkUnits).toBe(4 * slotCount);
    expect(resources.scoreWorkUnits).toBe(slotCount);
    expect(resources.hashWorkUnits).toBe(
      10 * resources.totalReplications + viewerCount + timeCount + cellCount + 5 * decisionCount,
    );
    expect(resources.aggregationWorkUnits).toBe(
      5 * slotCount + decisionCount + cellCount + viewerCount + timeCount
        + resources.totalReplications,
    );
    expect(resources.generatorPrimitiveWorkUnits).toBe(
      resources.hashWorkUnits + resources.actionDrawWorkUnits
        + resources.actionSelectionComparisonWorkUnits + resources.rewardDrawWorkUnits
        + resources.qHatEvaluationWorkUnits + resources.scoreWorkUnits
        + resources.aggregationWorkUnits,
    );
  });

  it('preflights score-surface budgets before replay and binds actual work', () => {
    const surface = scoreSurface();
    expect(surface.resourceDiagnostics).toMatchObject({
      scenarios: 10,
      totalReplications: 40,
      slotAtoms: 1_504,
      decisions: 752,
      cells: 320,
      viewers: 120,
      times: 112,
      plannedRecordCount: 2_888,
      hashWorkUnits: 6_700,
      plannedScoreWorkUnits: 3_009,
      actualScoreWorkUnits: 3_009,
      plannedAggregationWorkUnits: 17_728,
      actualAggregationWorkUnits: 17_728,
    });
    expect(surface.resourceDiagnostics.canonicalInputBytesUpperBound)
      .toBeLessThanOrEqual(33_554_432);
    expect(surface.resourceDiagnostics.canonicalInputBytes)
      .toBeLessThanOrEqual(surface.resourceDiagnostics.canonicalInputBytesUpperBound);
  });

  it('rejects a DGP preflight resource limit before generation or score hooks', () => {
    const preflight = vi.spyOn(dgpGenerator, 'preflightFrozenMultiwayDgpV2')
      .mockReturnValueOnce({ status: 'not_evaluable', blocker: 'resource_limit_exceeded' });
    const generate = vi.spyOn(dgpGenerator, 'generateFrozenMultiwayDgpReplicationV2');
    const generationHooks = {
      beforeGenerateReplication: vi.fn(),
      afterGenerateReplication: vi.fn(),
      beforeEvaluateSequentialDr: vi.fn(),
      afterEvaluateSequentialDr: vi.fn(),
      beforeRandomDraw: vi.fn(),
      beforeQHatEvaluation: vi.fn(),
      beforeScoreEvaluation: vi.fn(),
      beforeAggregation: vi.fn(),
    };

    try {
      expect(buildVerifiedMultiwayScoreSurfaceV1({
        protocol: protocol(),
        generationHooks,
      })).toEqual({
        status: 'not_evaluable',
        blocker: 'multiway_score_surface_resource_limit_exceeded',
        diagnostics: {
          preflightCompleted: true,
          hookCounts: {
            beforeGenerateReplication: 0,
            afterGenerateReplication: 0,
            beforeEvaluateSequentialDr: 0,
            afterEvaluateSequentialDr: 0,
            beforeRandomDraw: 0,
            beforeQHatEvaluation: 0,
            beforeScoreEvaluation: 0,
            beforeAggregation: 0,
          },
        },
      });
      expect(preflight).toHaveBeenCalledOnce();
      expect(generate).not.toHaveBeenCalled();
      for (const hook of Object.values(generationHooks)) expect(hook).not.toHaveBeenCalled();
    } finally {
      preflight.mockRestore();
      generate.mockRestore();
    }
  });

  it('builds a verified diagnostic-only surface for the common-time-shock scenario', () => {
    const owner = protocol();
    const commonTime = owner.scenarios.find((entry) => entry.scenarioId === 'common_time_shock')!;
    const beforeRandomDraw = vi.fn();
    const generated = generateFrozenMultiwayDgpReplicationV2(owner, commonTime, 0, {
      beforeRandomDraw,
    });
    expect(generated.status).toBe('generated');
    if (generated.status !== 'generated') return;
    expect(commonTime.commonTimeShock).toBe(true);
    expect(commonTime.g).toBeGreaterThan(1);
    expect(beforeRandomDraw.mock.calls.filter(([domain]) => (
      domain === MULTIWAY_DGP_DRAW_DOMAINS_V2.timeShock
    ))).toHaveLength(commonTime.h);
    expect(generated.replication.shockProvenance.time.length).toBe(commonTime.h);

    const result = buildVerifiedMultiwayScoreSurfaceV1({ protocol: owner });
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') return;
    expect(isVerifiedMultiwayScoreSurfaceV1(result.surface)).toBe(true);
    expect(result.surface.replications).toHaveLength(40);
    expect(result.surface.atoms).toHaveLength(1_504);
    expect(result.surface.blockers).toContain('common_time_shock_inference_unavailable');
    expect(result.surface.resourceDiagnostics).toMatchObject({
      preflightCompletedBeforeReplay: true,
      scenarios: 10,
      replicationsPerScenario: 4,
      replications: 40,
      slotAtoms: 1_504,
    });
    expect(result.surface.viewerOnlyDiagnosticBaseline).toMatchObject({
      status: 'abstained',
      blocker: 'common_time_shock_inference_unavailable',
      commonTimeShockHandlingVerified: false,
      confidenceInterval: null,
      variance: null,
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
    });
    expect(result.surface).toMatchObject({
      selectedMethod: 'diagnostics_only_abstention_v1',
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });
    expect(isVerifiedMultiwayScoreSurfaceV1(structuredClone(result.surface))).toBe(false);

    const hostile = new Proxy({}, {
      get: () => { throw new Error('hostile surface getter'); },
      ownKeys: () => { throw new Error('hostile surface keys'); },
    });
    expect(() => buildVerifiedMultiwayScoreSurfaceV1(hostile)).not.toThrow();
    expect(buildVerifiedMultiwayScoreSurfaceV1(hostile)).toMatchObject({
      status: 'not_evaluable',
      blocker: 'multiway_score_surface_source_unverified',
      diagnostics: { preflightCompleted: false },
    });
  });

  it('recomputes every atom and decision/cell/viewer/time/overall aggregate', () => {
    const surface = scoreSurface();
    expect(surface.atoms).toHaveLength(1_504);
    for (const atom of surface.atoms) {
      const logWeight = atom.prefixLogWeight + Math.log(atom.targetProbability)
        - Math.log(atom.behaviorProbability);
      const prefixWeight = Math.exp(atom.prefixLogWeight);
      const weight = Math.exp(logWeight);
      const targetTerm = prefixWeight * atom.targetQValues.reduce((sum, entry) => (
        sum + entry.probability * entry.qValue
      ), 0);
      const ipsContribution = weight * atom.reward;
      const drContribution = targetTerm + weight * (atom.reward - atom.loggedQ);
      expectClose(atom.logWeight, logWeight);
      expectClose(atom.prefixWeight, prefixWeight);
      expectClose(atom.weight, weight);
      expectClose(atom.ipsContribution, ipsContribution);
      expectClose(atom.drContribution, drContribution);
    }

    expect(surface.decisionAggregates).toEqual(recomputeAggregates(surface.atoms, 'decision'));
    expect(surface.viewerTimeCells).toEqual(recomputeAggregates(surface.atoms, 'viewer_time_cell'));
    expect(surface.viewerAggregates).toEqual(recomputeAggregates(surface.atoms, 'viewer'));
    expect(surface.timeAggregates).toEqual(recomputeAggregates(surface.atoms, 'time'));
    expect(surface.overallAggregates).toEqual(recomputeAggregates(surface.atoms, 'overall'));
  });

  it('brands a bound Phase 20 handoff and rejects cross-protocol surfaces', () => {
    const owner = protocol();
    const surface = scoreSurface(owner);
    const source = phase19Handoff();
    const result = buildPhase20SameProcessNoCandidateHandoffV1({
      phase19Handoff: source,
      dgpProtocol: owner,
      scoreSurface: surface,
    });
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') return;
    expect(result.handoff).toEqual({
      contractVersion: 'phase20_same_process_offline_diagnostic_handoff_v1',
      handoffScope: 'same_process_offline_diagnostic_v1',
      developmentStatus: 'completed_frozen_multiway_dgp_v2_no_candidate_selected',
      dgpV2Status: 'verified_synthetic_development_only',
      multiwayScoreSurfaceStatus: 'verified_synthetic_only',
      commonTimeShockScenarioPresent: true,
      commonTimeShockHandlingVerified: false,
      multiwayQHatQualityStatus: 'not_assessed_prediction_v4_mechanical_fixture_only',
      researchCandidateMethod: null,
      phase19HandoffSha256: source.handoffSha256,
      dgpProtocolSha256: owner.protocolSha256,
      scoreSurfaceSha256: surface.surfaceSha256,
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      selectedMethod: 'diagnostics_only_abstention_v1',
      qualificationEvidenceEligible: false,
      candidateEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
      sealedQualificationStatus: 'not_ready',
      nextPhaseHandoff: 'ready_to_research_candidate_on_frozen_dgp_v2',
      blockers: PHASE20_HANDOFF_BLOCKERS_V1,
      handoffSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(isVerifiedPhase20SameProcessNoCandidateHandoffV1(result.handoff)).toBe(true);
    expect(isVerifiedPhase20SameProcessNoCandidateHandoffV1(
      structuredClone(result.handoff),
    )).toBe(false);

    const otherOwner = protocol({ protocolId: 'phase20-other-frozen-multiway-v2' });
    const otherSurface = scoreSurface(otherOwner);
    expect(buildPhase20SameProcessNoCandidateHandoffV1({
      phase19Handoff: source,
      dgpProtocol: owner,
      scoreSurface: otherSurface,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase20_handoff_binding_mismatch',
    });

    const hostile = new Proxy({}, {
      get: () => { throw new Error('hostile handoff getter'); },
    });
    expect(buildPhase20SameProcessNoCandidateHandoffV1(hostile)).toEqual({
      status: 'not_evaluable',
      blocker: 'phase20_handoff_source_unverified',
    });
  });
});
