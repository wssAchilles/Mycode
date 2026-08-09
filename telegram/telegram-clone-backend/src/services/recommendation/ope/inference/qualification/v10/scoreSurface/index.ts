import {
  evaluateSequentialDrSlotV1,
  type SequentialDrSlotResultV1,
} from '../../../../core/sequentialDr';
import { summarizeClusterScoresV1 } from '../../../clusterScores';
import type { ClusterScoreSummaryV1, ClusterScoreV1 } from '../../../contracts';
import {
  behaviorProbabilityV2,
  probabilityVectorV2,
  rotateProbabilityV2,
  targetProbabilityV2,
} from '../dgp/math';
import * as dgpGenerator from '../dgp/generator';
import * as dgpProtocol from '../dgp/protocol';
import type {
  FrozenMultiwayDgpProtocolV2,
  FrozenMultiwayDgpScenarioV2,
  MultiwayDgpMembershipV2,
  MultiwayDgpRecordV2,
  MultiwayDgpReplicationResultV2,
  MultiwayDgpSlotRecordV2,
  VerifiedFrozenMultiwayDgpReplicationV2,
  VerifiedFrozenMultiwayDgpProtocolV2,
} from '../dgp/contracts';
import {
  compareScoreSurfaceText,
  copyArray,
  finite,
  freezeScoreSurface,
  isRecord,
  isScoreSurfaceFrozen,
  nonEmptyString,
  safeGet,
  scoreSurfaceCanonicalBytes,
  scoreSurfaceCanonicalJson,
  scoreSurfaceDigest,
} from './privateCore';
import {
  MULTIWAY_SCORE_SURFACE_BLOCKERS_V1,
  MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1,
  VERIFIED_SYNTHETIC_MULTIWAY_SCORE_SURFACE_V1,
  type MultiwayScoreSurfaceBlockerV1,
  type MultiwayScoreSurfaceBuildResultV1,
  type MultiwayScoreSurfaceGenerationHooksV1,
  type ScoreSurfaceAggregateV1,
  type ScoreSurfaceHookCountsV1,
  type ScoreSurfaceReplicationV1,
  type ScoreSurfaceResourceDiagnosticsV1,
  type ScoreSurfaceSlotAtomV1,
  type VerifiedMultiwayScoreSurfaceV1,
  type ViewerOnlyDiagnosticBaselineV1,
} from './contracts';

export * from './contracts';

const verifiedSurface = Symbol('verifiedSyntheticMultiwayScoreSurfaceV1');
const verifiedSurfaces = new WeakSet<object>();
const verifiedSurfaceDigests = new WeakMap<object, string>();
const verifiedSurfaceOwners = new WeakMap<object, Readonly<{
  protocol: VerifiedFrozenMultiwayDgpProtocolV2;
}>>();

type BrandedSurface = VerifiedMultiwayScoreSurfaceV1 & {
  readonly [verifiedSurface]: true;
};

type SurfaceInput = Readonly<{
  protocol?: unknown;
  hooks?: unknown;
  generationHooks?: unknown;
}>;

type DgpModule = Record<string, unknown>;
type MutableHookCountsV1 = { -readonly [K in keyof ScoreSurfaceHookCountsV1]: number };

const DGP_GENERATOR_API = dgpGenerator as unknown as DgpModule;

const EMPTY_HOOK_COUNTS = Object.freeze({
  beforeGenerateReplication: 0,
  afterGenerateReplication: 0,
  beforeEvaluateSequentialDr: 0,
  afterEvaluateSequentialDr: 0,
  beforeRandomDraw: 0,
  beforeQHatEvaluation: 0,
  beforeScoreEvaluation: 0,
  beforeAggregation: 0,
} satisfies ScoreSurfaceHookCountsV1);

/**
 * Builds only from a private-brand DGP protocol.  The generator API is statically
 * imported so the surface remains usable in CommonJS and Vitest/ESM runtimes.
 */
export function buildVerifiedMultiwayScoreSurfaceV1(
  raw: unknown,
): MultiwayScoreSurfaceBuildResultV1 {
  const hookCounts: MutableHookCountsV1 = { ...EMPTY_HOOK_COUNTS };
  try {
    const protocol = extractProtocol(raw);
    if (!isVerifiedFrozenMultiwayDgpProtocolV2(protocol)) {
      return reject('multiway_score_surface_source_unverified', false, hookCounts);
    }

    // This is deliberately the first potentially expensive operation.  No generator,
    // RNG hook, or sequential DR call is reachable before it returns ready.
    const preflight = runGlobalPreflight(protocol);
    if (!preflight.ready) {
      return reject(preflight.blocker, true, hookCounts);
    }

    const scenarios = copyScenarios(protocol);
    if (!scenarios) return reject('multiway_score_surface_source_unverified', true, hookCounts);
    const hooks = extractHooks(raw);
    const wrappedHooks = wrapHooks(hooks, hookCounts);
    const generator = DGP_GENERATOR_API;
    const generate = pickFunction(generator, [
      'generateFrozenMultiwayDgpReplicationV2',
      'generateVerifiedMultiwayDgpV2ReplicationV1',
      'generateFrozenMultiwayDgpV2ReplicationV1',
    ]);
    const verifyReplication = pickFunction(generator, [
      'isVerifiedFrozenMultiwayDgpReplicationV2',
      'isVerifiedMultiwayDgpV2ReplicationV1',
      'isVerifiedMultiwayDgpReplicationV2',
    ]);
    if (!generate || !verifyReplication) {
      return reject('multiway_score_surface_source_unverified', true, hookCounts);
    }
    const replications: ScoreSurfaceReplicationV1[] = [];
    const allAtoms: ScoreSurfaceSlotAtomV1[] = [];
    let expectedReplications = 0;
    let actualRecordCount = 0;
    let actualScoreWorkUnits = 0;
    let actualAggregationWorkUnits = 0;
    for (const scenario of scenarios) {
        const replicationCount = protocol.replicationsPerScenario;
        expectedReplications += replicationCount;
        for (let replicationIndex = 0; replicationIndex < replicationCount; replicationIndex += 1) {
          const generated = callGenerator(generate, protocol, scenario, replicationIndex, wrappedHooks);
          if (!generated) return reject('multiway_score_surface_dgp_generation_failed', true, hookCounts);
          const replication = unwrapGeneratedReplication(generated);
          if (!replication || !safeVerifyReplication(verifyReplication, replication)) {
            return reject('multiway_score_surface_source_unverified', true, hookCounts);
          }
          const counts = safeGet(replication, 'counts');
          const scoreWorkUnits = safeGet(counts, 'scoreWorkUnits');
          const aggregationWorkUnits = safeGet(counts, 'aggregationWorkUnits');
          if (!finite(scoreWorkUnits) || !finite(aggregationWorkUnits)
            || scoreWorkUnits < 0 || aggregationWorkUnits < 0) {
            return reject('multiway_score_surface_aggregate_invalid', true, hookCounts);
          }
          actualScoreWorkUnits += scoreWorkUnits;
          actualAggregationWorkUnits += aggregationWorkUnits;
          const records = safeGet(replication, 'records');
          if (!Array.isArray(records)) {
            return reject('multiway_score_surface_aggregate_invalid', true, hookCounts);
          }
          actualRecordCount += records.length;
          const replayed = replayReplication(replication, protocol, wrappedHooks);
          if ('blocker' in replayed) return reject(replayed.blocker, true, hookCounts);
          replications.push(replayed.replication);
          allAtoms.push(...replayed.replication.slotAtoms);
        }
    }
    if (replications.length !== expectedReplications
      || replications.length !== preflight.plan.totalReplications
      || allAtoms.length !== preflight.plan.slotAtoms
      || actualRecordCount !== preflight.plan.plannedRecordCount
      || allAtoms.length === 0) {
      return reject('multiway_score_surface_aggregate_invalid', true, hookCounts);
    }
    const membership = buildMembership(allAtoms);
    if ('blocker' in membership) return reject(membership.blocker, true, hookCounts);
    const decisions = aggregateAtoms(allAtoms, 'decision');
    const cells = aggregateAtoms(allAtoms, 'viewer_time_cell');
    const viewers = aggregateAtoms(allAtoms, 'viewer');
    const times = aggregateAtoms(allAtoms, 'time');
    const overalls = aggregateAtoms(allAtoms, 'overall');
    if (membership.rows.length !== preflight.plan.decisions
      || cells.length !== preflight.plan.cells
      || membership.viewerIds.length !== preflight.plan.viewers
      || membership.timeIds.length !== preflight.plan.times) {
      return reject('multiway_score_surface_aggregate_invalid', true, hookCounts);
    }
    const commonTimeShock = scenarios.some((scenario) => scenario.commonTimeShock);

    // Exactly one viewer-only call.  Its output is intentionally diagnostic only;
    // no multiway confidence interval or candidate evidence is minted here.
    const baseline = buildViewerOnlyBaseline(allAtoms, commonTimeShock);
    const surfaceScoreWorkUnits = actualScoreWorkUnits + allAtoms.length + 1;
    const surfaceAggregationWorkUnits = actualAggregationWorkUnits * 2;
    if (surfaceScoreWorkUnits !== preflight.plan.scoreWorkUnits
      || surfaceAggregationWorkUnits !== preflight.plan.aggregationWorkUnits) {
      return reject('multiway_score_surface_aggregate_invalid', true, hookCounts);
    }
    const blockers: string[] = [];
    if (commonTimeShock) blockers.push('common_time_shock_inference_unavailable');

    const resourceDiagnostics = buildResourceDiagnostics(
      protocol,
      scenarios,
      replications,
      allAtoms,
      cells,
      membership.viewerIds,
      membership.timeIds,
      hookCounts,
      preflight.plan,
      surfaceScoreWorkUnits,
      surfaceAggregationWorkUnits,
    );
    if (resourceDiagnostics.workUnits > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumWorkUnits
      || resourceDiagnostics.canonicalInputBytes
        > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumCanonicalInputBytes) {
      return reject('multiway_score_surface_resource_limit_exceeded', true, hookCounts);
    }

    const scenarioIds = [...new Set(replications.map((entry) => entry.scenarioId))]
      .sort(compareScoreSurfaceText);
    const surfacePreimage = {
      contractVersion: VERIFIED_SYNTHETIC_MULTIWAY_SCORE_SURFACE_V1,
      dgpV2Status: 'verified_synthetic_development_only' as const,
      multiwayScoreSurfaceStatus: 'verified_synthetic_only' as const,
      multiwayQHatQualityStatus: 'not_assessed_prediction_v4_mechanical_fixture_only' as const,
      estimand: 'mean_reward_per_logged_slot_v1' as const,
      estimator: 'dr' as const,
      protocolSha256: protocol.protocolSha256,
      dgpProtocolSha256: protocol.protocolSha256,
      scenarioIds,
      viewerClusterIds: membership.viewerIds,
      timeClusterIds: membership.timeIds,
      viewerTimeMembership: membership.rows,
      replications,
      slotAtoms: allAtoms,
      atoms: allAtoms,
      decisionAggregates: decisions,
      decisionScores: decisions,
      viewerTimeCells: cells,
      cells,
      viewerAggregates: viewers,
      timeAggregates: times,
      overallAggregates: overalls,
      viewerOnlyDiagnosticBaseline: baseline,
      commonTimeShockHandlingVerified: false as const,
      candidateSelectionStatus: 'no_candidate_selected' as const,
      candidateQualificationStatus: 'not_run' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      nextPhaseHandoff: 'ready_to_research_candidate_on_frozen_dgp_v2' as const,
      blockers: Object.freeze(blockers),
      resourceDiagnostics,
      generationHookCounts: hookCounts,
      surfaceChainSha256: scoreSurfaceDigest(replications.map((entry) => ({
        scenarioId: entry.scenarioId,
        replicationIndex: entry.replicationIndex,
        replicationSha256: entry.replicationSha256,
        chainHeadSha256: entry.chainHeadSha256,
      }))),
    };
    const candidate = {
      ...surfacePreimage,
      surfaceSha256: scoreSurfaceDigest(surfacePreimage),
    } as unknown as BrandedSurface;
    Object.defineProperty(candidate, verifiedSurface, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    freezeScoreSurface(candidate);
    verifiedSurfaceDigests.set(candidate, candidate.surfaceSha256);
    verifiedSurfaceOwners.set(candidate, Object.freeze({ protocol }));
    verifiedSurfaces.add(candidate);
    return { status: 'verified', surface: candidate };
  } catch {
    return reject('multiway_score_surface_source_unverified', false, hookCounts);
  }
}

export function isVerifiedMultiwayScoreSurfaceV1(
  value: unknown,
): value is BrandedSurface {
  try {
    if (!value || typeof value !== 'object' || !verifiedSurfaces.has(value)) return false;
    const candidate = value as BrandedSurface;
    const owner = verifiedSurfaceOwners.get(candidate);
    if (!owner || !isVerifiedFrozenMultiwayDgpProtocolV2(owner.protocol)) return false;
    const { surfaceSha256, ...preimage } = candidate;
    return safeGet(candidate, verifiedSurface) === true
      && isScoreSurfaceFrozen(candidate)
      && surfaceSha256 === scoreSurfaceDigest(preimage)
      && verifiedSurfaceDigests.get(candidate) === surfaceSha256
      && candidate.protocolSha256 === owner.protocol.protocolSha256
      && candidate.dgpProtocolSha256 === owner.protocol.protocolSha256
      && candidate.commonTimeShockHandlingVerified === false
      && candidate.candidateEvidenceEligible === false
      && candidate.qualificationEvidenceEligible === false
      && candidate.realDatasetEligible === false
      && candidate.servable === false
      && candidate.selectedMethod === 'diagnostics_only_abstention_v1'
      && candidate.candidateSelectionStatus === 'no_candidate_selected'
      && candidate.candidateQualificationStatus === 'not_run';
  } catch {
    return false;
  }
}

export const isVerifiedSyntheticMultiwayScoreSurfaceV1 = isVerifiedMultiwayScoreSurfaceV1;

function reject(
  blocker: MultiwayScoreSurfaceBlockerV1,
  preflightCompleted: boolean,
  hookCounts: ScoreSurfaceHookCountsV1,
): MultiwayScoreSurfaceBuildResultV1 {
  return {
    status: 'not_evaluable',
    blocker,
    diagnostics: {
      preflightCompleted,
      hookCounts: Object.freeze({ ...hookCounts }),
    },
  };
}

function extractProtocol(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;
  const nested = safeGet(raw, 'protocol');
  return nested === undefined ? raw : nested;
}

function copyScenarios(
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
): readonly FrozenMultiwayDgpScenarioV2[] | undefined {
  const copied = copyArray(
    safeGet(protocol, 'scenarios'),
    MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumScenarios,
  );
  if (!copied || copied.length === 0) return undefined;
  if (copied.some((scenario) => !isRecord(scenario))) return undefined;
  return copied as readonly FrozenMultiwayDgpScenarioV2[];
}

function isVerifiedFrozenMultiwayDgpProtocolV2(
  value: unknown,
): value is VerifiedFrozenMultiwayDgpProtocolV2 {
  try {
    const verifier = dgpProtocol.isVerifiedFrozenMultiwayDgpProtocolV2 as unknown as (
      candidate: unknown,
    ) => boolean;
    return typeof verifier === 'function' && verifier(value);
  } catch {
    return false;
  }
}

function runGlobalPreflight(
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
): Readonly<{ ready: true; plan: ScoreSurfaceResourcePlan }> | Readonly<{
  ready: false;
  blocker: MultiwayScoreSurfaceBlockerV1;
}> {
  try {
    const resources = safeGet(protocol, 'resources');
    if (!isRecord(resources)) return { ready: false, blocker: 'multiway_score_surface_resource_limit_exceeded' };
    const preflight = pickFunction(DGP_GENERATOR_API, [
      'preflightFrozenMultiwayDgpV2',
      'preflightFrozenMultiwayDgpV2V1',
      'preflightMultiwayDgpV2',
    ]);
    if (!preflight) return { ready: false, blocker: 'multiway_score_surface_source_unverified' };
    const result = preflight(protocol) as Record<string, unknown> | undefined;
    if (!result || safeGet(result, 'status') !== 'ready') {
      return { ready: false, blocker: 'multiway_score_surface_resource_limit_exceeded' };
    }
    if (safeGet(result, 'protocolSha256') !== protocol.protocolSha256) {
      return { ready: false, blocker: 'multiway_score_surface_chain_mismatch' };
    }
    const planned = safeGet(result, 'resources');
    if (planned !== undefined && scoreSurfaceCanonicalJson(planned)
      !== scoreSurfaceCanonicalJson(resources)) {
      return { ready: false, blocker: 'multiway_score_surface_chain_mismatch' };
    }
    const numericKeys = [
      'scenarioCount',
      'replicationsPerScenario',
      'totalReplications',
      'plannedRecordCount',
      'plannedBytesUpperBound',
      'maximumQualificationRecords',
      'maximumCanonicalRecordBytes',
      'generatorPrimitiveWorkUnits',
      'hashWorkUnits',
      'actionDrawWorkUnits',
      'actionSelectionComparisonWorkUnits',
      'rewardDrawWorkUnits',
      'qHatEvaluationWorkUnits',
      'scoreWorkUnits',
      'aggregationWorkUnits',
    ];
    if (numericKeys.some((key) => !finite(safeGet(resources, key)) || Number(safeGet(resources, key)) < 0)) {
      return { ready: false, blocker: 'multiway_score_surface_resource_limit_exceeded' };
    }
    const scenarioRecordCounts = copyFinitePlanArray(safeGet(resources, 'scenarioRecordCounts'));
    const scenarioDecisionCounts = copyFinitePlanArray(safeGet(resources, 'scenarioDecisionCounts'));
    const scenarioSlotCounts = copyFinitePlanArray(safeGet(resources, 'scenarioSlotCounts'));
    const scenarioCellCounts = copyFinitePlanArray(safeGet(resources, 'scenarioCellCounts'));
    const scenarioViewerCounts = copyFinitePlanArray(safeGet(resources, 'scenarioViewerCounts'));
    const scenarioTimeCounts = copyFinitePlanArray(safeGet(resources, 'scenarioTimeCounts'));
    const scenarioCount = Number(safeGet(resources, 'scenarioCount'));
    const replicationsPerScenario = Number(safeGet(resources, 'replicationsPerScenario'));
    const arrays = [
      scenarioRecordCounts,
      scenarioDecisionCounts,
      scenarioSlotCounts,
      scenarioCellCounts,
      scenarioViewerCounts,
      scenarioTimeCounts,
    ];
    if (arrays.some((values) => values === undefined)
      || arrays.some((values) => values!.length !== scenarioCount)) {
      return { ready: false, blocker: 'multiway_score_surface_resource_limit_exceeded' };
    }
    const dgpScoreWorkUnits = Number(safeGet(resources, 'scoreWorkUnits'));
    const dgpAggregationWorkUnits = Number(safeGet(resources, 'aggregationWorkUnits'));
    // Includes the two protocol checks at entry/preflight, per-replication
    // verification/replay chain work, atom chains, and the two surface roots.
    const hashWorkUnits = Number(safeGet(resources, 'hashWorkUnits'))
      + 12 * scenarioCount * replicationsPerScenario
      + sumPlan(scenarioSlotCounts!)
      + 4;
    const plannedRecordCount = Number(safeGet(resources, 'plannedRecordCount'));
    const maximumCanonicalRecordBytes = Number(safeGet(resources, 'maximumCanonicalRecordBytes'));
    const canonicalInputBytesUpperBound = Number(safeGet(resources, 'plannedBytesUpperBound'))
      + sumPlan(scenarioSlotCounts!) * maximumCanonicalRecordBytes
      + 2 * maximumCanonicalRecordBytes;
    const plan = {
      scenarioCount,
      replicationsPerScenario,
      totalReplications: scenarioCount * replicationsPerScenario,
      decisions: sumPlan(scenarioDecisionCounts!),
      slotAtoms: sumPlan(scenarioSlotCounts!),
      cells: sumPlan(scenarioCellCounts!),
      viewers: sumPlan(scenarioViewerCounts!),
      times: sumPlan(scenarioTimeCounts!),
      plannedRecordCount,
      plannedBytesUpperBound: Number(safeGet(resources, 'plannedBytesUpperBound')),
      canonicalInputBytesUpperBound,
      hashWorkUnits,
      scoreWorkUnits: 2 * dgpScoreWorkUnits + 1,
      aggregationWorkUnits: 2 * dgpAggregationWorkUnits,
      dgpScoreWorkUnits,
      dgpAggregationWorkUnits,
    } satisfies ScoreSurfaceResourcePlan;
    if (plan.totalReplications !== Number(safeGet(resources, 'totalReplications'))
      || plan.plannedRecordCount !== sumPlan(scenarioRecordCounts!)
      || plan.slotAtoms > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumSlotAtoms
      || plan.plannedRecordCount > Number(safeGet(resources, 'maximumQualificationRecords'))
      || plan.canonicalInputBytesUpperBound
        > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumCanonicalInputBytes
      || plan.scenarioCount > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumScenarios
      || plan.replicationsPerScenario
        > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumReplicationsPerScenario) {
      return { ready: false, blocker: 'multiway_score_surface_resource_limit_exceeded' };
    }
    const workKeys = [
      'hashWorkUnits',
      'actionDrawWorkUnits',
      'actionSelectionComparisonWorkUnits',
      'rewardDrawWorkUnits',
      'qHatEvaluationWorkUnits',
      'scoreWorkUnits',
      'aggregationWorkUnits',
      'generatorPrimitiveWorkUnits',
    ] as const;
    if (workKeys.some((key) => Number(safeGet(resources, key))
      > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumWorkUnits)
      || plan.hashWorkUnits > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumWorkUnits
      || plan.scoreWorkUnits > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumWorkUnits
      || plan.aggregationWorkUnits > MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumWorkUnits) {
      return { ready: false, blocker: 'multiway_score_surface_resource_limit_exceeded' };
    }
    return { ready: true, plan };
  } catch {
    return { ready: false, blocker: 'multiway_score_surface_source_unverified' };
  }
}

type ScoreSurfaceResourcePlan = Readonly<{
  scenarioCount: number;
  replicationsPerScenario: number;
  totalReplications: number;
  decisions: number;
  slotAtoms: number;
  cells: number;
  viewers: number;
  times: number;
  plannedRecordCount: number;
  plannedBytesUpperBound: number;
  canonicalInputBytesUpperBound: number;
  hashWorkUnits: number;
  scoreWorkUnits: number;
  aggregationWorkUnits: number;
  dgpScoreWorkUnits: number;
  dgpAggregationWorkUnits: number;
}>;

function copyFinitePlanArray(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => !finite(entry) || entry < 0)) return undefined;
  return value.map(Number);
}

function sumPlan(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function pickFunction(module: DgpModule, names: readonly string[]): ((...args: any[]) => any) | undefined {
  for (const name of names) {
    const candidate = module[name];
    if (typeof candidate === 'function') return candidate as (...args: any[]) => any;
  }
  return undefined;
}

function extractHooks(raw: unknown): MultiwayScoreSurfaceGenerationHooksV1 {
  if (!isRecord(raw)) return {};
  const source = safeGet(raw, 'generationHooks') ?? safeGet(raw, 'hooks');
  if (!isRecord(source)) return {};
  const hooks: Record<string, unknown> = {};
  for (const key of [
    'beforeGenerateReplication',
    'afterGenerateReplication',
    'beforeEvaluateSequentialDr',
    'afterEvaluateSequentialDr',
    'beforeRandomDraw',
    'beforeQHatEvaluation',
    'beforeScoreEvaluation',
    'beforeAggregation',
  ] as const) {
    const candidate = safeGet(source, key);
    if (typeof candidate === 'function') {
      hooks[key] = candidate;
    }
  }
  return hooks as MultiwayScoreSurfaceGenerationHooksV1;
}

function wrapHooks(
  userHooks: MultiwayScoreSurfaceGenerationHooksV1,
  counts: MutableHookCountsV1,
): Record<string, (...args: any[]) => void> {
  const wrapped: Record<string, (...args: any[]) => void> = {
    beforeGenerateReplication: (scenario: unknown, replicationIndex: number) => {
      counts.beforeGenerateReplication += 1;
      userHooks.beforeGenerateReplication?.(scenario, replicationIndex);
    },
    afterGenerateReplication: (scenario: unknown, replicationIndex: number, replication: unknown) => {
      counts.afterGenerateReplication += 1;
      userHooks.afterGenerateReplication?.(scenario, replicationIndex, replication);
    },
    beforeRandomDraw: (domain: string) => {
      counts.beforeRandomDraw += 1;
      userHooks.beforeRandomDraw?.(domain);
    },
    beforeQHatEvaluation: () => {
      counts.beforeQHatEvaluation += 1;
      userHooks.beforeQHatEvaluation?.();
    },
    beforeScoreEvaluation: () => {
      counts.beforeScoreEvaluation += 1;
      userHooks.beforeScoreEvaluation?.();
    },
    beforeAggregation: () => {
      counts.beforeAggregation += 1;
      userHooks.beforeAggregation?.();
    },
    beforeEvaluateSequentialDr: (atom: unknown) => {
      counts.beforeEvaluateSequentialDr += 1;
      userHooks.beforeEvaluateSequentialDr?.(atom);
    },
    afterEvaluateSequentialDr: (atom: unknown, result: unknown) => {
      counts.afterEvaluateSequentialDr += 1;
      userHooks.afterEvaluateSequentialDr?.(atom, result);
    },
  };
  return wrapped;
}

function callGenerator(
  generate: (...args: any[]) => any,
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
  scenario: FrozenMultiwayDgpScenarioV2,
  replicationIndex: number,
  hooks: Record<string, (...args: any[]) => void>,
): unknown {
  try {
    return generate(protocol, scenario, replicationIndex, hooks);
  } catch {
    return undefined;
  }
}

function unwrapGeneratedReplication(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const status = safeGet(value, 'status');
  if (status === 'generated') return safeGet(value, 'replication');
  return status === undefined ? value : undefined;
}

function safeVerifyReplication(
  verifier: (...args: any[]) => any,
  replication: unknown,
): replication is VerifiedFrozenMultiwayDgpReplicationV2 {
  try {
    return verifier(replication) === true;
  } catch {
    return false;
  }
}

type ReplayResult = Readonly<{ replication: ScoreSurfaceReplicationV1 }>
  | Readonly<{ blocker: MultiwayScoreSurfaceBlockerV1 }>;

function replayReplication(
  raw: VerifiedFrozenMultiwayDgpReplicationV2,
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
  hooks: Record<string, (...args: any[]) => void>,
): ReplayResult {
  try {
    if (raw.protocolSha256 !== protocol.protocolSha256
      || !nonEmptyString(raw.scenarioId)
      || !Number.isSafeInteger(raw.replicationIndex)
      || raw.replicationIndex < 0
      || raw.replicationIndex >= protocol.replicationsPerScenario) {
      return { blocker: 'multiway_score_surface_chain_mismatch' };
    }
    const scenario = raw.scenario;
    if (!scenario || scenario.scenarioId !== raw.scenarioId) {
      return { blocker: 'multiway_score_surface_chain_mismatch' };
    }
    const slotRecords = copyArray(raw.slotRecords, MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumSlotAtoms);
    const records = copyArray(raw.records, MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1.maximumSlotAtoms);
    if (!slotRecords || !records || slotRecords.length === 0) {
      return { blocker: 'multiway_score_surface_source_unverified' };
    }
    if (!validateDgpRoots(raw, slotRecords)) {
      return { blocker: 'multiway_score_surface_chain_mismatch' };
    }
    const recordOrder = validateRecordOrder(raw, records, slotRecords.length);
    if (!recordOrder) return { blocker: 'multiway_score_surface_order_mismatch' };
    if (!validateRecordBodies(raw, records, slotRecords)) {
      return { blocker: 'multiway_score_surface_chain_mismatch' };
    }

    const atoms: ScoreSurfaceSlotAtomV1[] = [];
    const priorByDecision = new Map<string, Readonly<{ slotIndex: number; logWeight: number }>>();
    let previousOrder: Readonly<{ decisionIndex: number; slotIndex: number }> | undefined;
    let priorAtomSha256 = scoreSurfaceDigest({
      protocolSha256: protocol.protocolSha256,
      scenarioId: raw.scenarioId,
      replicationIndex: raw.replicationIndex,
      chain: 'empty_v2',
    });
    for (let atomIndex = 0; atomIndex < slotRecords.length; atomIndex += 1) {
      const slot = slotRecords[atomIndex] as MultiwayDgpSlotRecordV2;
      if (!validGlobalSlotOrder(slot, previousOrder)) {
        return { blocker: 'multiway_score_surface_order_mismatch' };
      }
      const built = replaySlot(slot, scenario, raw, atomIndex, priorByDecision, hooks);
      if ('blocker' in built) return built;
      const atomPreimage = {
        ...built.atom,
        priorAtomSha256,
      };
      const atomSha256 = scoreSurfaceDigest(atomPreimage);
      const atom = freezeScoreSurface({
        ...built.atom,
        priorAtomSha256,
        atomSha256,
      });
      atoms.push(atom);
      previousOrder = {
        decisionIndex: atom.membership.decisionIndex,
        slotIndex: atom.membership.slotIndex,
      };
      priorAtomSha256 = atomSha256;
    }
    if (!validateReplicationCounts(raw, atoms, records.length)) {
      return { blocker: 'multiway_score_surface_aggregate_invalid' };
    }
    const viewerTimeCells = aggregateAtoms(atoms, 'viewer_time_cell');
    const decisionAggregates = aggregateAtoms(atoms, 'decision');
    const viewerAggregates = aggregateAtoms(atoms, 'viewer');
    const timeAggregates = aggregateAtoms(atoms, 'time');
    const overallAggregates = aggregateAtoms(atoms, 'overall');
    const replicationPreimage = {
      scenarioKind: scenario.scenarioKind,
      scenarioId: raw.scenarioId,
      replicationIndex: raw.replicationIndex,
      replicationSha256: raw.replicationSha256,
      slotAtoms: atoms,
      decisionAggregates,
      decisionScores: decisionAggregates,
      viewerTimeCells,
      viewerAggregates,
      timeAggregates,
      overallAggregates,
      chainHeadSha256: priorAtomSha256,
    };
    const replication = freezeScoreSurface({
      ...replicationPreimage,
      atoms,
      cells: viewerTimeCells,
    } as unknown as ScoreSurfaceReplicationV1);
    return { replication };
  } catch {
    return { blocker: 'multiway_score_surface_source_unverified' };
  }
}

function replaySlot(
  slot: MultiwayDgpSlotRecordV2,
  scenario: FrozenMultiwayDgpScenarioV2,
  replication: VerifiedFrozenMultiwayDgpReplicationV2,
  atomIndex: number,
  priorByDecision: Map<string, Readonly<{ slotIndex: number; logWeight: number }>>,
  hooks: Record<string, (...args: any[]) => void>,
): Readonly<{ atom: Omit<ScoreSurfaceSlotAtomV1, 'priorAtomSha256' | 'atomSha256'> }>
  | Readonly<{ blocker: MultiwayScoreSurfaceBlockerV1 }> {
  try {
    const membership = slot.membership;
    if (!membership || !validMembership(membership)
      || membership.decisionId.length === 0
      || slot.recordKind !== 'slot') {
      return { blocker: 'multiway_score_surface_order_mismatch' };
    }
    const slotIndex = membership.slotIndex;
    if (slotIndex !== 0 && slotIndex !== 1) return { blocker: 'multiway_score_surface_slot_invalid' };
    const prior = priorByDecision.get(membership.decisionId);
    if (slotIndex === 0 && prior !== undefined) return { blocker: 'multiway_score_surface_order_mismatch' };
    if (slotIndex === 1 && (!prior || prior.slotIndex !== 0)) {
      return { blocker: 'multiway_score_surface_order_mismatch' };
    }
    const firstAction = finiteInteger(slot.firstAction);
    const loggedAction = finiteInteger(slot.loggedAction);
    if (firstAction === undefined || loggedAction === undefined
      || firstAction < 0 || firstAction > 3 || loggedAction < 0 || loggedAction > 3) {
      return { blocker: 'multiway_score_surface_slot_invalid' };
    }
    const qHat = copyArray(slot.qHat, 4);
    if (!qHat || qHat.length !== 4 || qHat.some((value) => !finite(value))) {
      return { blocker: 'multiway_score_surface_slot_invalid' };
    }
    const behaviorBase = behaviorProbabilityV2(scenario, membership.viewerIndex);
    const targetBase = targetProbabilityV2(scenario);
    const behavior = slotIndex === 0
      ? behaviorBase
      : rotateProbabilityV2(behaviorBase, firstAction);
    const target = slotIndex === 0
      ? targetBase
      : rotateProbabilityV2(targetBase, firstAction);
    const expectedBehaviorProbability = behavior[loggedAction]!;
    const expectedTargetProbability = target[loggedAction]!;
    if (!close(slot.behaviorProbability, expectedBehaviorProbability)
      || !close(slot.targetProbability, expectedTargetProbability)
      || !finite(slot.reward) || slot.reward < 0 || slot.reward > 1
      || !finite(slot.prefixLogWeight) || !finite(slot.prefixWeight)) {
      return { blocker: 'multiway_score_surface_slot_invalid' };
    }
    if (slotIndex === 0 && !close(slot.prefixLogWeight, 0)) {
      return { blocker: 'multiway_score_surface_slot_invalid' };
    }
    if (slotIndex === 1 && prior && !close(slot.prefixLogWeight, prior.logWeight)) {
      return { blocker: 'multiway_score_surface_slot_invalid' };
    }
    const targetQValues = target.map((probability, index) => ({
      probability,
      qValue: Number(qHat[index]),
    }));
    const loggedQ = Number(qHat[loggedAction]);
    if (!finite(loggedQ)) return { blocker: 'multiway_score_surface_slot_invalid' };
    hooks.beforeEvaluateSequentialDr?.(slot);
    const evaluated = evaluateSequentialDrSlotV1({
      prefixLogWeight: slot.prefixLogWeight,
      behaviorProbability: slot.behaviorProbability,
      targetProbability: slot.targetProbability,
      reward: slot.reward,
      targetQValues,
      loggedQ,
    });
    hooks.afterEvaluateSequentialDr?.(slot, evaluated);
    if (evaluated.status !== 'evaluated' || evaluated.drContribution === undefined) {
      return { blocker: 'multiway_score_surface_slot_invalid' };
    }
    const dgpAtom = slot.atom;
    if (!dgpAtom || !close(dgpAtom.prefixWeight, evaluated.prefixWeight)
      || !close(dgpAtom.weight, evaluated.weight)
      || !close(dgpAtom.prefixLogWeight, evaluated.prefixLogWeight)
      || !close(dgpAtom.logWeight, evaluated.logWeight)
      || !close(dgpAtom.ipsContribution, evaluated.ipsContribution)
      || !close(dgpAtom.drContribution, evaluated.drContribution)
      || !close(dgpAtom.targetTerm + dgpAtom.residualTerm, evaluated.drContribution)) {
      return { blocker: 'multiway_score_surface_aggregate_invalid' };
    }
    const qHatProvenance = slot.qHatProvenance;
    if (!isRecord(qHatProvenance)
      || qHatProvenance.source !== 'frozen_multiway_dgp_v2'
      || qHatProvenance.dgpVersion !== 'synthetic_multiway_dr_dgp_v2'
      || !nonEmptyString(qHatProvenance.qHatSha256)) {
      return { blocker: 'multiway_score_surface_slot_invalid' };
    }
    const atom = {
      scenarioKind: scenario.scenarioKind,
      scenarioId: replication.scenarioId,
      replicationIndex: replication.replicationIndex,
      atomIndex,
      decisionId: membership.decisionId,
      requestId: membership.decisionId,
      servedPosition: slotIndex + 1,
      viewerClusterId: membership.viewerClusterId,
      timeClusterId: membership.timeClusterId,
      viewerMembership: membership.viewerClusterId,
      timeMembership: membership.timeClusterId,
      prefixLogWeight: evaluated.prefixLogWeight,
      prefixWeight: evaluated.prefixWeight,
      behaviorProbability: slot.behaviorProbability,
      targetProbability: slot.targetProbability,
      reward: slot.reward,
      qHatProvenance,
      targetQValues,
      loggedQ,
      logWeight: evaluated.logWeight,
      weight: evaluated.weight,
      ipsContribution: evaluated.ipsContribution,
      drContribution: evaluated.drContribution,
      membership: {
        viewerClusterId: membership.viewerClusterId,
        timeClusterId: membership.timeClusterId,
        cellId: membership.cellId,
        viewerIndex: membership.viewerIndex,
        timeIndex: membership.timeIndex,
        cellIndex: membership.cellIndex,
        decisionId: membership.decisionId,
        slotId: membership.slotId,
        decisionIndex: membership.decisionIndex,
        slotIndex: membership.slotIndex,
      },
      qHatProvenanceDigest: qHatProvenance.qHatSha256,
    };
    priorByDecision.set(membership.decisionId, { slotIndex, logWeight: evaluated.logWeight });
    return { atom };
  } catch {
    return { blocker: 'multiway_score_surface_slot_invalid' };
  }
}

function validMembership(value: MultiwayDgpMembershipV2): boolean {
  return nonEmptyString(value.viewerClusterId)
    && nonEmptyString(value.timeClusterId)
    && nonEmptyString(value.cellId)
    && nonEmptyString(value.decisionId)
    && nonEmptyString(value.slotId)
    && Number.isSafeInteger(value.viewerIndex) && value.viewerIndex >= 0
    && Number.isSafeInteger(value.timeIndex) && value.timeIndex >= 0
    && Number.isSafeInteger(value.cellIndex) && value.cellIndex >= 0
    && Number.isSafeInteger(value.decisionIndex) && Number(value.decisionIndex) >= 0
    && Number.isSafeInteger(value.slotIndex) && Number(value.slotIndex) >= 0;
}

function validGlobalSlotOrder(
  slot: MultiwayDgpSlotRecordV2,
  previous: Readonly<{ decisionIndex: number; slotIndex: number }> | undefined,
): boolean {
  const membership = slot.membership;
  if (!membership || !validMembership(membership)) return false;
  if (!previous) return membership.decisionIndex === 0 && membership.slotIndex === 0;
  if (membership.slotIndex === 0) return membership.decisionIndex === previous.decisionIndex + 1;
  return membership.decisionIndex === previous.decisionIndex
    && membership.slotIndex === previous.slotIndex + 1;
}

function validateRecordOrder(
  replication: VerifiedFrozenMultiwayDgpReplicationV2,
  records: readonly unknown[],
  slotCount: number,
): boolean {
  const counts = replication.counts;
  const expected = 2 + slotCount + counts.decisionCount + counts.cellCount
    + counts.viewerCount + counts.timeCount;
  if (records.length !== expected || records.length < 2) return false;
  let index = 0;
  if (safeGet(records[index++], 'recordKind') !== 'replication_start') return false;
  for (let i = 0; i < slotCount; i += 1) {
    if (safeGet(records[index++], 'recordKind') !== 'slot') return false;
  }
  for (let i = 0; i < counts.decisionCount; i += 1) {
    if (safeGet(records[index++], 'recordKind') !== 'decision') return false;
  }
  for (let i = 0; i < counts.cellCount; i += 1) {
    if (safeGet(records[index++], 'recordKind') !== 'cell') return false;
  }
  for (let i = 0; i < counts.viewerCount; i += 1) {
    if (safeGet(records[index++], 'recordKind') !== 'viewer') return false;
  }
  for (let i = 0; i < counts.timeCount; i += 1) {
    if (safeGet(records[index++], 'recordKind') !== 'time') return false;
  }
  return safeGet(records[index], 'recordKind') === 'replication_end';
}

function validateRecordBodies(
  replication: VerifiedFrozenMultiwayDgpReplicationV2,
  records: readonly unknown[],
  slotRecords: readonly unknown[],
): boolean {
  try {
    let index = 1;
    const groups: readonly (readonly unknown[])[] = [
      slotRecords as readonly unknown[],
      replication.decisionRecords,
      replication.cellRecords,
      replication.viewerRecords,
      replication.timeRecords,
    ];
    for (const group of groups) {
      for (const expected of group) {
        if (scoreSurfaceCanonicalJson(records[index++])
          !== scoreSurfaceCanonicalJson(expected)) return false;
      }
    }
    const start = records[0];
    const end = records[index];
    for (const boundary of [start, end]) {
      if (safeGet(boundary, 'scenarioId') !== replication.scenarioId
        || safeGet(boundary, 'replicationIndex') !== replication.replicationIndex
        || safeGet(boundary, 'replicationSeedSha256') !== replication.replicationSeedSha256
        || safeGet(boundary, 'recordCount') !== replication.counts.recordCount) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validateReplicationCounts(
  replication: VerifiedFrozenMultiwayDgpReplicationV2,
  atoms: readonly ScoreSurfaceSlotAtomV1[],
  recordCount: number,
): boolean {
  const counts = replication.counts;
  const decisions = new Set(atoms.map((atom) => atom.decisionId));
  const cells = new Set(atoms.map((atom) => atom.membership.cellId));
  const viewers = new Set(atoms.map((atom) => atom.viewerClusterId));
  const times = new Set(atoms.map((atom) => atom.timeClusterId));
  return counts.slotCount === atoms.length
    && counts.decisionCount === decisions.size
    && counts.cellCount === cells.size
    && counts.viewerCount === viewers.size
    && counts.timeCount === times.size
    && counts.recordsPerReplication === recordCount
    && counts.recordCount === recordCount;
}

function validateDgpRoots(
  replication: VerifiedFrozenMultiwayDgpReplicationV2,
  slotRecords: readonly unknown[],
): boolean {
  try {
    const digest = typeof dgpProtocol.multiwayDgpDigestV2 === 'function'
      ? dgpProtocol.multiwayDgpDigestV2 as (value: unknown) => string
      : scoreSurfaceDigest;
    const roots: Array<readonly [string, unknown]> = [
      ['viewerMembershipSha256', safeGet(replication, 'viewerMembership')],
      ['timeMembershipSha256', safeGet(replication, 'timeMembership')],
      ['cellMembershipSha256', safeGet(replication, 'cellMembership')],
      ['decisionMembershipSha256', safeGet(replication, 'decisionMembership')],
      ['slotMembershipSha256', safeGet(replication, 'slotMembership')],
    ];
    for (const [rootKey, value] of roots) {
      if (!Array.isArray(value) || safeGet(replication, rootKey) !== digest(value)) return false;
    }
    const qHatSnapshots = slotRecords.map((entry) => ({
      slotId: safeGet(safeGet(entry, 'membership'), 'slotId'),
      qHat: safeGet(entry, 'qHat'),
      mode: safeGet(safeGet(replication, 'scenario'), 'qHatMode'),
    }));
    const qHatProvenance = safeGet(replication, 'qHatProvenance');
    if (!isRecord(qHatProvenance)
      || safeGet(qHatProvenance, 'qHatSha256') !== digest(qHatSnapshots)) return false;
    const dgpRoot = safeGet(replication, 'dgpRootSha256');
    const expectedDgpRoot = digest({
      dgpVersion: safeGet(replication, 'dgpVersion'),
      scenarioId: safeGet(replication, 'scenarioId'),
      replicationSeedSha256: safeGet(replication, 'replicationSeedSha256'),
      memberships: {
        viewer: safeGet(replication, 'viewerMembership'),
        time: safeGet(replication, 'timeMembership'),
        cell: safeGet(replication, 'cellMembership'),
        decision: safeGet(replication, 'decisionMembership'),
        slot: safeGet(replication, 'slotMembership'),
      },
      shockProvenance: safeGet(replication, 'shockProvenance'),
      qHatProvenance,
    });
    if (dgpRoot !== expectedDgpRoot) return false;
    const replicationSha256 = safeGet(replication, 'replicationSha256');
    if (!nonEmptyString(replicationSha256)) return false;
    const replicationPreimage = { ...replication } as Record<string, unknown>;
    delete replicationPreimage.replicationSha256;
    if (digest(replicationPreimage) !== replicationSha256) return false;
    return true;
  } catch {
    return false;
  }
}

type AggregateLevel = ScoreSurfaceAggregateV1['level'];

function aggregateAtoms(
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
    key: string;
    slotCount: number;
    decisions: Set<string>;
    drContributionSum: number;
    ipsContributionSum: number;
    importanceMass: number;
  }>();
  for (const atom of atoms) {
    const key = aggregateKey(atom, level);
    const current = grouped.get(key) ?? {
      scenarioKind: atom.scenarioKind,
      scenarioId: atom.scenarioId,
      replicationIndex: atom.replicationIndex,
      ...(level === 'decision' ? { decisionId: atom.decisionId } : {}),
      ...(level === 'viewer_time_cell' || level === 'viewer' ? {
        viewerClusterId: atom.viewerClusterId,
      } : {}),
      ...(level === 'viewer_time_cell' || level === 'time' ? {
        timeClusterId: atom.timeClusterId,
      } : {}),
      key,
      slotCount: 0,
      decisions: new Set<string>(),
      drContributionSum: 0,
      ipsContributionSum: 0,
      importanceMass: 0,
    };
    current.slotCount += 1;
    current.decisions.add(atom.decisionId);
    current.drContributionSum += atom.drContribution;
    current.ipsContributionSum += atom.ipsContribution;
    // Weight is the OPE importance mass used by the existing cluster summary;
    // prefixWeight is retained on every atom for audit/replay.
    current.importanceMass += atom.weight;
    if (![current.drContributionSum, current.ipsContributionSum, current.importanceMass]
      .every(Number.isFinite)) {
      throw new Error('multiway_score_surface_aggregate_invalid');
    }
    grouped.set(key, current);
  }
  return freezeScoreSurface([...grouped.values()]
    .map((entry) => {
      const denominator = entry.slotCount;
      return {
        scenarioKind: entry.scenarioKind,
        scenarioId: entry.scenarioId,
        replicationIndex: entry.replicationIndex,
        ...(entry.decisionId === undefined ? {} : { decisionId: entry.decisionId }),
        ...(entry.viewerClusterId === undefined ? {} : {
          viewerClusterId: entry.viewerClusterId,
        }),
        ...(entry.timeClusterId === undefined ? {} : {
          timeClusterId: entry.timeClusterId,
        }),
        level,
        key: entry.key,
        slotCount: entry.slotCount,
        decisionCount: entry.decisions.size,
        drContributionSum: entry.drContributionSum,
        ipsContributionSum: entry.ipsContributionSum,
        importanceMass: entry.importanceMass,
        dr: entry.drContributionSum / denominator,
        ips: entry.ipsContributionSum / denominator,
      } satisfies ScoreSurfaceAggregateV1;
    })
    .sort((left, right) => compareScoreSurfaceText(left.key, right.key)));
}

function aggregateKey(atom: ScoreSurfaceSlotAtomV1, level: AggregateLevel): string {
  if (level === 'decision') {
    return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.decisionId}`;
  }
  if (level === 'viewer_time_cell') {
    return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.viewerClusterId}\0${atom.timeClusterId}`;
  }
  if (level === 'viewer') return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.viewerClusterId}`;
  if (level === 'time') return `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.timeClusterId}`;
  return `${atom.scenarioId}\0${atom.replicationIndex}\0__overall__`;
}

function buildMembership(atoms: readonly ScoreSurfaceSlotAtomV1[]): Readonly<{
  viewerIds: readonly string[];
  timeIds: readonly string[];
  rows: readonly Readonly<{
    scenarioId: string;
    replicationIndex: number;
    decisionId: string;
    viewerClusterId: string;
    timeClusterId: string;
  }>[];
}> | Readonly<{ blocker: MultiwayScoreSurfaceBlockerV1 }> {
  const byDecision = new Map<string, Readonly<{
    scenarioId: string;
    replicationIndex: number;
    decisionId: string;
    viewerClusterId: string;
    timeClusterId: string;
  }>>();
  for (const atom of atoms) {
    const membershipKey = `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.decisionId}`;
    const current = byDecision.get(membershipKey);
    const row = {
      scenarioId: atom.scenarioId,
      replicationIndex: atom.replicationIndex,
      decisionId: atom.decisionId,
      viewerClusterId: atom.viewerClusterId,
      timeClusterId: atom.timeClusterId,
    } as const;
    if (current && scoreSurfaceCanonicalJson(current) !== scoreSurfaceCanonicalJson(row)) {
      return { blocker: 'multiway_score_surface_aggregate_invalid' };
    }
    byDecision.set(membershipKey, row);
  }
  const rows = [...byDecision.values()].sort((left, right) => (
    compareScoreSurfaceText(
      `${left.scenarioId}\0${left.replicationIndex}\0${left.decisionId}`,
      `${right.scenarioId}\0${right.replicationIndex}\0${right.decisionId}`,
    )
  ));
  return {
    viewerIds: Object.freeze([...new Set(rows.map((row) => row.viewerClusterId))]
      .sort(compareScoreSurfaceText)),
    timeIds: Object.freeze([...new Set(rows.map((row) => row.timeClusterId))]
      .sort(compareScoreSurfaceText)),
    rows: freezeScoreSurface(rows),
  };
}

function buildViewerOnlyBaseline(
  atoms: readonly ScoreSurfaceSlotAtomV1[],
  commonTimeShock: boolean,
): ViewerOnlyDiagnosticBaselineV1 {
  const byViewer = new Map<string, ClusterScoreV1>();
  for (const atom of atoms) {
    const clusterKey = `${atom.scenarioId}\0${atom.replicationIndex}\0${atom.viewerClusterId}`;
    const current = byViewer.get(clusterKey) ?? {
      inferenceClusterId: clusterKey,
      y: 0,
      a: 0,
      importanceMass: 0,
    };
    current.y += atom.drContribution;
    current.a += 1;
    current.importanceMass += atom.weight;
    byViewer.set(clusterKey, current);
  }
  const clusters = [...byViewer.values()].sort((left, right) => (
    compareScoreSurfaceText(left.inferenceClusterId, right.inferenceClusterId)
  ));
  // Keep this call syntactically and operationally singular for the diagnostic.
  const summaryResult = summarizeClusterScoresV1('dr', clusters);
  const summary: ClusterScoreSummaryV1 | null = summaryResult.status === 'evaluated'
    ? summaryResult.summary
    : null;
  if (commonTimeShock) {
    return freezeScoreSurface({
      kind: 'viewer_only_diagnostic_baseline',
      estimator: 'dr',
      status: 'abstained',
      blocker: 'common_time_shock_inference_unavailable',
      commonTimeShockHandlingVerified: false,
      inferenceScope: 'viewer_only_diagnostic',
      summary: null,
      clusters,
      confidenceInterval: null,
      variance: null,
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
    });
  }
  return freezeScoreSurface({
    kind: 'viewer_only_diagnostic_baseline',
    estimator: 'dr',
    status: summary ? 'evaluated' : 'abstained',
    blocker: summary ? null : (summaryResult.status === 'not_evaluable'
      ? summaryResult.blocker
      : 'multiway_score_surface_aggregate_invalid'),
    commonTimeShockHandlingVerified: false,
    inferenceScope: 'viewer_only_diagnostic',
    summary,
    clusters,
    confidenceInterval: null,
    variance: null,
    candidateEvidenceEligible: false,
    qualificationEvidenceEligible: false,
  });
}

function buildResourceDiagnostics(
  protocol: VerifiedFrozenMultiwayDgpProtocolV2,
  scenarios: readonly FrozenMultiwayDgpScenarioV2[],
  replications: readonly ScoreSurfaceReplicationV1[],
  atoms: readonly ScoreSurfaceSlotAtomV1[],
  cells: readonly ScoreSurfaceAggregateV1[],
  viewerIds: readonly string[],
  timeIds: readonly string[],
  hookCounts: ScoreSurfaceHookCountsV1,
  plan: ScoreSurfaceResourcePlan,
  actualScoreWorkUnits: number,
  actualAggregationWorkUnits: number,
): ScoreSurfaceResourceDiagnosticsV1 {
  const canonicalInputBytes = scoreSurfaceCanonicalBytes({
    protocolSha256: protocol.protocolSha256,
    replications: replications.map((replication) => replication.replicationSha256),
    atoms,
  });
  const workUnits = atoms.length + cells.length + viewerIds.length + timeIds.length
    + replications.length + scenarios.length;
  return freezeScoreSurface({
    preflightCompletedBeforeReplay: true as const,
    scenarios: scenarios.length,
    replicationsPerScenario: protocol.replicationsPerScenario,
    replications: replications.length,
    totalReplications: plan.totalReplications,
    decisions: plan.decisions,
    cells: plan.cells,
    plannedRecordCount: plan.plannedRecordCount,
    slotAtoms: atoms.length,
    viewerTimeCells: cells.length,
    viewers: viewerIds.length,
    times: timeIds.length,
    canonicalInputBytes,
    canonicalInputBytesUpperBound: plan.canonicalInputBytesUpperBound,
    workUnits,
    hashWorkUnits: plan.hashWorkUnits,
    plannedScoreWorkUnits: plan.scoreWorkUnits,
    actualScoreWorkUnits,
    plannedAggregationWorkUnits: plan.aggregationWorkUnits,
    actualAggregationWorkUnits,
    hookCounts,
  });
}

function finiteInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? Number(value) : undefined;
}

function close(left: unknown, right: unknown, epsilon = 1e-10): boolean {
  return finite(left) && finite(right)
    && Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));
}
