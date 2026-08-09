import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../decisionLog/contracts';
import type { ClusterScoreV1 } from '../../contracts';
import {
  PHASE12_REPLICATION_SEED_VERSION_V1,
  SYNTHETIC_SEQUENTIAL_DR_CLUSTER_SCORE_V1,
  VERIFIED_SYNTHETIC_CLUSTER_SCORE_REPLICATION_V1,
  type FrozenSyntheticScenarioV1,
  type Phase12ProbabilityVectorV1,
  type VerifiedSyntheticClusterScoreReplicationV1,
} from './contracts';
import {
  behaviorProbabilityV1,
  deriveKnownTruthFromDgpV1,
  meanRewardV1,
  probabilityVectorV1,
  qHatValuesV1,
  rotateProbabilityV1,
} from './dgpMath';
import {
  isVerifiedFrozenInferenceQualificationProtocolV1,
  type VerifiedFrozenInferenceQualificationProtocolV1,
} from './protocol';

const verifiedReplication = Symbol('verifiedSyntheticClusterScoreReplicationV1');
const verifiedReplications = new WeakSet<object>();
const verifiedReplicationDigests = new WeakMap<object, string>();

type BrandedReplication = VerifiedSyntheticClusterScoreReplicationV1 & {
  readonly [verifiedReplication]: true;
};

export type GenerateSyntheticClusterScoreReplicationResultV1 =
  | { status: 'generated'; replication: BrandedReplication }
  | { status: 'not_evaluable'; blocker: 'synthetic_dgp_contract_invalid' | 'synthetic_dgp_non_finite' };

export function deriveKnownTruthV1(scenario: FrozenSyntheticScenarioV1): number {
  return deriveKnownTruthFromDgpV1(scenario);
}

export function syntheticUniform53V1(
  domain: 'cluster_shock_v1' | 'behavior_action_v1' | 'reward_draw_v1',
  replicationSeed: string,
  indices: unknown,
): number {
  const bytes = createHash('sha256')
    .update(domain)
    .update('\0')
    .update(replicationSeed)
    .update('\0')
    .update(canonicalDecisionJson(indices))
    .digest();
  let value = 0n;
  for (const byte of bytes.subarray(0, 7)) value = (value << 8n) | BigInt(byte);
  return Number(value >> 3n) / 2 ** 53;
}

export function generateSyntheticClusterScoreReplicationV1(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  scenario: FrozenSyntheticScenarioV1,
  replicationIndex: number,
): GenerateSyntheticClusterScoreReplicationResultV1 {
  try {
    if (!isVerifiedFrozenInferenceQualificationProtocolV1(protocol)
      || !protocol.scenarios.includes(scenario)
      || !Number.isSafeInteger(replicationIndex)
      || replicationIndex < 0
      || replicationIndex >= protocol.resources.criticalReplicationsPerScenario
      || scenario.knownTruth !== deriveKnownTruthFromDgpV1(scenario)) {
      return { status: 'not_evaluable', blocker: 'synthetic_dgp_contract_invalid' };
    }
    const replicationSeedSha256 = replicationSeed(protocol, scenario, replicationIndex);
    const clusterScores = Array.from({ length: scenario.clusterCount }, (_, clusterIndex) => (
      generateClusterScore(scenario, replicationIndex, replicationSeedSha256, clusterIndex)
    )).sort((left, right) => utf8Compare(left.inferenceClusterId, right.inferenceClusterId));
    if (clusterScores.some((cluster) => !validClusterScore(cluster))) {
      return { status: 'not_evaluable', blocker: 'synthetic_dgp_non_finite' };
    }
    const preimage = {
      contractVersion: VERIFIED_SYNTHETIC_CLUSTER_SCORE_REPLICATION_V1,
      protocolSha256: protocol.protocolSha256,
      scenarioKind: scenario.scenarioKind,
      scenarioId: scenario.scenarioId,
      replicationIndex,
      replicationSeedSha256,
      scoreGeneratorVersion: SYNTHETIC_SEQUENTIAL_DR_CLUSTER_SCORE_V1,
      estimator: 'dr' as const,
      qHatMode: scenario.qHatMode,
      slotsPerCluster: 2 as const,
      supportActionsPerSlot: 4 as const,
      knownTruth: scenario.knownTruth,
      clusterScores,
      realDatasetEligible: false as const,
      servable: false as const,
      canMintVerifiedPredictionStepV2: false as const,
    };
    const candidate = {
      ...preimage,
      replicationSha256: digest(preimage),
    } as unknown as BrandedReplication;
    Object.defineProperty(candidate, verifiedReplication, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    verifiedReplications.add(candidate);
    recursivelyFreeze(candidate);
    verifiedReplicationDigests.set(candidate, candidate.replicationSha256);
    return { status: 'generated', replication: candidate };
  } catch {
    return { status: 'not_evaluable', blocker: 'synthetic_dgp_contract_invalid' };
  }
}

export function isVerifiedSyntheticClusterScoreReplicationV1(
  value: unknown,
): value is BrandedReplication {
  try {
    if (!value || typeof value !== 'object' || !verifiedReplications.has(value)) return false;
    const candidate = value as BrandedReplication;
    const { replicationSha256, ...preimage } = candidate;
    return candidate[verifiedReplication] === true
      && recursivelyFrozen(candidate)
      && replicationSha256 === digest(preimage)
      && verifiedReplicationDigests.get(candidate) === replicationSha256;
  } catch {
    return false;
  }
}

function generateClusterScore(
  scenario: FrozenSyntheticScenarioV1,
  replicationIndex: number,
  replicationSeed: string,
  clusterIndex: number,
): ClusterScoreV1 {
  const common = [scenario.scenarioKind, scenario.scenarioId, replicationIndex, clusterIndex] as const;
  const shock: -1 | 1 = syntheticUniform53V1('cluster_shock_v1', replicationSeed, common) < 0.5
    ? -1
    : 1;
  const behaviorBase = behaviorProbabilityV1(scenario, clusterIndex);
  const targetBase = probabilityVectorV1(scenario.targetPolicy);
  const firstAction = selectAction(
    behaviorBase,
    syntheticUniform53V1('behavior_action_v1', replicationSeed, [...common, 1]),
  );
  const firstReward = syntheticUniform53V1(
    'reward_draw_v1', replicationSeed, [...common, 1, firstAction],
  ) < meanRewardV1(1, 0, firstAction, shock, scenario.shockScale) ? 1 : 0;
  const firstQHat = qHatValuesV1(scenario, 1, 0, shock);
  const firstTargetTerm = dot(targetBase, firstQHat);
  const firstWeight = targetBase[firstAction]! / behaviorBase[firstAction]!;
  const firstContribution = firstTargetTerm
    + firstWeight * (firstReward - firstQHat[firstAction]!);

  const secondBehavior = rotateProbabilityV1(behaviorBase, firstAction);
  const secondTarget = rotateProbabilityV1(targetBase, firstAction);
  const secondAction = selectAction(
    secondBehavior,
    syntheticUniform53V1('behavior_action_v1', replicationSeed, [...common, 2, firstAction]),
  );
  const secondReward = syntheticUniform53V1(
    'reward_draw_v1', replicationSeed, [...common, 2, firstAction, secondAction],
  ) < meanRewardV1(2, firstAction, secondAction, shock, scenario.shockScale) ? 1 : 0;
  const secondQHat = qHatValuesV1(scenario, 2, firstAction, shock);
  const secondTargetTerm = dot(secondTarget, secondQHat);
  const secondWeight = firstWeight
    * secondTarget[secondAction]! / secondBehavior[secondAction]!;
  const secondContribution = firstWeight * secondTargetTerm
    + secondWeight * (secondReward - secondQHat[secondAction]!);

  return {
    inferenceClusterId: `cluster-${String(clusterIndex).padStart(2, '0')}`,
    y: firstContribution + secondContribution,
    a: 2,
    importanceMass: firstWeight + secondWeight,
  };
}

function selectAction(probabilities: Phase12ProbabilityVectorV1, uniform: number): number {
  let cumulative = 0;
  let selected = 3;
  let found = false;
  for (let action = 0; action < 4; action += 1) {
    cumulative += probabilities[action]!;
    if (!found && uniform < cumulative) {
      selected = action;
      found = true;
    }
  }
  return selected;
}

function replicationSeed(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  scenario: FrozenSyntheticScenarioV1,
  replicationIndex: number,
): string {
  return createHash('sha256')
    .update(PHASE12_REPLICATION_SEED_VERSION_V1)
    .update('\0')
    .update(protocol.protocolSha256)
    .update('\0')
    .update(protocol.generatorSeedMaterial)
    .update('\0')
    .update(canonicalDecisionJson([scenario.scenarioKind, scenario.scenarioId, replicationIndex]))
    .digest('hex');
}

const dot = (left: Phase12ProbabilityVectorV1, right: Phase12ProbabilityVectorV1) => (
  left.reduce((total, value, index) => total + value * right[index]!, 0)
);
const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
const utf8Compare = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));

function validClusterScore(cluster: ClusterScoreV1): boolean {
  return cluster.inferenceClusterId.length > 0
    && Buffer.byteLength(cluster.inferenceClusterId) <= 32
    && [cluster.y, cluster.a, cluster.importanceMass].every((value) => (
      Number.isFinite(value) && Math.abs(value) <= 1e12
    ))
    && cluster.a > 0
    && cluster.importanceMass >= 0;
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
