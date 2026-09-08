import type { ClusterScoreSummaryV1 } from '../contracts';

export const DIRECTIONAL_THRESHOLD_TEST_V2 = 'directional_threshold_test_v2' as const;
export const DIRECTIONAL_THRESHOLD_DOMAIN_V2 = 'ope_directional_threshold_test_bootstrap_v2' as const;
export const DIRECTIONAL_P_VALUE_VERSION_V1 = 'add_one_inclusive_directional_tail_v1' as const;
export const HOLM_STEP_DOWN_V1 = 'holm_step_down_v1' as const;
export const INTERSECTION_UNION_ALL_MUST_PASS_V1 = 'intersection_union_all_must_pass_v1' as const;
export const DIRECTIONAL_TEST_RESOURCE_LIMITS_V2 = Object.freeze({
  maximumBootstrapReplicates: 100_000,
  maximumBootstrapWorkUnits: 1_000_000,
} as const);

export type DirectionalAlternativeV2 =
  | 'theta_greater_than_null_v1'
  | 'theta_less_than_null_v1';

export type ThresholdBootstrapInputV2 = {
  summary: ClusterScoreSummaryV1;
  nullThreshold: number;
  direction: 'greater' | 'less';
  bootstrapReplicates: number;
  seedMaterial: string;
  inputSha256: string;
  segment: string;
};

export type DirectionalThresholdTestResultV2 = {
  status: 'evaluated';
  direction: ThresholdBootstrapInputV2['direction'];
  alternative: DirectionalAlternativeV2;
  nullThreshold: number;
  observedStatistic: number;
  pValue: number;
  bootstrapPurpose: typeof DIRECTIONAL_THRESHOLD_TEST_V2;
  domainSeparator: typeof DIRECTIONAL_THRESHOLD_DOMAIN_V2;
  pValueDefinitionVersion: typeof DIRECTIONAL_P_VALUE_VERSION_V1;
  bootstrapReplicates: number;
  purposeSeedSha256: string;
  inputSha256: string;
  scoreSummarySha256: string;
  thresholdTestSha256: string;
};

export type DirectionalTestResolutionInputV2 = {
  bootstrapReplicates: number;
  familyAlpha: number;
  hypothesisCount: number;
  procedure: typeof HOLM_STEP_DOWN_V1 | typeof INTERSECTION_UNION_ALL_MUST_PASS_V1;
};
