import type { ClusterScoreV1 } from '../../contracts';

export const FROZEN_INFERENCE_QUALIFICATION_PROTOCOL_V1 =
  'frozen_inference_qualification_protocol_v1' as const;
export const VERIFIED_SYNTHETIC_CLUSTER_SCORE_REPLICATION_V1 =
  'verified_synthetic_cluster_score_replication_v1' as const;
export const SYNTHETIC_SEQUENTIAL_DR_DGP_V1 = 'synthetic_sequential_dr_dgp_v1' as const;
export const SYNTHETIC_SEQUENTIAL_DR_CLUSTER_SCORE_V1 =
  'synthetic_sequential_dr_cluster_score_v1' as const;
export const PHASE12_REPLICATION_SEED_VERSION_V1 =
  'phase12_synthetic_replication_seed_v1' as const;
export const PHASE12_METRIC_DENOMINATOR_V1 =
  'equal_weight_frozen_scenario_mixture_v1' as const;
export const PHASE12_QUALIFICATION_RESULT_V1 =
  'synthetic_inference_qualification_result_v1' as const;

export const PHASE12_ACTIONS_V1 = Object.freeze([0, 1, 2, 3] as const);
export const PHASE12_G_V1 = Object.freeze([-1.5, -0.5, 0.5, 1.5] as const);
export const PHASE12_PROBABILITIES_V1 = Object.freeze({
  uniform: Object.freeze([0.25, 0.25, 0.25, 0.25] as const),
  positive: Object.freeze([0.10, 0.20, 0.30, 0.40] as const),
  negative: Object.freeze([0.40, 0.30, 0.20, 0.10] as const),
  spiky: Object.freeze([0.97, 0.01, 0.01, 0.01] as const),
  nearZero: Object.freeze([0.9997, 0.0001, 0.0001, 0.0001] as const),
} as const);

export const PHASE12_CRITICAL_SCENARIO_IDS_V1 = Object.freeze([
  'nominal_positive',
  'nominal_null',
  'harmful_policy',
  'prefix_weight_heavy_tail',
  'viewer_cluster_imbalance',
  'few_clusters',
  'near_zero_propensity',
  'synthetic_dr_score_misspecification',
] as const);

export type Phase12CriticalScenarioIdV1 = typeof PHASE12_CRITICAL_SCENARIO_IDS_V1[number];
export type Phase12ProbabilityVectorV1 = readonly [number, number, number, number];
export type Phase12BehaviorPolicyV1 = 'uniform' | 'spiky' | 'near_zero' | 'viewer_imbalance';
export type Phase12TargetPolicyV1 = 'uniform' | 'positive' | 'negative';
export type Phase12QHatModeV1 = 'oracle_v1' | 'constant_0_5_v1';

export type FrozenSyntheticScenarioV1 = {
  scenarioKind: 'critical';
  scenarioId: Phase12CriticalScenarioIdV1;
  clusterCount: 2 | 4;
  behaviorPolicy: Phase12BehaviorPolicyV1;
  targetPolicy: Phase12TargetPolicyV1;
  qHatMode: Phase12QHatModeV1;
  shockScale: 0.05 | 0.1;
  knownTruth: number;
  threshold: 0.5;
  direction: 'greater';
  truthClass: 'beneficial' | 'null' | 'harmful';
};

export type Phase12QualificationResourcesV1 = {
  criticalClusterCounts: readonly [4, 4, 4, 4, 4, 2, 4, 4];
  criticalReplicationsPerScenario: 117;
  assumptionControlKinds: 4;
  assumptionReplicationsPerKind: 8;
  invalidControlReplications: 1;
  invalidControlClusters: 2;
  criticalClusterScores: 3_510;
  totalClusterScores: 3_512;
  qHatEvaluations: 28_080;
  bootstrapWorkUnits: 892_048;
  generatorPrimitiveWorkUnits: 108_812;
  plannedRecordCount: 5_420;
  plannedBytesUpperBound: 22_205_740;
  maximumGeneratorPrimitiveWorkUnits: 131_072;
  maximumBootstrapWorkUnits: 1_000_000;
  maximumQualificationRecords: 8_192;
  maximumQualificationBytes: 33_554_432;
  maximumCanonicalRecordBytes: 4_096;
};

export type Phase12QualificationReachabilityV1 = {
  gateCount: 3;
  monteCarloErrorBudget: 0.05;
  coverageDenominator: 936;
  falsePromotionDenominator: 819;
  invalidRateDenominator: 936;
  minimumCoverage: 0.95;
  maximumFalsePromotionRate: 0.05;
  maximumInvalidReplicateRate: 0.05;
  coverageMargin: number;
  falsePromotionMargin: number;
  invalidRateMargin: number;
  bestCaseCoverageLowerBound: number;
  bestCaseFalsePromotionUpperBound: number;
  bestCaseInvalidRateUpperBound: number;
  reachable: boolean;
};

export type FrozenInferenceQualificationProtocolV1 = {
  contractVersion: typeof FROZEN_INFERENCE_QUALIFICATION_PROTOCOL_V1;
  protocolId: string;
  dgpVersion: typeof SYNTHETIC_SEQUENTIAL_DR_DGP_V1;
  scoreGeneratorVersion: typeof SYNTHETIC_SEQUENTIAL_DR_CLUSTER_SCORE_V1;
  seedDerivationVersion: typeof PHASE12_REPLICATION_SEED_VERSION_V1;
  generatorSeedMaterial: string;
  bootstrapSeedMaterial: string;
  bootstrapReplicates: 127;
  confidenceLevel: 0.95;
  familyAlpha: 0.05;
  metricDenominatorVersion: typeof PHASE12_METRIC_DENOMINATOR_V1;
  scenarios: readonly FrozenSyntheticScenarioV1[];
  assumptionControlKinds: readonly [
    'viewer_dependence',
    'unhandled_time_shock',
    'propensity_bound_unverified',
    'adaptive_selection_holdout_reuse',
  ];
  resources: Phase12QualificationResourcesV1;
  reachability: Phase12QualificationReachabilityV1;
  selectionRule: 'diagnostics_only_abstention_v1';
  frozenAt: string;
  realDatasetEligible: false;
  protocolSha256: string;
};

export type VerifiedSyntheticClusterScoreReplicationV1 = {
  contractVersion: typeof VERIFIED_SYNTHETIC_CLUSTER_SCORE_REPLICATION_V1;
  protocolSha256: string;
  scenarioKind: 'critical';
  scenarioId: Phase12CriticalScenarioIdV1;
  replicationIndex: number;
  replicationSeedSha256: string;
  scoreGeneratorVersion: typeof SYNTHETIC_SEQUENTIAL_DR_CLUSTER_SCORE_V1;
  estimator: 'dr';
  qHatMode: Phase12QHatModeV1;
  slotsPerCluster: 2;
  supportActionsPerSlot: 4;
  knownTruth: number;
  clusterScores: readonly ClusterScoreV1[];
  realDatasetEligible: false;
  servable: false;
  canMintVerifiedPredictionStepV2: false;
  replicationSha256: string;
};

export type SyntheticInferenceQualificationResultV1 = {
  contractVersion: typeof PHASE12_QUALIFICATION_RESULT_V1;
  candidateStatus: 'synthetic_mixture_gates_passed' | 'failed' | 'not_evaluable';
  selectedMethod: 'diagnostics_only_abstention_v1';
  realDatasetEligible: false;
  blockers: string[];
  protocolSha256: string | null;
  metrics: {
    coverageSuccesses: number;
    coverageDenominator: number;
    coverageLowerBound: number | null;
    falsePromotions: number;
    falsePromotionDenominator: number;
    falsePromotionUpperBound: number | null;
    invalidReplicates: number;
    invalidRateDenominator: number;
    invalidRateUpperBound: number | null;
  };
  diagnostics: {
    resources: Phase12QualificationResourcesV1 & {
      actualRecordCount: number;
      actualClusterScoreCount: number;
      actualBootstrapWorkUnits: number;
    };
    artifactSha256: string | null;
    peakBufferedClusters: number;
  };
  qualificationSha256: string;
};
