import type { SyntheticSegmentAssignmentV1 } from '../../decisionContext/syntheticContextV1';

export const OPE_V3_RESOURCE_LIMITS_VERSION = 'ope_v3_resource_limits_v1' as const;
export const OPE_V3_ESTIMAND = 'mean_reward_per_logged_slot_v1' as const;

export type OpeV3ResourceLimits = {
  maxDecisions: number;
  maxSlots: number;
  maxClusters: number;
  maxSegmentKeys: number;
  maxObjectives: number;
  maxAggregateStateEntries: number;
  maxEstimatedAggregateStateBytes: number;
  maxBufferedActions: number;
  maxBufferedRecords: number;
  maxBufferedBytes: number;
};

export type OpeAggregateStateV3 = {
  readonly contractVersion: 'ope_v3_aggregate_state_v1';
};

export type OpeSlotContributionV3 = {
  contractVersion: 'ope_v3_slot_contribution_v1';
  estimand: typeof OPE_V3_ESTIMAND;
  stateBindingSha256: string;
  priorContributionSha256: string;
  contributionSha256: string;
  decisionId: string;
  servedPosition: number;
  prefixLogWeight: number;
  logWeight: number;
  prefixWeight: number;
  weight: number;
  behaviorProbability: number;
  targetProbability: number;
  reward: number;
  ipsContribution: number;
  drContribution?: number;
  binding: {
    inferenceClusterId: string;
    segmentAssignments: SyntheticSegmentAssignmentV1[];
    objective: string;
    syntheticOutcomeEvidenceSha256: string;
    syntheticContextSha256: string;
    prediction?: {
      predictionSetVersion: string;
      verificationReceiptSha256: string;
    };
  };
};

export type VerifiedOpeAggregateReceiptV3 = {
  contractVersion: 'verified_ope_v3_aggregate_receipt_v1';
  estimand: typeof OPE_V3_ESTIMAND;
  resourceLimitsVersion: typeof OPE_V3_RESOURCE_LIMITS_VERSION;
  resourceConfigSha256: string;
  stateBindingSha256: string;
  trajectoryCohortSha256: string;
  outcomeEvidenceRootsSha256: string;
  contextEvidenceRootsSha256: string;
  targetEvidenceRootsSha256: string;
  predictionEvidenceRootsSha256: string;
  contributionHashChainSha256: string;
  aggregateStateSha256: string;
  expectedDecisionCount: number;
  observedDecisionCount: number;
  expectedSlotCount: number;
  observedSlotCount: number;
  drSlotCount: number;
  fullyStreaming: false;
  boundedInMemoryEvidence: readonly [
    'synthetic_outcome_v1',
    'synthetic_context_v1',
    'synthetic_trajectory_step_summaries_v1',
  ];
  highWaterDiagnostics: {
    decisions: number;
    slots: number;
    clusters: number;
    segmentKeys: number;
    objectives: number;
    aggregateStateEntries: number;
    estimatedAggregateStateBytes: number;
    peakBufferedActions: number;
    peakBufferedRecords: number;
    peakBufferedBytes: number;
  };
  receiptSha256: string;
};
