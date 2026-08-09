import {
  PHASE12_ACTIONS_V1,
  PHASE12_G_V1,
  PHASE12_PROBABILITIES_V1,
  type FrozenSyntheticScenarioV1,
  type Phase12ProbabilityVectorV1,
} from './contracts';
import {
  isVerifiedFrozenInferenceQualificationProtocolV1,
  type VerifiedFrozenInferenceQualificationProtocolV1,
} from './protocol';

export type SyntheticDgpEnvelopeV1 = Readonly<{
  syntheticGeneratedClusterCountRange: readonly [number, number];
  slotsPerGeneratedCluster: 2;
  supportActionsPerSlot: 4;
  minimumBehaviorPropensity: number;
  qHatBounds: readonly [number, number];
  maximumTwoSlotPrefixWeight: number;
}>;

export function probabilityVectorV1(
  policy: FrozenSyntheticScenarioV1['targetPolicy'] | 'spiky' | 'near_zero',
): Phase12ProbabilityVectorV1 {
  if (policy === 'positive') return PHASE12_PROBABILITIES_V1.positive;
  if (policy === 'negative') return PHASE12_PROBABILITIES_V1.negative;
  if (policy === 'spiky') return PHASE12_PROBABILITIES_V1.spiky;
  if (policy === 'near_zero') return PHASE12_PROBABILITIES_V1.nearZero;
  return PHASE12_PROBABILITIES_V1.uniform;
}

export function rotateProbabilityV1(
  base: Phase12ProbabilityVectorV1,
  firstAction: number,
): Phase12ProbabilityVectorV1 {
  return [
    base[firstAction % 4]!,
    base[(firstAction + 1) % 4]!,
    base[(firstAction + 2) % 4]!,
    base[(firstAction + 3) % 4]!,
  ];
}

export function meanRewardV1(
  slot: 1 | 2,
  firstAction: number,
  action: number,
  shock: -1 | 1,
  shockScale: number,
): number {
  const utilityIndex = slot === 1 ? action : (firstAction + action) % 4;
  return 0.5 + 0.1 * PHASE12_G_V1[utilityIndex]! + shockScale * shock;
}

export function behaviorProbabilityV1(
  scenario: FrozenSyntheticScenarioV1,
  clusterIndex: number,
): Phase12ProbabilityVectorV1 {
  if (!Number.isSafeInteger(clusterIndex)
    || clusterIndex < 0
    || clusterIndex >= scenario.clusterCount) throw envelopeUnavailable();
  if (scenario.behaviorPolicy === 'spiky') return probabilityVectorV1('spiky');
  if (scenario.behaviorPolicy === 'near_zero') return probabilityVectorV1('near_zero');
  if (scenario.behaviorPolicy === 'viewer_imbalance' && clusterIndex === 0) {
    return probabilityVectorV1('spiky');
  }
  if (scenario.behaviorPolicy !== 'uniform' && scenario.behaviorPolicy !== 'viewer_imbalance') {
    throw envelopeUnavailable();
  }
  return probabilityVectorV1('uniform');
}

export function qHatValuesV1(
  scenario: FrozenSyntheticScenarioV1,
  slot: 1 | 2,
  firstAction: number,
  shock: -1 | 1,
): Phase12ProbabilityVectorV1 {
  if ((slot !== 1 && slot !== 2)
    || !PHASE12_ACTIONS_V1.includes(firstAction as 0 | 1 | 2 | 3)
    || (shock !== -1 && shock !== 1)) throw envelopeUnavailable();
  if (scenario.qHatMode === 'constant_0_5_v1') return [0.5, 0.5, 0.5, 0.5];
  if (scenario.qHatMode !== 'oracle_v1') throw envelopeUnavailable();
  const values = PHASE12_ACTIONS_V1.map((action) => meanRewardV1(
    slot, firstAction, action, shock, scenario.shockScale,
  )) as unknown as Phase12ProbabilityVectorV1;
  if (!values.every(Number.isFinite)) throw envelopeUnavailable();
  return values;
}

export function deriveSyntheticDgpEnvelopeV1(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
): SyntheticDgpEnvelopeV1 {
  try {
    if (!isVerifiedFrozenInferenceQualificationProtocolV1(protocol)
      || !Array.isArray(protocol.scenarios)
      || protocol.scenarios.length === 0) {
      throw envelopeUnavailable();
    }
    let minimumClusterCount = Number.POSITIVE_INFINITY;
    let maximumClusterCount = Number.NEGATIVE_INFINITY;
    let minimumBehaviorPropensity = Number.POSITIVE_INFINITY;
    let minimumQHat = Number.POSITIVE_INFINITY;
    let maximumQHat = Number.NEGATIVE_INFINITY;
    let maximumTwoSlotPrefixWeight = Number.NEGATIVE_INFINITY;

    for (const scenario of protocol.scenarios) {
      if (!Number.isSafeInteger(scenario.clusterCount) || scenario.clusterCount <= 0) {
        throw envelopeUnavailable();
      }
      minimumClusterCount = Math.min(minimumClusterCount, scenario.clusterCount);
      maximumClusterCount = Math.max(maximumClusterCount, scenario.clusterCount);
      const targetBase = probabilityVectorV1(scenario.targetPolicy);
      assertProbabilityVector(targetBase);

      for (let clusterIndex = 0; clusterIndex < scenario.clusterCount; clusterIndex += 1) {
        const behaviorBase = behaviorProbabilityV1(scenario, clusterIndex);
        assertProbabilityVector(behaviorBase);
        for (const firstAction of PHASE12_ACTIONS_V1) {
          const firstBehaviorProbability = behaviorBase[firstAction]!;
          const firstWeight = targetBase[firstAction]! / firstBehaviorProbability;
          const secondBehavior = rotateProbabilityV1(behaviorBase, firstAction);
          const secondTarget = rotateProbabilityV1(targetBase, firstAction);
          assertProbabilityVector(secondBehavior);
          assertProbabilityVector(secondTarget);
          minimumBehaviorPropensity = Math.min(
            minimumBehaviorPropensity,
            firstBehaviorProbability,
          );

          for (const secondAction of PHASE12_ACTIONS_V1) {
            minimumBehaviorPropensity = Math.min(
              minimumBehaviorPropensity,
              secondBehavior[secondAction]!,
            );
            const prefixWeight = firstWeight
              * secondTarget[secondAction]! / secondBehavior[secondAction]!;
            if (!Number.isFinite(prefixWeight) || prefixWeight < 0) throw envelopeUnavailable();
            maximumTwoSlotPrefixWeight = Math.max(maximumTwoSlotPrefixWeight, prefixWeight);

            for (const shock of [-1, 1] as const) {
              const firstQHat = qHatValuesV1(scenario, 1, 0, shock);
              const secondQHat = qHatValuesV1(scenario, 2, firstAction, shock);
              for (const qHatAction of PHASE12_ACTIONS_V1) {
                minimumQHat = Math.min(
                  minimumQHat,
                  firstQHat[qHatAction]!,
                  secondQHat[qHatAction]!,
                );
                maximumQHat = Math.max(
                  maximumQHat,
                  firstQHat[qHatAction]!,
                  secondQHat[qHatAction]!,
                );
              }
            }
          }
        }
      }
    }

    const derived = [
      minimumClusterCount,
      maximumClusterCount,
      minimumBehaviorPropensity,
      minimumQHat,
      maximumQHat,
      maximumTwoSlotPrefixWeight,
    ];
    if (!derived.every(Number.isFinite)
      || minimumClusterCount <= 0
      || minimumBehaviorPropensity <= 0
      || maximumTwoSlotPrefixWeight < 0) throw envelopeUnavailable();
    return {
      syntheticGeneratedClusterCountRange: [minimumClusterCount, maximumClusterCount],
      slotsPerGeneratedCluster: 2,
      supportActionsPerSlot: PHASE12_ACTIONS_V1.length,
      minimumBehaviorPropensity,
      qHatBounds: [normalizeDerivedNumber(minimumQHat), normalizeDerivedNumber(maximumQHat)],
      maximumTwoSlotPrefixWeight,
    };
  } catch {
    throw envelopeUnavailable();
  }
}

export function deriveKnownTruthFromDgpV1(scenario: FrozenSyntheticScenarioV1): number {
  const target = probabilityVectorV1(scenario.targetPolicy);
  let total = 0;
  for (const shock of [-1, 1] as const) {
    for (let firstAction = 0; firstAction < 4; firstAction += 1) {
      const secondTarget = rotateProbabilityV1(target, firstAction);
      for (let secondAction = 0; secondAction < 4; secondAction += 1) {
        const trajectoryProbability = 0.5 * target[firstAction]! * secondTarget[secondAction]!;
        total += trajectoryProbability * (
          meanRewardV1(1, 0, firstAction, shock, scenario.shockScale)
          + meanRewardV1(2, firstAction, secondAction, shock, scenario.shockScale)
        ) / 2;
      }
    }
  }
  return Number(total.toFixed(15));
}

function assertProbabilityVector(value: Phase12ProbabilityVectorV1): void {
  if (!Array.isArray(value)
    || value.length !== PHASE12_ACTIONS_V1.length
    || value.some((probability) => !Number.isFinite(probability)
      || probability <= 0
      || probability > 1)
    || Math.abs(value.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-12) {
    throw envelopeUnavailable();
  }
}

const envelopeUnavailable = () => new Error('synthetic_dgp_envelope_unavailable');
const normalizeDerivedNumber = (value: number) => Number(value.toFixed(15));
