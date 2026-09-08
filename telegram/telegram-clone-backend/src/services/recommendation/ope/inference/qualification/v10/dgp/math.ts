import {
  MULTIWAY_DGP_ACTIONS_V2,
  MULTIWAY_DGP_COMMON_TIME_SHOCK_SCALES_V2,
  MULTIWAY_DGP_G_V2,
  MULTIWAY_DGP_PROBABILITIES_V2,
  MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2,
  MULTIWAY_DGP_RESOURCE_LIMITS_V2,
  MULTIWAY_DGP_SCENARIO_IDS_V2,
  MULTIWAY_DGP_SHOCK_SCALES_V2,
  MULTIWAY_DGP_SLOTS_V2,
  MULTIWAY_DGP_SUPPORT_ACTIONS_V2,
  type FrozenMultiwayDgpScenarioV2,
  type MultiwayDgpAxisV2,
  type MultiwayDgpBehaviorPolicyV2,
  type MultiwayDgpProbabilityVectorV2,
  type MultiwayDgpResourcePlanV2,
  type MultiwayDgpShockScalesV2,
} from './contracts';

export type MultiwayDgpShockVectorV2 = Readonly<{
  viewer: number;
  time: number;
  cell: number;
  decision: number;
}>;

export const ZERO_MULTIWAY_DGP_SHOCK_V2: MultiwayDgpShockVectorV2 = Object.freeze({
  viewer: 0,
  time: 0,
  cell: 0,
  decision: 0,
});

export function probabilityVectorV2(
  policy: FrozenMultiwayDgpScenarioV2['targetPolicy'] | MultiwayDgpBehaviorPolicyV2,
): MultiwayDgpProbabilityVectorV2 {
  if (policy === 'positive') return MULTIWAY_DGP_PROBABILITIES_V2.positive;
  if (policy === 'negative') return MULTIWAY_DGP_PROBABILITIES_V2.negative;
  if (policy === 'spiky') return MULTIWAY_DGP_PROBABILITIES_V2.spiky;
  if (policy === 'near_zero') return MULTIWAY_DGP_PROBABILITIES_V2.nearZero;
  if (policy === 'uniform') return MULTIWAY_DGP_PROBABILITIES_V2.uniform;
  throw new Error('multiway_dgp_policy_invalid');
}

export function rotateProbabilityV2(
  base: MultiwayDgpProbabilityVectorV2,
  firstAction: number,
): MultiwayDgpProbabilityVectorV2 {
  if (!validAction(firstAction)) throw new Error('multiway_dgp_action_invalid');
  return [
    base[firstAction]!,
    base[(firstAction + 1) % 4]!,
    base[(firstAction + 2) % 4]!,
    base[(firstAction + 3) % 4]!,
  ];
}

export function behaviorProbabilityV2(
  scenario: FrozenMultiwayDgpScenarioV2,
  viewerIndex: number,
): MultiwayDgpProbabilityVectorV2 {
  if (!Number.isSafeInteger(viewerIndex) || viewerIndex < 0 || viewerIndex >= scenario.g) {
    throw new Error('multiway_dgp_viewer_invalid');
  }
  if (scenario.behaviorPolicy === 'near_zero') return MULTIWAY_DGP_PROBABILITIES_V2.nearZero;
  if (scenario.behaviorPolicy === 'spiky') return MULTIWAY_DGP_PROBABILITIES_V2.spiky;
  if (scenario.behaviorPolicy === 'viewer_imbalance' && viewerIndex === 0) {
    return MULTIWAY_DGP_PROBABILITIES_V2.spiky;
  }
  if (scenario.behaviorPolicy === 'uniform' || scenario.behaviorPolicy === 'viewer_imbalance') {
    return MULTIWAY_DGP_PROBABILITIES_V2.uniform;
  }
  throw new Error('multiway_dgp_behavior_policy_invalid');
}

export function targetProbabilityV2(
  scenario: FrozenMultiwayDgpScenarioV2,
): MultiwayDgpProbabilityVectorV2 {
  return probabilityVectorV2(scenario.targetPolicy);
}

export function centeredShockV2(uniform53: number): number {
  if (!Number.isFinite(uniform53) || uniform53 < 0 || uniform53 >= 1) {
    throw new Error('multiway_dgp_uniform_invalid');
  }
  return uniform53 < 0.5 ? -1 : 1;
}

export function shockOffsetV2(
  scales: MultiwayDgpShockScalesV2,
  shocks: MultiwayDgpShockVectorV2 = ZERO_MULTIWAY_DGP_SHOCK_V2,
): number {
  const offset = scales.viewer * shocks.viewer
    + scales.time * shocks.time
    + scales.cell * shocks.cell
    + scales.decision * shocks.decision;
  if (!Number.isFinite(offset) || Math.abs(offset) > scales.total + 1e-12) {
    throw new Error('multiway_dgp_shock_invalid');
  }
  return offset;
}

export function meanRewardV2(
  scenario: FrozenMultiwayDgpScenarioV2,
  slot: 1 | 2,
  firstAction: number,
  action: number,
  shocks: MultiwayDgpShockVectorV2 = ZERO_MULTIWAY_DGP_SHOCK_V2,
): number {
  if ((slot !== 1 && slot !== 2) || !validAction(firstAction) || !validAction(action)) {
    throw new Error('multiway_dgp_mu_input_invalid');
  }
  const utilityIndex = slot === 1 ? action : (firstAction + action) % 4;
  const mu = 0.5 + 0.1 * MULTIWAY_DGP_G_V2[utilityIndex]!
    + shockOffsetV2(scenario.shockScales, shocks);
  // The frozen scale is selected so this assertion can never require clamping.
  if (!Number.isFinite(mu) || mu < 0.25 || mu > 0.75) {
    throw new Error('multiway_dgp_mu_out_of_range');
  }
  return mu;
}

export function qHatValuesV2(
  scenario: FrozenMultiwayDgpScenarioV2,
  slot: 1 | 2,
  firstAction: number,
  shocks: MultiwayDgpShockVectorV2 = ZERO_MULTIWAY_DGP_SHOCK_V2,
): MultiwayDgpProbabilityVectorV2 {
  if (scenario.qHatMode === 'constant_0_5_v2') return [0.5, 0.5, 0.5, 0.5];
  if (scenario.qHatMode !== 'oracle_v2') throw new Error('multiway_dgp_qhat_mode_invalid');
  return MULTIWAY_DGP_ACTIONS_V2.map((action) => meanRewardV2(
    scenario,
    slot,
    firstAction,
    action,
    shocks,
  )) as unknown as MultiwayDgpProbabilityVectorV2;
}

/**
 * The truth is a finite 4x4 target-trajectory sum.  Every shock factor has
 * expectation zero, so only the base utility enters this deterministic sum.
 */
export function deriveKnownTruthFromDgpV2(
  scenario: FrozenMultiwayDgpScenarioV2,
): number {
  const target = targetProbabilityV2(scenario);
  let total = 0;
  for (const firstAction of MULTIWAY_DGP_ACTIONS_V2) {
    const secondTarget = rotateProbabilityV2(target, firstAction);
    for (const secondAction of MULTIWAY_DGP_ACTIONS_V2) {
      const trajectoryProbability = target[firstAction]! * secondTarget[secondAction]!;
      const firstMu = meanRewardV2(scenario, 1, 0, firstAction);
      const secondMu = meanRewardV2(scenario, 2, firstAction, secondAction);
      total += trajectoryProbability * (firstMu + secondMu) / 2;
    }
  }
  return Number(total.toFixed(15));
}

export const deriveKnownTruthV2 = deriveKnownTruthFromDgpV2;
export const knownTruthFromTargetTrajectoryV2 = deriveKnownTruthFromDgpV2;

export function scenarioInventoryV2(): readonly FrozenMultiwayDgpScenarioV2[] {
  const raw: Array<Omit<FrozenMultiwayDgpScenarioV2, 'knownTruth'>> = [
    scenario('axis', 'g_axis', 'g', 8, 2, 2, 'uniform', 'uniform', 'oracle_v2', false, 'null'),
    scenario('axis', 'h_axis', 'h', 2, 8, 2, 'uniform', 'uniform', 'oracle_v2', false, 'null'),
    scenario('axis', 'r_axis', 'r', 2, 2, 8, 'uniform', 'uniform', 'oracle_v2', false, 'null'),
    scenario('balanced', 'balanced_positive', null, 2, 2, 2, 'uniform', 'positive', 'oracle_v2', false, 'beneficial'),
    scenario('balanced', 'balanced_null', null, 2, 2, 2, 'uniform', 'uniform', 'oracle_v2', false, 'null'),
    scenario('balanced', 'balanced_harmful', null, 2, 2, 2, 'uniform', 'negative', 'oracle_v2', false, 'harmful'),
    scenario('stress', 'viewer_imbalance', null, 4, 2, 2, 'viewer_imbalance', 'uniform', 'oracle_v2', false, 'null', 'first_viewer_double'),
    scenario('stress', 'near_zero_propensity_heavy_prefix', null, 2, 2, 2, 'near_zero', 'uniform', 'oracle_v2', false, 'null'),
    scenario('stress', 'qhat_misspecification', null, 2, 2, 2, 'uniform', 'uniform', 'constant_0_5_v2', false, 'null'),
    scenario('stress', 'common_time_shock', null, 4, 4, 2, 'uniform', 'uniform', 'oracle_v2', true, 'null'),
  ];
  return Object.freeze(raw.map((item) => Object.freeze({
    ...item,
    knownTruth: deriveKnownTruthFromDgpV2(item as FrozenMultiwayDgpScenarioV2),
  })));
}

export function deriveMultiwayDgpResourcePlanV2(
  scenarios: readonly FrozenMultiwayDgpScenarioV2[] = scenarioInventoryV2(),
): MultiwayDgpResourcePlanV2 {
  const limits = MULTIWAY_DGP_RESOURCE_LIMITS_V2;
  const scenarioRecordCounts: number[] = [];
  const scenarioDecisionCounts: number[] = [];
  const scenarioSlotCounts: number[] = [];
  const scenarioCellCounts: number[] = [];
  const scenarioViewerCounts: number[] = [];
  const scenarioTimeCounts: number[] = [];
  let plannedRecordCount = 0;
  let plannedBytesUpperBound = 0;
  let hashWorkUnits = 0;
  let actionDrawWorkUnits = 0;
  let actionSelectionComparisonWorkUnits = 0;
  let rewardDrawWorkUnits = 0;
  let qHatEvaluationWorkUnits = 0;
  let scoreWorkUnits = 0;
  let aggregationWorkUnits = 0;

  for (const candidate of scenarios) {
    const viewerCount = candidate.g;
    const timeCount = candidate.h;
    const cellCount = viewerCount * timeCount;
    const recordsPerViewer = candidate.viewerRecordMultipliers.map((multiplier) => (
      candidate.baseR * multiplier
    ));
    const decisionCount = timeCount * recordsPerViewer.reduce((sum, count) => sum + count, 0);
    const slotCount = decisionCount * candidate.slots;
    const recordsPerReplication = 2 + slotCount + decisionCount + cellCount + viewerCount + timeCount;
    const replicated = recordsPerReplication * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
    const actionDraws = slotCount * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
    const actionSelectionComparisons = slotCount * MULTIWAY_DGP_SUPPORT_ACTIONS_V2
      * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
    const rewardDraws = actionDraws;
    const qHatEvaluations = slotCount * MULTIWAY_DGP_SUPPORT_ACTIONS_V2
      * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
    const scoreCalls = slotCount * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
    const aggregation = (5 * slotCount + decisionCount + cellCount + viewerCount + timeCount + 1)
      * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
    const hashCallsPerReplication = 10 + viewerCount + timeCount + cellCount + 5 * decisionCount;
    const hash = hashCallsPerReplication * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
    scenarioRecordCounts.push(replicated);
    scenarioDecisionCounts.push(decisionCount * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2);
    scenarioSlotCounts.push(slotCount * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2);
    scenarioCellCounts.push(cellCount * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2);
    scenarioViewerCounts.push(viewerCount * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2);
    scenarioTimeCounts.push(timeCount * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2);
    plannedRecordCount += replicated;
    plannedBytesUpperBound += replicated * limits.maximumCanonicalRecordBytes;
    hashWorkUnits += hash;
    actionDrawWorkUnits += actionDraws;
    actionSelectionComparisonWorkUnits += actionSelectionComparisons;
    rewardDrawWorkUnits += rewardDraws;
    qHatEvaluationWorkUnits += qHatEvaluations;
    scoreWorkUnits += scoreCalls;
    aggregationWorkUnits += aggregation;
  }

  const generatorPrimitiveWorkUnits = hashWorkUnits + actionDrawWorkUnits
    + actionSelectionComparisonWorkUnits + rewardDrawWorkUnits
    + qHatEvaluationWorkUnits + scoreWorkUnits + aggregationWorkUnits;
  return Object.freeze({
    scenarioCount: scenarios.length,
    replicationsPerScenario: MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2,
    totalReplications: scenarios.length * MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2,
    scenarioRecordCounts: Object.freeze(scenarioRecordCounts),
    scenarioDecisionCounts: Object.freeze(scenarioDecisionCounts),
    scenarioSlotCounts: Object.freeze(scenarioSlotCounts),
    scenarioCellCounts: Object.freeze(scenarioCellCounts),
    scenarioViewerCounts: Object.freeze(scenarioViewerCounts),
    scenarioTimeCounts: Object.freeze(scenarioTimeCounts),
    plannedRecordCount,
    plannedBytesUpperBound,
    hashWorkUnits,
    actionDrawWorkUnits,
    actionSelectionComparisonWorkUnits,
    rewardDrawWorkUnits,
    qHatEvaluationWorkUnits,
    scoreWorkUnits,
    aggregationWorkUnits,
    generatorPrimitiveWorkUnits,
    maximumGeneratorPrimitiveWorkUnits: limits.maximumGeneratorPrimitiveWorkUnits,
    maximumHashWorkUnits: limits.maximumHashWorkUnits,
    maximumActionDrawWorkUnits: limits.maximumActionDrawWorkUnits,
    maximumActionSelectionComparisonWorkUnits: limits.maximumActionSelectionComparisonWorkUnits,
    maximumRewardDrawWorkUnits: limits.maximumRewardDrawWorkUnits,
    maximumQHatEvaluationWorkUnits: limits.maximumQHatEvaluationWorkUnits,
    maximumScoreWorkUnits: limits.maximumScoreWorkUnits,
    maximumAggregationWorkUnits: limits.maximumAggregationWorkUnits,
    maximumQualificationRecords: limits.maximumQualificationRecords,
    maximumQualificationBytes: limits.maximumQualificationBytes,
    maximumCanonicalRecordBytes: limits.maximumCanonicalRecordBytes,
  });
}

export const resourcePlanV2 = deriveMultiwayDgpResourcePlanV2;

export function selectActionV2(
  probabilities: MultiwayDgpProbabilityVectorV2,
  uniform53: number,
): number {
  if (!Number.isFinite(uniform53) || uniform53 < 0 || uniform53 >= 1) {
    throw new Error('multiway_dgp_uniform_invalid');
  }
  let cumulative = 0;
  let selected = 3;
  let found = false;
  for (const action of MULTIWAY_DGP_ACTIONS_V2) {
    cumulative += probabilities[action]!;
    const crossed = uniform53 < cumulative;
    if (!found && crossed) {
      selected = action;
      found = true;
    }
  }
  return selected;
}

function scenario(
  scenarioKind: FrozenMultiwayDgpScenarioV2['scenarioKind'],
  scenarioId: FrozenMultiwayDgpScenarioV2['scenarioId'],
  axis: MultiwayDgpAxisV2,
  g: number,
  h: number,
  r: number,
  behaviorPolicy: FrozenMultiwayDgpScenarioV2['behaviorPolicy'],
  targetPolicy: FrozenMultiwayDgpScenarioV2['targetPolicy'],
  qHatMode: FrozenMultiwayDgpScenarioV2['qHatMode'],
  commonTimeShock: boolean,
  truthClass: FrozenMultiwayDgpScenarioV2['truthClass'],
  imbalanceProfile: FrozenMultiwayDgpScenarioV2['viewerImbalanceProfile'] = 'base_r',
): Omit<FrozenMultiwayDgpScenarioV2, 'knownTruth'> {
  const scales = commonTimeShock
    ? MULTIWAY_DGP_COMMON_TIME_SHOCK_SCALES_V2
    : MULTIWAY_DGP_SHOCK_SCALES_V2;
  return {
    scenarioKind,
    scenarioId,
    axis,
    g,
    h,
    r,
    slots: MULTIWAY_DGP_SLOTS_V2,
    baseR: r,
    viewerRecordMultipliers: Object.freeze(Array.from({ length: g }, (_, index) => (
      imbalanceProfile === 'first_viewer_double' && index === 0 ? 2 : 1
    ))),
    viewerImbalanceProfile: imbalanceProfile,
    behaviorPolicy,
    targetPolicy,
    qHatMode,
    shockScales: scales,
    commonTimeShock,
    stressEvidenceScope: scenarioId === 'near_zero_propensity_heavy_prefix'
      ? 'analytical_support_envelope_only'
      : 'generated_distribution',
    threshold: 0.5,
    direction: 'greater',
    truthClass,
  };
}

function validAction(value: number): value is 0 | 1 | 2 | 3 {
  return Number.isSafeInteger(value) && value >= 0 && value < 4;
}

// Keep the import visibly used in the contract check below without exporting V1 symbols.
void MULTIWAY_DGP_SCENARIO_IDS_V2;
void MULTIWAY_DGP_RESOURCE_LIMITS_V2;
