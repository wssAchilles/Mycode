import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../decisionLog/contracts';
import { bootstrapStatistics } from '../bootstrap';
import {
  DIRECTIONAL_P_VALUE_VERSION_V1,
  DIRECTIONAL_TEST_RESOURCE_LIMITS_V2,
  DIRECTIONAL_THRESHOLD_DOMAIN_V2,
  DIRECTIONAL_THRESHOLD_TEST_V2,
  HOLM_STEP_DOWN_V1,
  INTERSECTION_UNION_ALL_MUST_PASS_V1,
  type DirectionalAlternativeV2,
  type DirectionalTestResolutionInputV2,
  type DirectionalThresholdTestResultV2,
  type ThresholdBootstrapInputV2,
} from './contracts';

export function thresholdBootstrapTV2(
  input: ThresholdBootstrapInputV2,
): DirectionalThresholdTestResultV2
  | { status: 'not_evaluable'; blocker: 'directional_test_contract_invalid' | 'bootstrap_replicate_invalid' } {
  try {
    if (!validInput(input)) {
      return { status: 'not_evaluable', blocker: 'directional_test_contract_invalid' };
    }
    const alternative: DirectionalAlternativeV2 = input.direction === 'greater'
      ? 'theta_greater_than_null_v1'
      : 'theta_less_than_null_v1';
    const purposeSeedSha256 = purposeSeed(input, alternative);
    const observedStatistic = (input.summary.thetaHat - input.nullThreshold)
      / input.summary.standardError;
    const values = bootstrapStatistics(input.summary, {
      center: input.nullThreshold,
      scores: input.summary.clusters.map((cluster) => (
        cluster.y - cluster.a * input.nullThreshold
      )),
      purposeSeedSha256,
    }, input.bootstrapReplicates);
    if (!Number.isFinite(observedStatistic) || !values) {
      return { status: 'not_evaluable', blocker: 'bootstrap_replicate_invalid' };
    }
    const exceedances = values.filter((value) => input.direction === 'greater'
      ? value >= observedStatistic
      : value <= observedStatistic).length;
    const preimage = {
      direction: input.direction,
      alternative,
      nullThreshold: input.nullThreshold,
      observedStatistic,
      pValue: (1 + exceedances) / (input.bootstrapReplicates + 1),
      bootstrapPurpose: DIRECTIONAL_THRESHOLD_TEST_V2,
      domainSeparator: DIRECTIONAL_THRESHOLD_DOMAIN_V2,
      pValueDefinitionVersion: DIRECTIONAL_P_VALUE_VERSION_V1,
      bootstrapReplicates: input.bootstrapReplicates,
      purposeSeedSha256,
      inputSha256: input.inputSha256,
      scoreSummarySha256: digest(input.summary),
    };
    return { status: 'evaluated', ...preimage, thresholdTestSha256: digest(preimage) };
  } catch {
    return { status: 'not_evaluable', blocker: 'directional_test_contract_invalid' };
  }
}

export function directionalTestResolutionV2(input: DirectionalTestResolutionInputV2):
  | { status: 'reachable'; minimumPValue: number; firstThreshold: number }
  | { status: 'not_evaluable'; blocker: 'directional_test_resolution_insufficient' } {
  const valid = Number.isSafeInteger(input.bootstrapReplicates)
    && input.bootstrapReplicates > 0
    && input.bootstrapReplicates <= DIRECTIONAL_TEST_RESOURCE_LIMITS_V2.maximumBootstrapReplicates
    && Number.isFinite(input.familyAlpha)
    && input.familyAlpha > 0
    && input.familyAlpha < 1
    && Number.isSafeInteger(input.hypothesisCount)
    && input.hypothesisCount > 0
    && (input.procedure === HOLM_STEP_DOWN_V1
      || input.procedure === INTERSECTION_UNION_ALL_MUST_PASS_V1);
  if (!valid) {
    return { status: 'not_evaluable', blocker: 'directional_test_resolution_insufficient' };
  }
  const minimumPValue = 1 / (input.bootstrapReplicates + 1);
  const firstThreshold = input.procedure === HOLM_STEP_DOWN_V1
    ? input.familyAlpha / input.hypothesisCount
    : input.familyAlpha;
  return minimumPValue <= firstThreshold
    ? { status: 'reachable', minimumPValue, firstThreshold }
    : { status: 'not_evaluable', blocker: 'directional_test_resolution_insufficient' };
}

function validInput(input: ThresholdBootstrapInputV2): boolean {
  return Boolean(input.summary)
    && Number.isFinite(input.nullThreshold)
    && (input.direction === 'greater' || input.direction === 'less')
    && Number.isSafeInteger(input.bootstrapReplicates)
    && input.bootstrapReplicates > 0
    && input.bootstrapReplicates <= DIRECTIONAL_TEST_RESOURCE_LIMITS_V2.maximumBootstrapReplicates
    && Number.isSafeInteger(input.summary.clusters.length * input.bootstrapReplicates)
    && input.summary.clusters.length * input.bootstrapReplicates
      <= DIRECTIONAL_TEST_RESOURCE_LIMITS_V2.maximumBootstrapWorkUnits
    && input.seedMaterial.length >= 16
    && /^[0-9a-f]{64}$/.test(input.inputSha256)
    && input.segment.length > 0;
}

function purposeSeed(
  input: ThresholdBootstrapInputV2,
  alternative: DirectionalAlternativeV2,
): string {
  return createHash('sha256')
    .update(DIRECTIONAL_THRESHOLD_DOMAIN_V2)
    .update('\0').update(input.seedMaterial)
    .update('\0').update(input.inputSha256)
    .update('\0').update(input.summary.estimator)
    .update('\0').update(input.segment)
    .update('\0').update(input.direction)
    .update('\0').update(alternative)
    .update('\0').update(canonicalDecisionJson(input.nullThreshold))
    .digest('hex');
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}
