import type { ClusterScoreSummaryV1, ClusterScoreV1 } from '../../../contracts';

export const VERIFIED_SYNTHETIC_MULTIWAY_SCORE_SURFACE_V1 =
  'verified_synthetic_multiway_score_surface_v1' as const;
export const MULTIWAY_SCORE_SURFACE_RESOURCE_LIMITS_V1 = Object.freeze({
  maximumScenarios: 64,
  maximumReplicationsPerScenario: 512,
  maximumSlotAtoms: 131_072,
  maximumCanonicalInputBytes: 33_554_432,
  maximumWorkUnits: 1_048_576,
} as const);

export const MULTIWAY_SCORE_SURFACE_BLOCKERS_V1 = Object.freeze([
  'multiway_score_surface_source_unverified',
  'multiway_score_surface_resource_limit_exceeded',
  'multiway_score_surface_chain_mismatch',
  'multiway_score_surface_order_mismatch',
  'multiway_score_surface_aggregate_invalid',
  'common_time_shock_inference_unavailable',
  'multiway_score_surface_dgp_generation_failed',
  'multiway_score_surface_slot_invalid',
] as const);

export type MultiwayScoreSurfaceBlockerV1 = typeof MULTIWAY_SCORE_SURFACE_BLOCKERS_V1[number];

export type ScoreSurfaceHookCountsV1 = Readonly<{
  beforeGenerateReplication: number;
  afterGenerateReplication: number;
  beforeEvaluateSequentialDr: number;
  afterEvaluateSequentialDr: number;
  beforeRandomDraw: number;
  beforeQHatEvaluation: number;
  beforeScoreEvaluation: number;
  beforeAggregation: number;
}>;

export type ScoreSurfaceResourceDiagnosticsV1 = Readonly<{
  preflightCompletedBeforeReplay: true;
  scenarios: number;
  replicationsPerScenario: number;
  replications: number;
  totalReplications: number;
  decisions: number;
  cells: number;
  plannedRecordCount: number;
  slotAtoms: number;
  viewerTimeCells: number;
  viewers: number;
  times: number;
  canonicalInputBytes: number;
  canonicalInputBytesUpperBound: number;
  workUnits: number;
  hashWorkUnits: number;
  plannedScoreWorkUnits: number;
  actualScoreWorkUnits: number;
  plannedAggregationWorkUnits: number;
  actualAggregationWorkUnits: number;
  hookCounts: ScoreSurfaceHookCountsV1;
}>;

export type ScoreSurfaceSlotAtomV1 = Readonly<{
  scenarioKind: string;
  scenarioId: string;
  replicationIndex: number;
  atomIndex: number;
  decisionId: string;
  requestId: string;
  servedPosition: number;
  viewerClusterId: string;
  timeClusterId: string;
  viewerMembership: string;
  timeMembership: string;
  prefixLogWeight: number;
  prefixWeight: number;
  behaviorProbability: number;
  targetProbability: number;
  reward: number;
  qHatProvenance: unknown;
  targetQValues: readonly Readonly<{ probability: number; qValue: number }>[];
  loggedQ: number;
  logWeight: number;
  weight: number;
  ipsContribution: number;
  drContribution: number;
  priorAtomSha256: string;
  atomSha256: string;
  membership: Readonly<{
    viewerClusterId: string;
    timeClusterId: string;
    cellId: string;
    viewerIndex: number;
    timeIndex: number;
    cellIndex: number;
    decisionId: string;
    slotId: string;
    decisionIndex: number;
    slotIndex: number;
  }>;
  qHatProvenanceDigest: string;
}>;

export type ScoreSurfaceAggregateV1 = Readonly<{
  scenarioKind: string;
  scenarioId: string;
  replicationIndex: number;
  decisionId?: string;
  viewerClusterId?: string;
  timeClusterId?: string;
  level: 'decision' | 'viewer_time_cell' | 'viewer' | 'time' | 'overall';
  key: string;
  slotCount: number;
  decisionCount: number;
  drContributionSum: number;
  ipsContributionSum: number;
  importanceMass: number;
  dr: number;
  ips: number;
}>;

export type ScoreSurfaceReplicationV1 = Readonly<{
  scenarioKind: string;
  scenarioId: string;
  replicationIndex: number;
  replicationSha256: string;
  slotAtoms: readonly ScoreSurfaceSlotAtomV1[];
  atoms: readonly ScoreSurfaceSlotAtomV1[];
  decisionAggregates: readonly ScoreSurfaceAggregateV1[];
  decisionScores: readonly ScoreSurfaceAggregateV1[];
  viewerTimeCells: readonly ScoreSurfaceAggregateV1[];
  cells: readonly ScoreSurfaceAggregateV1[];
  viewerAggregates: readonly ScoreSurfaceAggregateV1[];
  timeAggregates: readonly ScoreSurfaceAggregateV1[];
  overallAggregates: readonly ScoreSurfaceAggregateV1[];
  chainHeadSha256: string;
}>;

export type ViewerOnlyDiagnosticBaselineV1 = Readonly<{
  kind: 'viewer_only_diagnostic_baseline';
  estimator: 'dr';
  status: 'evaluated' | 'abstained';
  blocker: string | null;
  commonTimeShockHandlingVerified: false;
  inferenceScope: 'viewer_only_diagnostic';
  summary: ClusterScoreSummaryV1 | null;
  clusters: readonly ClusterScoreV1[];
  confidenceInterval: null;
  variance: null;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
}>;

export type VerifiedMultiwayScoreSurfaceV1 = Readonly<{
  contractVersion: typeof VERIFIED_SYNTHETIC_MULTIWAY_SCORE_SURFACE_V1;
  dgpV2Status: 'verified_synthetic_development_only';
  multiwayScoreSurfaceStatus: 'verified_synthetic_only';
  multiwayQHatQualityStatus: 'not_assessed_prediction_v4_mechanical_fixture_only';
  estimand: 'mean_reward_per_logged_slot_v1';
  estimator: 'dr' | 'ips';
  protocolSha256: string;
  dgpProtocolSha256: string;
  scenarioIds: readonly string[];
  viewerClusterIds: readonly string[];
  timeClusterIds: readonly string[];
  viewerTimeMembership: readonly Readonly<{
    scenarioId: string;
    replicationIndex: number;
    decisionId: string;
    viewerClusterId: string;
    timeClusterId: string;
  }>[];
  replications: readonly ScoreSurfaceReplicationV1[];
  slotAtoms: readonly ScoreSurfaceSlotAtomV1[];
  atoms: readonly ScoreSurfaceSlotAtomV1[];
  decisionAggregates: readonly ScoreSurfaceAggregateV1[];
  decisionScores: readonly ScoreSurfaceAggregateV1[];
  viewerTimeCells: readonly ScoreSurfaceAggregateV1[];
  cells: readonly ScoreSurfaceAggregateV1[];
  viewerAggregates: readonly ScoreSurfaceAggregateV1[];
  timeAggregates: readonly ScoreSurfaceAggregateV1[];
  overallAggregates: readonly ScoreSurfaceAggregateV1[];
  viewerOnlyDiagnosticBaseline: ViewerOnlyDiagnosticBaselineV1;
  commonTimeShockHandlingVerified: false;
  candidateSelectionStatus: 'no_candidate_selected';
  candidateQualificationStatus: 'not_run';
  selectedMethod: 'diagnostics_only_abstention_v1';
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  nextPhaseHandoff: 'ready_to_research_candidate_on_frozen_dgp_v2';
  blockers: readonly string[];
  resourceDiagnostics: ScoreSurfaceResourceDiagnosticsV1;
  generationHookCounts: ScoreSurfaceHookCountsV1;
  surfaceChainSha256: string;
  surfaceSha256: string;
}>;

export type MultiwayScoreSurfaceBuildResultV1 =
  | Readonly<{
    status: 'verified';
    surface: VerifiedMultiwayScoreSurfaceV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: MultiwayScoreSurfaceBlockerV1;
    diagnostics: Readonly<{
      preflightCompleted: boolean;
      hookCounts: ScoreSurfaceHookCountsV1;
    }>;
  }>;

export type MultiwayScoreSurfaceGenerationHooksV1 = Readonly<{
  beforeGenerateReplication?: (scenario: unknown, replicationIndex: number) => void;
  afterGenerateReplication?: (scenario: unknown, replicationIndex: number, replication: unknown) => void;
  beforeEvaluateSequentialDr?: (atom: unknown) => void;
  afterEvaluateSequentialDr?: (atom: unknown, result: unknown) => void;
  beforeRandomDraw?: (domain: string) => void;
  beforeQHatEvaluation?: () => void;
  beforeScoreEvaluation?: () => void;
  beforeAggregation?: () => void;
}>;
