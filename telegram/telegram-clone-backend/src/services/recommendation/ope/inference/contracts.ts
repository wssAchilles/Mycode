import { z } from 'zod';

export const ROBUST_INFERENCE_CONFIG_V1 = 'robust_inference_experimental_config_v1' as const;
export const ROBUST_INFERENCE_METHOD_V1 = 'cluster_score_multiplier_bootstrap_t_v1' as const;
export const FROZEN_HYPOTHESIS_MANIFEST_V1 = 'frozen_ope_hypothesis_manifest_v1' as const;
export const THRESHOLD_BOOTSTRAP_DOMAIN_V1 = 'ope_threshold_test_bootstrap_v1' as const;
export const DIAGNOSTIC_CI_BOOTSTRAP_DOMAIN_V1 = 'ope_diagnostic_ci_bootstrap_v1' as const;
export const DIAGNOSTICS_ONLY_ABSTENTION_V1 = 'diagnostics_only_abstention_v1' as const;
export const HYPOTHESIS_SEAL_RECEIPT_V1 = 'frozen_hypothesis_seal_receipt_v1' as const;
export const VERIFIED_HYPOTHESIS_SEAL_V1 = 'verified_frozen_hypothesis_seal_v1' as const;
export const ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1 = 'robust_inference_synthetic_ablation_v1' as const;
export const ROBUST_INFERENCE_SINGLE_COHORT_DIAGNOSTICS_V1 = 'robust_inference_single_cohort_diagnostics_v1' as const;
export const SYNTHETIC_ABLATION_LIMITS_V1 = Object.freeze({ maxScenarios: 32, maxAggregateBootstrapWorkUnits: 1_000_000 } as const);

const text = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const timestamp = z.string().datetime({ offset: true });

export const robustInferenceExperimentalConfigV1Schema = z.object({
  contractVersion: z.literal(ROBUST_INFERENCE_CONFIG_V1),
  configVersion: text,
  method: z.literal(ROBUST_INFERENCE_METHOD_V1),
  bootstrapReplicates: z.number().int().min(1).max(100_000),
  maximumBootstrapWorkUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  confidenceLevel: finite.gt(0).lt(1),
  minimumClusters: z.number().int().min(2).max(100_000),
  minimumClusterEss: finite.positive(),
  maximumScoreShare: finite.gt(0).lte(1),
  selfNormalizedBoundAssumptions: z.discriminatedUnion('status', [
    z.object({ status: z.literal('unavailable') }).strict(),
    z.object({
      status: z.literal('declared_for_synthetic_audit'),
      propensityFloor: finite.gt(0).lte(1),
      maximumImportanceWeight: finite.positive(),
      independentClusterJustificationSha256: sha256,
    }).strict(),
  ]),
}).strict();

export const frozenOpeHypothesisManifestV1Schema = z.object({
  contractVersion: z.literal(FROZEN_HYPOTHESIS_MANIFEST_V1),
  hypothesisId: text,
  objective: text,
  estimator: z.enum(['ips', 'clippedIps', 'snips', 'dr']),
  segment: text,
  threshold: finite,
  bootstrapSeedMaterial: z.string().min(16).max(512),
  inferenceConfigSha256: sha256,
  syntheticScenarioSetSha256: sha256,
  frozenAt: timestamp,
  manifestSha256: sha256,
}).strict();

export const syntheticAblationScenarioDescriptorV1Schema = z.object({
  scenarioId: text,
  scenarioKind: z.enum(['heavy_tail', 'nominal', 'null', 'invalid_studentizer']),
  knownTruth: finite,
  threshold: finite,
  promotionOperator: z.enum(['gte', 'lte']),
  projectionSha256: sha256,
}).strict();

export const syntheticAblationGatesV1Schema = z.object({
  minimumNominalCoverage: finite.min(0).max(1),
  maximumFalsePromotionRate: finite.min(0).max(1),
  maximumInvalidReplicateRate: finite.min(0).max(1),
}).strict();

export const syntheticAblationPlanV1Schema = z.object({
  contractVersion: z.literal(ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1),
  gates: syntheticAblationGatesV1Schema,
  scenarios: z.array(syntheticAblationScenarioDescriptorV1Schema).min(2).max(SYNTHETIC_ABLATION_LIMITS_V1.maxScenarios),
}).strict();

export type RobustInferenceExperimentalConfigV1 = z.infer<typeof robustInferenceExperimentalConfigV1Schema>;
export type FrozenOpeHypothesisManifestV1 = z.infer<typeof frozenOpeHypothesisManifestV1Schema>;
export type ExperimentalEstimatorV1 = FrozenOpeHypothesisManifestV1['estimator'];
export type SyntheticAblationPlanV1 = z.infer<typeof syntheticAblationPlanV1Schema>;

export type ClusterScoreV1 = {
  inferenceClusterId: string;
  y: number;
  a: number;
  importanceMass: number;
};
export type ClusterScoreSummaryV1 = {
  estimator: ExperimentalEstimatorV1;
  thetaHat: number;
  a: number;
  clusters: Array<ClusterScoreV1 & { score: number }>;
  standardError: number;
  clusterEss: number;
  maximumScoreShare: number;
};

export type ExperimentalBootstrapResultV1 = {
  contractVersion: 'experimental_cluster_bootstrap_t_result_v1';
  status: 'evaluated' | 'not_evaluable';
  blockers: string[];
  estimator: ExperimentalEstimatorV1;
  realDatasetEligible: false;
  diagnostics: {
    clusterCount: number;
    clusterEss: number | null;
    maximumScoreShare: number | null;
    bootstrapReplicates: number;
  };
  thresholdTest: null | {
    threshold: number;
    observedStatistic: number;
    pValue: number;
    purposeSeedSha256: string;
    thresholdTestSha256: string;
  };
  diagnosticCi: null | {
    level: number;
    lower: number;
    upper: number;
    standardError: number;
    lowerQuantile: number;
    upperQuantile: number;
    purposeSeedSha256: string;
    diagnosticCiSha256: string;
  };
};
