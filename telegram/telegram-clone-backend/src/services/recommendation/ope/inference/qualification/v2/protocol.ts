import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../decisionLog/contracts';
import {
  FROZEN_INFERENCE_QUALIFICATION_PROTOCOL_V1,
  PHASE12_CRITICAL_SCENARIO_IDS_V1,
  PHASE12_METRIC_DENOMINATOR_V1,
  PHASE12_REPLICATION_SEED_VERSION_V1,
  SYNTHETIC_SEQUENTIAL_DR_CLUSTER_SCORE_V1,
  SYNTHETIC_SEQUENTIAL_DR_DGP_V1,
  type FrozenInferenceQualificationProtocolV1,
  type FrozenSyntheticScenarioV1,
  type Phase12QualificationReachabilityV1,
  type Phase12QualificationResourcesV1,
} from './contracts';
import { deriveKnownTruthFromDgpV1 } from './dgpMath';

const verifiedProtocol = Symbol('verifiedFrozenInferenceQualificationProtocolV1');
const verifiedProtocols = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

export type VerifiedFrozenInferenceQualificationProtocolV1 =
  FrozenInferenceQualificationProtocolV1 & { readonly [verifiedProtocol]: true };

export type FrozenInferenceQualificationProtocolInputV1 = {
  protocolId: string;
  generatorSeedMaterial: string;
  bootstrapSeedMaterial: string;
  frozenAt: string;
};

export type FrozenInferenceQualificationProtocolBuildResultV1 =
  | { status: 'verified'; protocol: VerifiedFrozenInferenceQualificationProtocolV1 }
  | {
    status: 'not_evaluable';
    blocker:
      | 'qualification_protocol_invalid'
      | 'qualification_gate_resolution_insufficient'
      | 'resource_limit_exceeded';
  };

const RESOURCES: Phase12QualificationResourcesV1 = Object.freeze({
  criticalClusterCounts: Object.freeze([4, 4, 4, 4, 4, 2, 4, 4] as const),
  criticalReplicationsPerScenario: 117,
  assumptionControlKinds: 4,
  assumptionReplicationsPerKind: 8,
  invalidControlReplications: 1,
  invalidControlClusters: 2,
  criticalClusterScores: 3_510,
  totalClusterScores: 3_512,
  qHatEvaluations: 28_080,
  bootstrapWorkUnits: 892_048,
  generatorPrimitiveWorkUnits: 108_812,
  plannedRecordCount: 5_420,
  plannedBytesUpperBound: 22_205_740,
  maximumGeneratorPrimitiveWorkUnits: 131_072,
  maximumBootstrapWorkUnits: 1_000_000,
  maximumQualificationRecords: 8_192,
  maximumQualificationBytes: 33_554_432,
  maximumCanonicalRecordBytes: 4_096,
});

const ASSUMPTION_CONTROLS = Object.freeze([
  'viewer_dependence',
  'unhandled_time_shock',
  'propensity_bound_unverified',
  'adaptive_selection_holdout_reuse',
] as const);

export function buildFrozenInferenceQualificationProtocolV1(
  input: FrozenInferenceQualificationProtocolInputV1,
): FrozenInferenceQualificationProtocolBuildResultV1 {
  const preimage = protocolPreimage(input);
  return verifyFrozenInferenceQualificationProtocolV1({
    ...preimage,
    protocolSha256: digest(preimage),
  });
}

export function verifyFrozenInferenceQualificationProtocolV1(
  input: unknown,
): FrozenInferenceQualificationProtocolBuildResultV1 {
  try {
    const record = asRecord(input);
    if (!record) return { status: 'not_evaluable', blocker: 'qualification_protocol_invalid' };
    const base = protocolInput(record);
    if (!base) return { status: 'not_evaluable', blocker: 'qualification_protocol_invalid' };
    const expectedPreimage = protocolPreimage(base);
    if (canonicalDecisionJson(record.resources) !== canonicalDecisionJson(expectedPreimage.resources)) {
      return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
    }
    if (!expectedPreimage.reachability.reachable) {
      return { status: 'not_evaluable', blocker: 'qualification_gate_resolution_insufficient' };
    }
    const expected = { ...expectedPreimage, protocolSha256: digest(expectedPreimage) };
    if (canonicalDecisionJson(record) !== canonicalDecisionJson(expected)) {
      return { status: 'not_evaluable', blocker: 'qualification_protocol_invalid' };
    }
    const candidate = expected as unknown as VerifiedFrozenInferenceQualificationProtocolV1;
    Object.defineProperty(candidate, verifiedProtocol, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    verifiedProtocols.add(candidate);
    recursivelyFreeze(candidate);
    verifiedDigests.set(candidate, candidate.protocolSha256);
    return { status: 'verified', protocol: candidate };
  } catch {
    return { status: 'not_evaluable', blocker: 'qualification_protocol_invalid' };
  }
}

export function isVerifiedFrozenInferenceQualificationProtocolV1(
  value: unknown,
): value is VerifiedFrozenInferenceQualificationProtocolV1 {
  try {
    if (!value || typeof value !== 'object' || !verifiedProtocols.has(value)) return false;
    const candidate = value as VerifiedFrozenInferenceQualificationProtocolV1;
    const { protocolSha256, ...preimage } = candidate;
    return candidate[verifiedProtocol] === true
      && recursivelyFrozen(candidate)
      && protocolSha256 === digest(preimage)
      && verifiedDigests.get(candidate) === protocolSha256;
  } catch {
    return false;
  }
}

export function qualificationResourcesV1(): Phase12QualificationResourcesV1 {
  return RESOURCES;
}

function protocolPreimage(input: FrozenInferenceQualificationProtocolInputV1) {
  const scenarios = scenarioInventory().sort((left, right) => utf8Compare(
    `${left.scenarioKind}\0${left.scenarioId}`,
    `${right.scenarioKind}\0${right.scenarioId}`,
  ));
  return {
    contractVersion: FROZEN_INFERENCE_QUALIFICATION_PROTOCOL_V1,
    protocolId: input.protocolId,
    dgpVersion: SYNTHETIC_SEQUENTIAL_DR_DGP_V1,
    scoreGeneratorVersion: SYNTHETIC_SEQUENTIAL_DR_CLUSTER_SCORE_V1,
    seedDerivationVersion: PHASE12_REPLICATION_SEED_VERSION_V1,
    generatorSeedMaterial: input.generatorSeedMaterial,
    bootstrapSeedMaterial: input.bootstrapSeedMaterial,
    bootstrapReplicates: 127 as const,
    confidenceLevel: 0.95 as const,
    familyAlpha: 0.05 as const,
    metricDenominatorVersion: PHASE12_METRIC_DENOMINATOR_V1,
    scenarios,
    assumptionControlKinds: ASSUMPTION_CONTROLS,
    resources: RESOURCES,
    reachability: reachability(),
    selectionRule: 'diagnostics_only_abstention_v1' as const,
    frozenAt: input.frozenAt,
    realDatasetEligible: false as const,
  };
}

function protocolInput(record: Record<string, unknown>): FrozenInferenceQualificationProtocolInputV1 | null {
  const input = {
    protocolId: record.protocolId,
    generatorSeedMaterial: record.generatorSeedMaterial,
    bootstrapSeedMaterial: record.bootstrapSeedMaterial,
    frozenAt: record.frozenAt,
  };
  if (!validText(input.protocolId, 128)
    || !validText(input.generatorSeedMaterial, 128, 16)
    || !validText(input.bootstrapSeedMaterial, 128, 16)
    || typeof input.frozenAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.frozenAt)
    || !Number.isFinite(Date.parse(input.frozenAt))) return null;
  return input as FrozenInferenceQualificationProtocolInputV1;
}

function scenarioInventory(): FrozenSyntheticScenarioV1[] {
  const definitions: Array<Omit<FrozenSyntheticScenarioV1, 'knownTruth'>> = [
    { scenarioKind: 'critical', scenarioId: 'nominal_positive', clusterCount: 4, behaviorPolicy: 'uniform', targetPolicy: 'positive', qHatMode: 'oracle_v1', shockScale: 0.05, threshold: 0.5, direction: 'greater', truthClass: 'beneficial' },
    { scenarioKind: 'critical', scenarioId: 'nominal_null', clusterCount: 4, behaviorPolicy: 'uniform', targetPolicy: 'uniform', qHatMode: 'oracle_v1', shockScale: 0.05, threshold: 0.5, direction: 'greater', truthClass: 'null' },
    { scenarioKind: 'critical', scenarioId: 'harmful_policy', clusterCount: 4, behaviorPolicy: 'uniform', targetPolicy: 'negative', qHatMode: 'oracle_v1', shockScale: 0.05, threshold: 0.5, direction: 'greater', truthClass: 'harmful' },
    { scenarioKind: 'critical', scenarioId: 'prefix_weight_heavy_tail', clusterCount: 4, behaviorPolicy: 'spiky', targetPolicy: 'uniform', qHatMode: 'oracle_v1', shockScale: 0.05, threshold: 0.5, direction: 'greater', truthClass: 'null' },
    { scenarioKind: 'critical', scenarioId: 'viewer_cluster_imbalance', clusterCount: 4, behaviorPolicy: 'viewer_imbalance', targetPolicy: 'uniform', qHatMode: 'oracle_v1', shockScale: 0.1, threshold: 0.5, direction: 'greater', truthClass: 'null' },
    { scenarioKind: 'critical', scenarioId: 'few_clusters', clusterCount: 2, behaviorPolicy: 'uniform', targetPolicy: 'uniform', qHatMode: 'oracle_v1', shockScale: 0.05, threshold: 0.5, direction: 'greater', truthClass: 'null' },
    { scenarioKind: 'critical', scenarioId: 'near_zero_propensity', clusterCount: 4, behaviorPolicy: 'near_zero', targetPolicy: 'uniform', qHatMode: 'oracle_v1', shockScale: 0.05, threshold: 0.5, direction: 'greater', truthClass: 'null' },
    { scenarioKind: 'critical', scenarioId: 'synthetic_dr_score_misspecification', clusterCount: 4, behaviorPolicy: 'uniform', targetPolicy: 'uniform', qHatMode: 'constant_0_5_v1', shockScale: 0.05, threshold: 0.5, direction: 'greater', truthClass: 'null' },
  ];
  return definitions.map((definition) => {
    const candidate = { ...definition, knownTruth: 0 } as FrozenSyntheticScenarioV1;
    return { ...definition, knownTruth: deriveKnownTruthFromDgpV1(candidate) };
  });
}

function reachability(): Phase12QualificationReachabilityV1 {
  const coverageDenominator = 936 as const;
  const falsePromotionDenominator = 819 as const;
  const invalidRateDenominator = 936 as const;
  const coverageMargin = margin(coverageDenominator);
  const falsePromotionMargin = margin(falsePromotionDenominator);
  const invalidRateMargin = margin(invalidRateDenominator);
  const bestCaseCoverageLowerBound = 1 - coverageMargin;
  const bestCaseFalsePromotionUpperBound = falsePromotionMargin;
  const bestCaseInvalidRateUpperBound = invalidRateMargin;
  return {
    gateCount: 3,
    monteCarloErrorBudget: 0.05,
    coverageDenominator,
    falsePromotionDenominator,
    invalidRateDenominator,
    minimumCoverage: 0.95,
    maximumFalsePromotionRate: 0.05,
    maximumInvalidReplicateRate: 0.05,
    coverageMargin,
    falsePromotionMargin,
    invalidRateMargin,
    bestCaseCoverageLowerBound,
    bestCaseFalsePromotionUpperBound,
    bestCaseInvalidRateUpperBound,
    reachable: bestCaseCoverageLowerBound >= 0.95
      && bestCaseFalsePromotionUpperBound <= 0.05
      && bestCaseInvalidRateUpperBound <= 0.05,
  };
}

const margin = (denominator: number) => Math.sqrt(Math.log(60) / (2 * denominator));
const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
const utf8Compare = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));

function validText(value: unknown, maximumBytes: number, minimumBytes = 1): value is string {
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

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}

export function criticalScenarioIdsV1(): typeof PHASE12_CRITICAL_SCENARIO_IDS_V1 {
  return PHASE12_CRITICAL_SCENARIO_IDS_V1;
}
