import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  FROZEN_MULTIWAY_DGP_PROTOCOL_V2,
  MULTIWAY_DGP_ACTIONS_V2,
  MULTIWAY_DGP_COMMON_TIME_SHOCK_SCALES_V2,
  MULTIWAY_DGP_G_V2,
  MULTIWAY_DGP_METRIC_DENOMINATOR_V2,
  MULTIWAY_DGP_REPLICATION_SEED_VERSION_V2,
  MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2,
  MULTIWAY_DGP_SHOCK_SCALES_V2,
  MULTIWAY_DGP_SLOTS_V2,
  MULTIWAY_DGP_SUPPORT_ACTIONS_V2,
  MULTIWAY_DGP_RESOURCE_LIMITS_V2,
  SYNTHETIC_MULTIWAY_DR_DGP_V2,
  type FrozenMultiwayDgpProtocolV2,
  type MultiwayDgpBuildResultV2,
} from './contracts';
import {
  deriveKnownTruthFromDgpV2,
  deriveMultiwayDgpResourcePlanV2,
  scenarioInventoryV2,
} from './math';

const verifiedProtocol = Symbol('verifiedFrozenMultiwayDgpProtocolV2');
const verifiedProtocols = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

export type VerifiedFrozenMultiwayDgpProtocolV2 = FrozenMultiwayDgpProtocolV2 & {
  readonly [verifiedProtocol]: true;
};

export type FrozenMultiwayDgpProtocolInputV2 = Readonly<{
  protocolId: string;
  generatorSeedMaterial: string;
  frozenAt: string;
}>;

export function buildFrozenMultiwayDgpProtocolV2(
  input: FrozenMultiwayDgpProtocolInputV2,
): MultiwayDgpBuildResultV2 {
  try {
    if (!validProtocolInput(input)) return reject('multiway_dgp_protocol_invalid');
    const preimage = protocolPreimage(input);
    if (!resourcePlanWithinLimits(preimage.resources)) return reject('resource_limit_exceeded');
    return verifyFrozenMultiwayDgpProtocolV2({
      ...preimage,
      protocolSha256: multiwayDgpDigestV2(preimage),
    });
  } catch {
    return reject('multiway_dgp_protocol_invalid');
  }
}

export const buildMultiwayDgpProtocolV2 = buildFrozenMultiwayDgpProtocolV2;

export function verifyFrozenMultiwayDgpProtocolV2(
  input: unknown,
): MultiwayDgpBuildResultV2 {
  try {
    const record = asRecord(input);
    if (!record) return reject('multiway_dgp_protocol_invalid');
    const base = protocolInput(record);
    if (!base) return reject('multiway_dgp_protocol_invalid');
    const expectedPreimage = protocolPreimage(base);
    const suppliedResources = safeGet(record, 'resources');
    if (canonicalDecisionJson(suppliedResources)
      !== canonicalDecisionJson(expectedPreimage.resources)) {
      return reject('resource_limit_exceeded');
    }
    if (!resourcePlanWithinLimits(expectedPreimage.resources)) return reject('resource_limit_exceeded');
    const expected = {
      ...expectedPreimage,
      protocolSha256: multiwayDgpDigestV2(expectedPreimage),
    };
    if (canonicalDecisionJson(record) !== canonicalDecisionJson(expected)) {
      return reject('multiway_dgp_protocol_invalid');
    }
    const candidate = expected as unknown as VerifiedFrozenMultiwayDgpProtocolV2;
    Object.defineProperty(candidate, verifiedProtocol, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    freezeMultiwayDgpV2(candidate);
    verifiedDigests.set(candidate, candidate.protocolSha256);
    verifiedProtocols.add(candidate);
    return { status: 'verified', protocol: candidate };
  } catch {
    return reject('multiway_dgp_protocol_invalid');
  }
}

export const verifyMultiwayDgpProtocolV2 = verifyFrozenMultiwayDgpProtocolV2;

export function isVerifiedFrozenMultiwayDgpProtocolV2(
  value: unknown,
): value is VerifiedFrozenMultiwayDgpProtocolV2 {
  try {
    if (!value || typeof value !== 'object' || !verifiedProtocols.has(value)) return false;
    const candidate = value as VerifiedFrozenMultiwayDgpProtocolV2;
    const protocolSha256 = safeGet(candidate, 'protocolSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    delete preimage.protocolSha256;
    return safeGet(candidate, verifiedProtocol) === true
      && isMultiwayDgpFrozenV2(candidate)
      && typeof protocolSha256 === 'string'
      && protocolSha256 === multiwayDgpDigestV2(preimage)
      && verifiedDigests.get(candidate) === protocolSha256;
  } catch {
    return false;
  }
}

export const isVerifiedMultiwayDgpProtocolV2 = isVerifiedFrozenMultiwayDgpProtocolV2;

export function multiwayDgpDigestV2(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

export const canonicalMultiwayDgpJsonV2 = (value: unknown): string => canonicalDecisionJson(value);
export const canonicalMultiwayDgpBytesV2 = (value: unknown): number => (
  Buffer.byteLength(canonicalMultiwayDgpJsonV2(value))
);

export function multiwayDgpScenarioInventoryV2(): readonly FrozenMultiwayDgpProtocolV2['scenarios'][number][] {
  return scenarioInventoryV2();
}

export function multiwayDgpResourcesV2(): FrozenMultiwayDgpProtocolV2['resources'] {
  return deriveMultiwayDgpResourcePlanV2();
}

function protocolPreimage(input: FrozenMultiwayDgpProtocolInputV2) {
  const scenarios = scenarioInventoryV2();
  return {
    contractVersion: FROZEN_MULTIWAY_DGP_PROTOCOL_V2,
    protocolId: input.protocolId,
    dgpVersion: SYNTHETIC_MULTIWAY_DR_DGP_V2,
    replicationSeedVersion: MULTIWAY_DGP_REPLICATION_SEED_VERSION_V2,
    generatorSeedMaterial: input.generatorSeedMaterial,
    replicationsPerScenario: MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2,
    slotsPerDecision: MULTIWAY_DGP_SLOTS_V2,
    supportActionsPerSlot: MULTIWAY_DGP_SUPPORT_ACTIONS_V2,
    actionValues: MULTIWAY_DGP_ACTIONS_V2,
    utilityValues: MULTIWAY_DGP_G_V2,
    shockScales: MULTIWAY_DGP_SHOCK_SCALES_V2,
    commonTimeShockScales: MULTIWAY_DGP_COMMON_TIME_SHOCK_SCALES_V2,
    commonTimeShockScenarioPresent: true as const,
    knownTruthDerivation: 'target_trajectory_4x4_zero_mean_factorized_shock_v2' as const,
    metricDenominatorVersion: MULTIWAY_DGP_METRIC_DENOMINATOR_V2,
    scenarios,
    resources: deriveMultiwayDgpResourcePlanV2(scenarios),
    realDatasetEligible: false as const,
    syntheticOnly: true as const,
    ciGenerated: false as const,
    inferenceGenerated: false as const,
    candidateGenerated: false as const,
    servable: false as const,
    frozenAt: input.frozenAt,
  };
}

function protocolInput(record: Record<string, unknown>): FrozenMultiwayDgpProtocolInputV2 | null {
  const input = {
    protocolId: safeGet(record, 'protocolId'),
    generatorSeedMaterial: safeGet(record, 'generatorSeedMaterial'),
    frozenAt: safeGet(record, 'frozenAt'),
  };
  return validProtocolInput(input) ? input : null;
}

function validProtocolInput(input: unknown): input is FrozenMultiwayDgpProtocolInputV2 {
  if (!input || typeof input !== 'object') return false;
  const protocolId = safeGet(input, 'protocolId');
  const generatorSeedMaterial = safeGet(input, 'generatorSeedMaterial');
  const frozenAt = safeGet(input, 'frozenAt');
  return validText(protocolId, 128, 1)
    && validText(generatorSeedMaterial, 128, 16)
    && typeof frozenAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(frozenAt)
    && Number.isFinite(Date.parse(frozenAt));
}

function resourcePlanWithinLimits(resources: FrozenMultiwayDgpProtocolV2['resources']): boolean {
  const limits = MULTIWAY_DGP_RESOURCE_LIMITS_V2;
  return resources.scenarioCount <= limits.maximumScenarios
    && resources.replicationsPerScenario <= limits.maximumReplicationsPerScenario
    && resources.plannedRecordCount <= limits.maximumQualificationRecords
    && resources.plannedBytesUpperBound <= limits.maximumQualificationBytes
    && resources.generatorPrimitiveWorkUnits <= limits.maximumGeneratorPrimitiveWorkUnits
    && resources.hashWorkUnits <= limits.maximumHashWorkUnits
    && resources.actionDrawWorkUnits <= limits.maximumActionDrawWorkUnits
    && resources.actionSelectionComparisonWorkUnits
      <= limits.maximumActionSelectionComparisonWorkUnits
    && resources.rewardDrawWorkUnits <= limits.maximumRewardDrawWorkUnits
    && resources.qHatEvaluationWorkUnits <= limits.maximumQHatEvaluationWorkUnits
    && resources.scoreWorkUnits <= limits.maximumScoreWorkUnits
    && resources.aggregationWorkUnits <= limits.maximumAggregationWorkUnits
    && resources.scenarioRecordCounts.length === resources.scenarioCount;
}

function reject(
  blocker: 'multiway_dgp_protocol_invalid' | 'resource_limit_exceeded',
): MultiwayDgpBuildResultV2 {
  return { status: 'not_evaluable', blocker };
}

function validText(value: unknown, maximumBytes: number, minimumBytes: number): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && Buffer.byteLength(value) >= minimumBytes
    && Buffer.byteLength(value) <= maximumBytes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function freezeMultiwayDgpV2<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    let child: unknown;
    try {
      child = Reflect.get(value, key);
    } catch {
      continue;
    }
    freezeMultiwayDgpV2(child, seen);
  }
  return Object.freeze(value);
}

export function isMultiwayDgpFrozenV2(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  try {
    return Reflect.ownKeys(value).every((key) => isMultiwayDgpFrozenV2(
      Reflect.get(value, key),
      seen,
    ));
  } catch {
    return false;
  }
}

export function safeMultiwayDgpGet(value: unknown, key: PropertyKey): unknown {
  try {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
      ? Reflect.get(value, key)
      : undefined;
  } catch {
    return undefined;
  }
}

const safeGet = safeMultiwayDgpGet;
