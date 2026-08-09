import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { evaluateOpeV2 } from '../v2/evaluate';
import { isVerifiedProjectedOpeInputV2, type VerifiedProjectedOpeInputV2 } from '../v2/project';
import {
  DIAGNOSTICS_ONLY_ABSTENTION_V1,
  ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1,
  SYNTHETIC_ABLATION_LIMITS_V1,
  robustInferenceExperimentalConfigV1Schema,
  syntheticAblationPlanV1Schema,
  type RobustInferenceExperimentalConfigV1,
  type SyntheticAblationPlanV1,
} from './contracts';
import { evaluateExperimentalClusterInferenceV1 } from './evaluate';
import { isVerifiedFrozenHypothesisSealV1, type VerifiedFrozenHypothesisSealV1 } from './hypothesisSeal';

export type SyntheticAblationScenarioV1 = SyntheticAblationPlanV1['scenarios'][number] & {
  projection: VerifiedProjectedOpeInputV2;
};

export type SyntheticAblationInputV1 = {
  config: RobustInferenceExperimentalConfigV1;
  hypothesisEvidence: VerifiedFrozenHypothesisSealV1;
  gates: SyntheticAblationPlanV1['gates'];
  scenarios: SyntheticAblationScenarioV1[];
};

export function evaluateRobustInferenceSyntheticAblationV1(input: unknown) {
  try {
  const raw = record(input);
  if (!raw || !isVerifiedFrozenHypothesisSealV1(raw.hypothesisEvidence)) return blocked(['hypothesis_seal_trust_root_unavailable']);
  const config = robustInferenceExperimentalConfigV1Schema.safeParse(raw.config);
  if (!config.success || !Array.isArray(raw.scenarios)) return blocked(['synthetic_ablation_contract_invalid']);
  const scenarioInputs = raw.scenarios as Array<Record<string, any>>;
  if (scenarioInputs.some((scenario) => !isVerifiedProjectedOpeInputV2(scenario?.projection))) return blocked(['unverified_projection']);
  const typedScenarios = scenarioInputs as SyntheticAblationScenarioV1[];
  if (typedScenarios.some((scenario) => scenario.projection.slots.some((slot) => slot.binding.realDatasetEligible))) return blocked(['hypothesis_seal_trust_root_unavailable']);
  if (typedScenarios.some((scenario) => scenario.projection.projectionReceipt.projectionSha256 !== scenario.projectionSha256)) return blocked(['synthetic_scenario_set_mismatch']);
  const plan = syntheticAblationPlanV1Schema.safeParse({
    contractVersion: ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1,
    gates: raw.gates,
    scenarios: typedScenarios.map(({ projection: _projection, ...descriptor }) => descriptor),
  });
  if (!plan.success) return blocked(['synthetic_ablation_contract_invalid']);
  if (digest(plan.data) !== raw.hypothesisEvidence.hypothesis.syntheticScenarioSetSha256) return blocked(['synthetic_scenario_set_mismatch']);
  const workUnits = typedScenarios.reduce((total, scenario) => total + new Set(scenario.projection.slots.map((slot) => slot.binding.inferenceClusterId)).size * config.data.bootstrapReplicates * 2, 0);
  if (!Number.isSafeInteger(workUnits) || workUnits > SYNTHETIC_ABLATION_LIMITS_V1.maxAggregateBootstrapWorkUnits || workUnits > config.data.maximumBootstrapWorkUnits) return blocked(['resource_limit_exceeded']);

  const estimator = raw.hypothesisEvidence.hypothesis.estimator;
  const scenarios = typedScenarios.map((scenario) => {
    const bootstrap = evaluateExperimentalClusterInferenceV1({ projection: scenario.projection, config: config.data, hypothesisEvidence: raw.hypothesisEvidence });
    const wald = evaluateOpeV2(scenario.projection).confidenceIntervals[estimator];
    return { descriptor: stripProjection(scenario), bootstrap, wald };
  });
  const bootstrapMetrics = metrics(scenarios.map(({ descriptor, bootstrap }) => ({ descriptor, interval: bootstrap.diagnosticCi, blocker: bootstrap.status === 'not_evaluable' ? bootstrap.blockers[0] : undefined })));
  const waldMetrics = metrics(scenarios.map(({ descriptor, wald }) => ({ descriptor, interval: wald.status === 'evaluated' ? { lower: wald.lower, upper: wald.upper } : null, blocker: wald.status === 'unavailable' ? wald.reason : undefined })));
  const gateFailures = [
    bootstrapMetrics.nominalCoverage === null || bootstrapMetrics.nominalCoverage < plan.data.gates.minimumNominalCoverage ? 'synthetic_coverage_gate_failed' : undefined,
    bootstrapMetrics.falsePromotionRate === null || bootstrapMetrics.falsePromotionRate > plan.data.gates.maximumFalsePromotionRate ? 'synthetic_false_promotion_gate_failed' : undefined,
    bootstrapMetrics.invalidReplicateRate > plan.data.gates.maximumInvalidReplicateRate ? 'synthetic_invalid_replicate_gate_failed' : undefined,
    bootstrapMetrics.failedScenarioCount > bootstrapMetrics.invalidReplicateCount ? 'synthetic_scenario_evaluation_failed' : undefined,
  ].filter((value): value is string => Boolean(value));
  return {
    contractVersion: ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1,
    status: gateFailures.length === 0 ? 'completed' as const : 'failed_gates' as const,
    selectedMethod: DIAGNOSTICS_ONLY_ABSTENTION_V1,
    blockers: ['finite_sample_inference_unavailable', ...gateFailures],
    scenarioCount: scenarios.length,
    scenarioResults: scenarios,
    methods: {
      clusterMultiplierBootstrapT: bootstrapMetrics,
      clusteredWaldDiagnostic: waldMetrics,
      selfNormalizedTruncatedBoundAudit: config.data.selfNormalizedBoundAssumptions.status === 'unavailable'
        ? { status: 'not_applicable' as const, reason: 'required_bound_assumptions_unavailable' as const }
        : { status: 'assumptions_declared_only' as const, assumptions: config.data.selfNormalizedBoundAssumptions },
      abstention: { status: 'selected' as const, method: DIAGNOSTICS_ONLY_ABSTENTION_V1 },
    },
    gates: { configured: plan.data.gates, passed: gateFailures.length === 0, failures: gateFailures },
    realDatasetEligible: false as const,
  };
  } catch {
    return blocked(['synthetic_ablation_evaluation_failed']);
  }
}

function metrics(rows: Array<{ descriptor: Omit<SyntheticAblationScenarioV1, 'projection'>; interval: { lower: number; upper: number } | null; blocker?: string }>) {
  const valid = rows.filter((row) => row.interval !== null);
  const covered = valid.filter((row) => row.interval!.lower <= row.descriptor.knownTruth && row.descriptor.knownTruth <= row.interval!.upper).length;
  const falsePromotionEligible = valid.filter((row) => violatesThreshold(row.descriptor));
  const falsePromotions = falsePromotionEligible.filter((row) => promoted(row.descriptor, row.interval!)).length;
  const invalidReplicateCount = rows.filter((row) => row.blocker === 'bootstrap_replicate_invalid').length;
  return {
    evaluableScenarioCount: valid.length,
    coveredScenarioCount: covered,
    nominalCoverage: valid.length > 0 ? covered / valid.length : null,
    falsePromotionEligibleCount: falsePromotionEligible.length,
    falsePromotionCount: falsePromotions,
    falsePromotionRate: falsePromotionEligible.length > 0 ? falsePromotions / falsePromotionEligible.length : null,
    invalidReplicateCount,
    invalidReplicateRate: invalidReplicateCount / rows.length,
    failedScenarioCount: rows.length - valid.length,
  };
}

function violatesThreshold(descriptor: Omit<SyntheticAblationScenarioV1, 'projection'>): boolean {
  return descriptor.promotionOperator === 'gte' ? descriptor.knownTruth < descriptor.threshold : descriptor.knownTruth > descriptor.threshold;
}

function promoted(descriptor: Omit<SyntheticAblationScenarioV1, 'projection'>, interval: { lower: number; upper: number }): boolean {
  return descriptor.promotionOperator === 'gte' ? interval.lower >= descriptor.threshold : interval.upper <= descriptor.threshold;
}

function stripProjection(scenario: SyntheticAblationScenarioV1): Omit<SyntheticAblationScenarioV1, 'projection'> {
  const { projection: _projection, ...descriptor } = scenario;
  return descriptor;
}

function blocked(blockers: string[]) {
  return {
    contractVersion: ROBUST_INFERENCE_SYNTHETIC_ABLATION_V1,
    status: 'not_evaluable' as const,
    selectedMethod: DIAGNOSTICS_ONLY_ABSTENTION_V1,
    blockers: ['finite_sample_inference_unavailable', ...blockers],
    scenarioCount: 0,
    scenarioResults: [],
    methods: null,
    gates: null,
    realDatasetEligible: false as const,
  };
}

const digest = (value: unknown) => createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}
