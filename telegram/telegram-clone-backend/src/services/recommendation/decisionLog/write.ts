import RecommendationTrace from '../../../models/RecommendationTrace';
import type { SpaceFeedDebugInfo } from '../feed/debugInfo';
import type { RecommendationTracePayload } from '../rust/contracts';
import type { FeedCandidate } from '../types/FeedCandidate';
import type { FeedQuery } from '../types/FeedQuery';
import {
  RECOMMENDATION_DECISION_LOG_VERSION,
  SERVED_POSITION_CONTRACT_VERSION,
  candidatePoolSha256,
  decisionLogSha256,
  recommendationDecisionLogSchema,
  type DecisionCandidate,
  type RecommendationDecisionLogV1,
} from './contracts';

type BuildRecommendationDecisionLogV1Input = {
  query: FeedQuery;
  policyCandidates: FeedCandidate[];
  finalServedCandidates: FeedCandidate[];
  debugInfo?: SpaceFeedDebugInfo;
  rustTrace?: RecommendationTracePayload;
  decisionAt: Date;
};

export function isRecommendationDecisionLogV1Enabled(): boolean {
  return process.env.RECOMMENDATION_DECISION_LOG_V1_ENABLED === 'true';
}

export function buildRecommendationDecisionLogV1(
  input: BuildRecommendationDecisionLogV1Input,
): RecommendationDecisionLogV1 {
  const servingOwner = input.debugInfo?.servingOwner;
  if (servingOwner !== 'node' && servingOwner !== 'rust') {
    throw new Error('decision_log_missing_serving_owner');
  }

  const requestScopedRustTrace = input.rustTrace?.requestId === input.query.requestId
    ? input.rustTrace
    : undefined;
  const servedPositions = new Map(
    input.finalServedCandidates.map((candidate, index) => [candidate.postId.toString(), index + 1]),
  );
  if (
    new Set(input.policyCandidates.map((candidate) => candidate.postId.toString())).size
      !== input.policyCandidates.length
  ) {
    const code = 'decision_log_duplicate_policy_candidate' as const;
    throw Object.assign(new Error(code), { code });
  }
  const selectedCandidates = new Map(
    input.policyCandidates.map((candidate, index) => [candidate.postId.toString(), {
      candidate,
      selectionRank: index + 1,
    }]),
  );
  const { candidates, totalCount, truncated, supportEvidence } = servingOwner === 'rust'
    ? buildRustCandidatePool(selectedCandidates, servedPositions, requestScopedRustTrace)
    : buildNodeCandidatePool(selectedCandidates, servedPositions);
  const policyVersion = unavailableVersion('no_request_scoped_policy_version');
  const decision = {
    contractVersion: RECOMMENDATION_DECISION_LOG_VERSION,
    positionContractVersion: SERVED_POSITION_CONTRACT_VERSION,
    requestId: input.query.requestId,
    ...(input.query.clientRequestId ? { clientRequestId: input.query.clientRequestId } : {}),
    decisionId: input.query.decisionId,
    decisionAt: input.decisionAt.toISOString(),
    servingOwner,
    fallbackReason: input.debugInfo?.fallbackReason ?? null,
    behaviorPolicyKind: 'deterministic_top_k' as const,
    behaviorPolicy: {
      policyId: `${servingOwner}_deterministic_top_k`,
      policyVersion,
    },
    versions: {
      pipeline: versionEvidence(
        requestScopedRustTrace?.pipelineVersion,
        'no_request_scoped_pipeline_version',
      ),
      strategy: versionEvidence(
        requestScopedRustTrace?.strategyVersion ?? input.query.rankingPolicy?.strategyVersion,
        'no_request_scoped_strategy_version',
      ),
      policy: policyVersion,
      graph: unavailableVersion('no_request_scoped_graph_version'),
      model: unavailableVersion('no_request_scoped_model_version'),
      artifact: unavailableVersion('no_request_scoped_artifact_version'),
      index: unavailableVersion('no_request_scoped_index_version'),
    },
    candidatePool: {
      supportEvidence,
      totalCount,
      truncated,
      candidates,
      candidatePoolSha256: candidatePoolSha256(candidates),
    },
    actions: candidates
      .filter((candidate) => candidate.selected && candidate.served)
      .sort((left, right) => (left.servedPosition || 0) - (right.servedPosition || 0))
      .map((candidate) => ({
        actionKey: {
          candidateNamespace: 'serving_post_id' as const,
          candidateId: candidate.candidateId,
          servedPosition: candidate.servedPosition!,
        },
        selectionRank: candidate.selectionRank!,
        behaviorPropensity: {
          status: 'not_evaluable_deterministic' as const,
          reason: 'deterministic_top_k_no_logged_probability' as const,
        },
      })),
  };

  return recommendationDecisionLogSchema.parse(decision);
}

export async function persistRecommendationDecisionLogV1(
  value: RecommendationDecisionLogV1,
): Promise<void> {
  const decision = recommendationDecisionLogSchema.parse(value);
  if (decision.behaviorPolicyKind === 'logged_randomized') {
    const code = 'decision_log_randomized_evidence_unverified' as const;
    throw Object.assign(new Error(code), { code });
  }
  const digest = decisionLogSha256(decision);
  const result = await RecommendationTrace.updateOne(
    {
      requestId: decision.requestId,
      decisionId: decision.decisionId,
      $or: [
        { decisionLogV1Sha256: { $exists: false } },
        { decisionLogV1Sha256: digest },
      ],
    },
    {
      $set: {
        decisionLogV1: decision,
        decisionLogV1Sha256: digest,
      },
    },
    { upsert: false, runValidators: true },
  );

  if (!result.acknowledged || result.matchedCount !== 1) {
    throw Object.assign(new Error('decision_log_conflict'), {
      code: 'decision_log_conflict' as const,
    });
  }
}

function buildNodeCandidatePool(
  selectedCandidates: Map<string, { candidate: FeedCandidate; selectionRank: number }>,
  servedPositions: Map<string, number>,
) {
  const candidates = Array.from(selectedCandidates.values()).map(({ candidate, selectionRank }) => (
    decisionCandidate(
      candidate.postId.toString(),
      selectionRank,
      finiteScore(candidate.score),
      selectionRank,
      servedPositions.get(candidate.postId.toString()),
    )
  ));
  return {
    candidates,
    totalCount: candidates.length,
    truncated: false,
    supportEvidence: {
      status: 'incomplete' as const,
      reason: 'node_replay_pool_unavailable',
    },
  };
}

function buildRustCandidatePool(
  selectedCandidates: Map<string, { candidate: FeedCandidate; selectionRank: number }>,
  servedPositions: Map<string, number>,
  rustTrace?: RecommendationTracePayload,
) {
  const replayPool = rustTrace?.replayPool;
  if (!replayPool) {
    const nodePool = buildNodeCandidatePool(selectedCandidates, servedPositions);
    return {
      ...nodePool,
      supportEvidence: {
        status: 'incomplete' as const,
        reason: 'rust_replay_pool_unavailable',
      },
    };
  }

  const candidates = replayPool.candidates.map((candidate) => {
    const selected = selectedCandidates.get(candidate.postId);
    return decisionCandidate(
      candidate.postId,
      candidate.rank,
      finiteScore(candidate.score),
      selected?.selectionRank,
      selected ? servedPositions.get(candidate.postId) : undefined,
    );
  });
  const replayCandidateIds = new Set(replayPool.candidates.map((candidate) => candidate.postId));
  const missingSelections = Array.from(selectedCandidates.entries())
    .filter(([candidateId]) => !replayCandidateIds.has(candidateId));
  let nextPoolRank = candidates.reduce((maximum, candidate) => Math.max(maximum, candidate.poolRank), 0);
  for (const [candidateId, selected] of missingSelections) {
    nextPoolRank += 1;
    candidates.push(decisionCandidate(
      candidateId,
      nextPoolRank,
      finiteScore(selected.candidate.score),
      selected.selectionRank,
      servedPositions.get(candidateId),
    ));
  }

  const replayCountMatches = replayPool.candidates.length === replayPool.totalCount;
  const complete = !replayPool.truncated && replayCountMatches && missingSelections.length === 0;
  return {
    candidates,
    totalCount: Math.max(replayPool.totalCount, candidates.length),
    truncated: replayPool.truncated || replayPool.candidates.length < replayPool.totalCount,
    supportEvidence: complete
      ? { status: 'complete' as const }
      : {
        status: 'incomplete' as const,
        reason: replayPool.truncated
          ? 'rust_replay_pool_truncated'
          : !replayCountMatches
            ? 'rust_replay_pool_count_mismatch'
            : 'rust_replay_pool_missing_selected_candidate',
      },
  };
}

function decisionCandidate(
  candidateId: string,
  poolRank: number,
  score: number | null,
  selectionRank?: number,
  servedPosition?: number,
): DecisionCandidate {
  return {
    candidateNamespace: 'serving_post_id',
    candidateId,
    poolRank,
    eligible: true,
    score,
    selected: selectionRank !== undefined,
    selectionRank: selectionRank ?? null,
    served: selectionRank !== undefined && servedPosition !== undefined,
    servedPosition: selectionRank !== undefined ? servedPosition ?? null : null,
    objectiveEvidence: [{
      status: 'unavailable',
      objective: 'engagement',
      reason: 'no_trusted_prediction_artifact',
    }],
  };
}

function finiteScore(score: number | undefined): number | null {
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

function versionEvidence(version: string | undefined, unavailableReason: string) {
  return version && version.trim()
    ? { status: 'bound' as const, version: version.trim() }
    : unavailableVersion(unavailableReason);
}

function unavailableVersion(reason: string) {
  return { status: 'unavailable' as const, reason };
}
