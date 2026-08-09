import type { ClusterScoreV1 } from '../../../contracts';

export const FROZEN_MULTIWAY_DGP_PROTOCOL_V2 = 'frozen_multiway_dgp_protocol_v2' as const;
export const SYNTHETIC_MULTIWAY_DR_DGP_V2 = 'synthetic_multiway_dr_dgp_v2' as const;
export const VERIFIED_MULTIWAY_DGP_REPLICATION_V2 =
  'verified_multiway_dgp_replication_v2' as const;
export const MULTIWAY_DGP_REPLICATION_SEED_VERSION_V2 =
  'phase20_multiway_dgp_replication_seed_v2' as const;
export const MULTIWAY_DGP_METRIC_DENOMINATOR_V2 =
  'equal_weight_frozen_multiway_scenario_mixture_v2' as const;
export const MULTIWAY_DGP_QHAT_PROVENANCE_V2 =
  'frozen_multiway_dgp_qhat_provenance_v2' as const;
export const MULTIWAY_DGP_DRAW_DOMAINS_V2 = Object.freeze({
  viewerShock: 'multiway_dgp_viewer_shock_v2',
  timeShock: 'multiway_dgp_time_shock_v2',
  cellShock: 'multiway_dgp_cell_shock_v2',
  decisionShock: 'multiway_dgp_decision_shock_v2',
  behaviorAction: 'multiway_dgp_behavior_action_v2',
  rewardDraw: 'multiway_dgp_reward_draw_v2',
} as const);

export const MULTIWAY_DGP_ACTIONS_V2 = Object.freeze([0, 1, 2, 3] as const);
export const MULTIWAY_DGP_G_V2 = Object.freeze([-1.5, -0.5, 0.5, 1.5] as const);
export const MULTIWAY_DGP_PROBABILITIES_V2 = Object.freeze({
  uniform: Object.freeze([0.25, 0.25, 0.25, 0.25] as const),
  positive: Object.freeze([0.10, 0.20, 0.30, 0.40] as const),
  negative: Object.freeze([0.40, 0.30, 0.20, 0.10] as const),
  spiky: Object.freeze([0.97, 0.01, 0.01, 0.01] as const),
  nearZero: Object.freeze([0.9997, 0.0001, 0.0001, 0.0001] as const),
} as const);

export const MULTIWAY_DGP_SCENARIO_IDS_V2 = Object.freeze([
  'g_axis',
  'h_axis',
  'r_axis',
  'balanced_positive',
  'balanced_null',
  'balanced_harmful',
  'viewer_imbalance',
  'near_zero_propensity_heavy_prefix',
  'qhat_misspecification',
  'common_time_shock',
] as const);

export const MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2 = 4 as const;
export const MULTIWAY_DGP_SLOTS_V2 = 2 as const;
export const MULTIWAY_DGP_SUPPORT_ACTIONS_V2 = 4 as const;

/* The sum of the four centered terms stays below the base utility margin. */
export const MULTIWAY_DGP_SHOCK_SCALES_V2 = Object.freeze({
  viewer: 0.025,
  time: 0.025,
  cell: 0.02,
  decision: 0.015,
  total: 0.085,
} as const);

export const MULTIWAY_DGP_COMMON_TIME_SHOCK_SCALES_V2 = Object.freeze({
  viewer: 0.02,
  time: 0.04,
  cell: 0.015,
  decision: 0.01,
  total: 0.085,
} as const);

export const MULTIWAY_DGP_RESOURCE_LIMITS_V2 = Object.freeze({
  maximumG: 8,
  maximumH: 8,
  maximumR: 8,
  maximumSlots: 2,
  maximumReplicationsPerScenario: 4,
  maximumScenarios: 10,
  maximumGeneratorPrimitiveWorkUnits: 1_000_000,
  maximumHashWorkUnits: 1_000_000,
  maximumActionDrawWorkUnits: 1_000_000,
  maximumActionSelectionComparisonWorkUnits: 1_000_000,
  maximumRewardDrawWorkUnits: 1_000_000,
  maximumQHatEvaluationWorkUnits: 1_000_000,
  maximumScoreWorkUnits: 1_000_000,
  maximumAggregationWorkUnits: 1_000_000,
  maximumQualificationRecords: 8_192,
  maximumQualificationBytes: 33_554_432,
  maximumCanonicalRecordBytes: 4_096,
} as const);

export type MultiwayDgpScenarioIdV2 = typeof MULTIWAY_DGP_SCENARIO_IDS_V2[number];
export type MultiwayDgpProbabilityVectorV2 = readonly [number, number, number, number];
export type MultiwayDgpBehaviorPolicyV2 =
  | 'uniform'
  | 'spiky'
  | 'near_zero'
  | 'viewer_imbalance';
export type MultiwayDgpTargetPolicyV2 = 'uniform' | 'positive' | 'negative';
export type MultiwayDgpQHatModeV2 = 'oracle_v2' | 'constant_0_5_v2';
export type MultiwayDgpAxisV2 = 'g' | 'h' | 'r' | null;
export type MultiwayDgpTruthClassV2 = 'beneficial' | 'null' | 'harmful';
export type MultiwayDgpStressEvidenceScopeV2 =
  | 'generated_distribution'
  | 'analytical_support_envelope_only';

export type MultiwayDgpShockScalesV2 = Readonly<{
  viewer: number;
  time: number;
  cell: number;
  decision: number;
  total: number;
}>;

export type FrozenMultiwayDgpScenarioV2 = Readonly<{
  scenarioKind: 'axis' | 'balanced' | 'stress';
  scenarioId: MultiwayDgpScenarioIdV2;
  axis: MultiwayDgpAxisV2;
  g: number;
  h: number;
  r: number;
  slots: typeof MULTIWAY_DGP_SLOTS_V2;
  baseR: number;
  viewerRecordMultipliers: readonly number[];
  viewerImbalanceProfile: 'base_r' | 'first_viewer_double';
  behaviorPolicy: MultiwayDgpBehaviorPolicyV2;
  targetPolicy: MultiwayDgpTargetPolicyV2;
  qHatMode: MultiwayDgpQHatModeV2;
  shockScales: MultiwayDgpShockScalesV2;
  commonTimeShock: boolean;
  stressEvidenceScope: MultiwayDgpStressEvidenceScopeV2;
  threshold: 0.5;
  direction: 'greater';
  truthClass: MultiwayDgpTruthClassV2;
  knownTruth: number;
}>;

export type MultiwayDgpResourcePlanV2 = Readonly<{
  scenarioCount: number;
  replicationsPerScenario: number;
  totalReplications: number;
  scenarioRecordCounts: readonly number[];
  scenarioDecisionCounts: readonly number[];
  scenarioSlotCounts: readonly number[];
  scenarioCellCounts: readonly number[];
  scenarioViewerCounts: readonly number[];
  scenarioTimeCounts: readonly number[];
  plannedRecordCount: number;
  plannedBytesUpperBound: number;
  hashWorkUnits: number;
  actionDrawWorkUnits: number;
  actionSelectionComparisonWorkUnits: number;
  rewardDrawWorkUnits: number;
  qHatEvaluationWorkUnits: number;
  scoreWorkUnits: number;
  aggregationWorkUnits: number;
  generatorPrimitiveWorkUnits: number;
  maximumGeneratorPrimitiveWorkUnits: number;
  maximumHashWorkUnits: number;
  maximumActionDrawWorkUnits: number;
  maximumActionSelectionComparisonWorkUnits: number;
  maximumRewardDrawWorkUnits: number;
  maximumQHatEvaluationWorkUnits: number;
  maximumScoreWorkUnits: number;
  maximumAggregationWorkUnits: number;
  maximumQualificationRecords: number;
  maximumQualificationBytes: number;
  maximumCanonicalRecordBytes: number;
}>;

export type MultiwayDgpMembershipV2 = Readonly<{
  viewerClusterId: string;
  timeClusterId: string;
  cellId: string;
  decisionId?: string;
  slotId?: string;
  viewerIndex: number;
  timeIndex: number;
  cellIndex: number;
  decisionIndex?: number;
  slotIndex?: number;
}>;

export type MultiwayDgpQHatProvenanceV2 = Readonly<{
  contractVersion: typeof MULTIWAY_DGP_QHAT_PROVENANCE_V2;
  mode: MultiwayDgpQHatModeV2;
  source: 'frozen_multiway_dgp_v2';
  dgpVersion: typeof SYNTHETIC_MULTIWAY_DR_DGP_V2;
  muDefinition: 'base_plus_centered_viewer_time_cell_decision_shocks_v2';
  qHatSha256: string;
}>;

export type MultiwayDgpShockProvenanceV2 = Readonly<{
  viewer: readonly number[];
  time: readonly number[];
  cell: readonly number[];
  decision: readonly number[];
  shockSha256: string;
}>;

export type MultiwayDgpSlotAtomV2 = Readonly<{
  targetTerm: number;
  residualTerm: number;
  drContribution: number;
  ipsContribution: number;
  prefixWeight: number;
  weight: number;
  prefixLogWeight: number;
  logWeight: number;
}>;

export type MultiwayDgpSlotRecordV2 = Readonly<{
  recordKind: 'slot';
  membership: MultiwayDgpMembershipV2 & {
    decisionId: string;
    slotId: string;
    decisionIndex: number;
    slotIndex: number;
  };
  firstAction: number;
  loggedAction: number;
  behaviorProbability: number;
  targetProbability: number;
  reward: 0 | 1;
  mu: number;
  qHat: MultiwayDgpProbabilityVectorV2;
  loggedQHat: number;
  qHatProvenance: MultiwayDgpQHatProvenanceV2;
  prefixWeight: number;
  prefixLogWeight: number;
  atom: MultiwayDgpSlotAtomV2;
}>;

export type MultiwayDgpDecisionRecordV2 = Readonly<{
  recordKind: 'decision';
  membership: MultiwayDgpMembershipV2 & {
    decisionId: string;
    decisionIndex: number;
  };
  firstAction: number;
  actions: readonly [number, number];
  reward: readonly [0 | 1, 0 | 1];
  mu: readonly [number, number];
  drContribution: number;
  ipsContribution: number;
  importanceMass: number;
}>;

export type MultiwayDgpCellRecordV2 = Readonly<{
  recordKind: 'cell';
  membership: MultiwayDgpMembershipV2;
  decisionCount: number;
  slotCount: number;
  drContribution: number;
  ipsContribution: number;
  importanceMass: number;
}>;

export type MultiwayDgpViewerRecordV2 = Readonly<{
  recordKind: 'viewer';
  membership: Pick<MultiwayDgpMembershipV2, 'viewerClusterId' | 'viewerIndex'>;
  decisionCount: number;
  drContribution: number;
  importanceMass: number;
}>;

export type MultiwayDgpTimeRecordV2 = Readonly<{
  recordKind: 'time';
  membership: Pick<MultiwayDgpMembershipV2, 'timeClusterId' | 'timeIndex'>;
  decisionCount: number;
  drContribution: number;
  importanceMass: number;
}>;

export type MultiwayDgpBoundaryRecordV2 = Readonly<{
  recordKind: 'replication_start' | 'replication_end';
  scenarioId: MultiwayDgpScenarioIdV2;
  replicationIndex: number;
  replicationSeedSha256: string;
  recordCount: number;
  byteCount: number;
}>;

export type MultiwayDgpRecordV2 =
  | MultiwayDgpBoundaryRecordV2
  | MultiwayDgpSlotRecordV2
  | MultiwayDgpDecisionRecordV2
  | MultiwayDgpCellRecordV2
  | MultiwayDgpViewerRecordV2
  | MultiwayDgpTimeRecordV2;

export type MultiwayDgpScoreV2 = Readonly<ClusterScoreV1 & {
  scoreLevel: 'decision' | 'cell' | 'viewer' | 'time';
  ipsContribution: number;
  viewerClusterId?: string;
  timeClusterId?: string;
  cellId?: string;
  decisionId?: string;
}>;

export type MultiwayDgpAggregationV2 = Readonly<{
  decisionScores: readonly MultiwayDgpScoreV2[];
  cellScores: readonly MultiwayDgpScoreV2[];
  viewerScores: readonly MultiwayDgpScoreV2[];
  timeScores: readonly MultiwayDgpScoreV2[];
  aggregationWorkUnits: number;
}>;

export type MultiwayDgpReplicationCountsV2 = Readonly<{
  viewerCount: number;
  timeCount: number;
  cellCount: number;
  decisionCount: number;
  slotCount: number;
  recordsPerReplication: number;
  recordCount: number;
  byteCount: number;
  hashWorkUnits: number;
  actionDrawWorkUnits: number;
  actionSelectionComparisonWorkUnits: number;
  rewardDrawWorkUnits: number;
  qHatEvaluationWorkUnits: number;
  scoreWorkUnits: number;
  aggregationWorkUnits: number;
}>;

export type VerifiedFrozenMultiwayDgpReplicationV2 = Readonly<{
  contractVersion: typeof VERIFIED_MULTIWAY_DGP_REPLICATION_V2;
  dgpVersion: typeof SYNTHETIC_MULTIWAY_DR_DGP_V2;
  protocolSha256: string;
  scenarioId: MultiwayDgpScenarioIdV2;
  replicationIndex: number;
  replicationSeedSha256: string;
  knownTruth: number;
  scenario: FrozenMultiwayDgpScenarioV2;
  counts: MultiwayDgpReplicationCountsV2;
  records: readonly MultiwayDgpRecordV2[];
  slotRecords: readonly MultiwayDgpSlotRecordV2[];
  decisionRecords: readonly MultiwayDgpDecisionRecordV2[];
  cellRecords: readonly MultiwayDgpCellRecordV2[];
  viewerRecords: readonly MultiwayDgpViewerRecordV2[];
  timeRecords: readonly MultiwayDgpTimeRecordV2[];
  viewerMembership: readonly Readonly<{
    viewerClusterId: string;
    viewerIndex: number;
  }>[];
  timeMembership: readonly Readonly<{
    timeClusterId: string;
    timeIndex: number;
  }>[];
  cellMembership: readonly MultiwayDgpMembershipV2[];
  decisionMembership: readonly MultiwayDgpMembershipV2[];
  slotMembership: readonly MultiwayDgpMembershipV2[];
  shockProvenance: MultiwayDgpShockProvenanceV2;
  qHatProvenance: MultiwayDgpQHatProvenanceV2;
  aggregation: MultiwayDgpAggregationV2;
  clusterScores: readonly MultiwayDgpScoreV2[];
  viewerMembershipSha256: string;
  timeMembershipSha256: string;
  cellMembershipSha256: string;
  decisionMembershipSha256: string;
  slotMembershipSha256: string;
  dgpRootSha256: string;
  replicationSha256: string;
  syntheticOnly: true;
  realDatasetEligible: false;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  ciGenerated: false;
  inferenceGenerated: false;
  candidateGenerated: false;
  servable: false;
}>;

export type FrozenMultiwayDgpProtocolV2 = Readonly<{
  contractVersion: typeof FROZEN_MULTIWAY_DGP_PROTOCOL_V2;
  protocolId: string;
  dgpVersion: typeof SYNTHETIC_MULTIWAY_DR_DGP_V2;
  replicationSeedVersion: typeof MULTIWAY_DGP_REPLICATION_SEED_VERSION_V2;
  generatorSeedMaterial: string;
  replicationsPerScenario: typeof MULTIWAY_DGP_REPLICATIONS_PER_SCENARIO_V2;
  slotsPerDecision: typeof MULTIWAY_DGP_SLOTS_V2;
  supportActionsPerSlot: typeof MULTIWAY_DGP_SUPPORT_ACTIONS_V2;
  actionValues: typeof MULTIWAY_DGP_ACTIONS_V2;
  utilityValues: typeof MULTIWAY_DGP_G_V2;
  shockScales: MultiwayDgpShockScalesV2;
  commonTimeShockScales: MultiwayDgpShockScalesV2;
  commonTimeShockScenarioPresent: true;
  knownTruthDerivation:
    'target_trajectory_4x4_zero_mean_factorized_shock_v2';
  metricDenominatorVersion: typeof MULTIWAY_DGP_METRIC_DENOMINATOR_V2;
  scenarios: readonly FrozenMultiwayDgpScenarioV2[];
  resources: MultiwayDgpResourcePlanV2;
  realDatasetEligible: false;
  syntheticOnly: true;
  ciGenerated: false;
  inferenceGenerated: false;
  candidateGenerated: false;
  servable: false;
  frozenAt: string;
  protocolSha256: string;
}>;

export type MultiwayDgpPreflightResultV2 = Readonly<{
  status: 'ready';
  protocolSha256: string;
  resources: MultiwayDgpResourcePlanV2;
}> | Readonly<{
  status: 'not_evaluable';
  blocker: 'resource_limit_exceeded' | 'multiway_dgp_protocol_invalid';
}>;

export type MultiwayDgpTestHooksV2 = {
  beforeGenerateReplication?: (scenarioId: string, replicationIndex: number) => void;
  beforeGenerate?: (scenarioId: string, replicationIndex: number) => void;
  afterGenerateReplication?: (scenarioId: string, replicationIndex: number) => void;
  afterGenerate?: (scenarioId: string, replicationIndex: number) => void;
  beforeRandomDraw?: (domain: string) => void;
  beforeRandom?: (domain: string) => void;
  beforeQHatEvaluation?: () => void;
  beforeQHat?: () => void;
  beforeScoreEvaluation?: () => void;
  beforeScore?: () => void;
  beforeAggregation?: () => void;
};

// Structural alias used by sibling private surfaces; the runtime brand lives in protocol.ts.
export type VerifiedFrozenMultiwayDgpProtocolV2 = FrozenMultiwayDgpProtocolV2;

export type MultiwayDgpBuildResultV2 = Readonly<{
  status: 'verified';
  protocol: FrozenMultiwayDgpProtocolV2;
}> | Readonly<{
  status: 'not_evaluable';
  blocker: 'multiway_dgp_protocol_invalid' | 'resource_limit_exceeded';
}>;

export type MultiwayDgpReplicationResultV2 = Readonly<{
  status: 'generated';
  replication: VerifiedFrozenMultiwayDgpReplicationV2;
}> | Readonly<{
  status: 'not_evaluable';
  blocker:
    | 'multiway_dgp_protocol_invalid'
    | 'resource_limit_exceeded'
    | 'multiway_dgp_non_finite';
}>;
