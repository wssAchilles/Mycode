import RecommendationTrace from '../../../models/RecommendationTrace';
import type { SpaceFeedDebugInfo } from '../feed/debugInfo';
import {
  RUST_CANONICAL_REPLAY_POOL_KIND,
  type RecommendationTracePayload,
} from '../rust/contracts';
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
  const pipelineVersionRaw = requestScopedRustTrace?.pipelineVersion?.trim();
  const strategyVersionRaw = (
    requestScopedRustTrace?.strategyVersion ?? input.query.rankingPolicy?.strategyVersion
  )?.trim();
  const servedCandidates = candidates
    .filter((candidate) => candidate.selected && candidate.served)
    .sort((left, right) => (left.servedPosition || 0) - (right.servedPosition || 0));
  const actionProbabilities = servedCandidates.map((candidate) => {
    const rawProb = selectedCandidates.get(candidate.candidateId)?.candidate.pageRlExplorationProb;
    return typeof rawProb === 'number' && Number.isFinite(rawProb) && rawProb > 0 && rawProb <= 1
      ? rawProb
      : undefined;
  });

  // 仅当 Rust 返回完整无截断候选池、核心版本齐备且所有已投放动作具备合法探索概率时才解锁随机日志
  const canEmitLoggedRandomized = servingOwner === 'rust'
    && supportEvidence.status === 'complete'
    && !truncated
    && totalCount === candidates.length
    && servedCandidates.length > 0
    && Boolean(pipelineVersionRaw)
    && Boolean(strategyVersionRaw)
    && actionProbabilities.every((probability) => probability !== undefined);

  const policyVersion = canEmitLoggedRandomized
    ? versionEvidence(strategyVersionRaw, 'no_request_scoped_policy_version')
    : unavailableVersion('no_request_scoped_policy_version');
  const behaviorPolicyKind = canEmitLoggedRandomized
    ? ('logged_randomized' as const)
    : ('deterministic_top_k' as const);
  const decision = {
    contractVersion: RECOMMENDATION_DECISION_LOG_VERSION,
    positionContractVersion: SERVED_POSITION_CONTRACT_VERSION,
    requestId: input.query.requestId,
    ...(input.query.clientRequestId ? { clientRequestId: input.query.clientRequestId } : {}),
    decisionId: input.query.decisionId,
    decisionAt: input.decisionAt.toISOString(),
    servingOwner,
    fallbackReason: input.debugInfo?.fallbackReason ?? null,
    behaviorPolicyKind,
    behaviorPolicy: {
      policyId: canEmitLoggedRandomized
        ? 'rust_epsilon_plackett_luce_v2'
        : `${servingOwner}_deterministic_top_k`,
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
    actions: servedCandidates.map((candidate, index) => ({
      actionKey: {
        candidateNamespace: 'serving_post_id' as const,
        candidateId: candidate.candidateId,
        servedPosition: candidate.servedPosition!,
      },
      selectionRank: candidate.selectionRank!,
      behaviorPropensity: canEmitLoggedRandomized
        ? {
          status: 'logged_randomized' as const,
          selectionProbability: actionProbabilities[index]!,
        }
        : {
          status: 'not_evaluable_deterministic' as const,
          reason: 'deterministic_top_k_no_logged_probability' as const,
        },
    })),
  };

  return recommendationDecisionLogSchema.parse(decision);
}

function hasVerifiedRandomizedEvidence(decision: RecommendationDecisionLogV1): boolean {
  // 校验候选池支持完整性与哈希摘要一致性，禁止伪造或残缺证据入库
  if (
    decision.candidatePool.supportEvidence.status !== 'complete'
    || decision.candidatePool.truncated
    || decision.candidatePool.totalCount !== decision.candidatePool.candidates.length
    || decision.candidatePool.candidatePoolSha256 !== candidatePoolSha256(decision.candidatePool.candidates)
  ) {
    return false;
  }

  // 校验行为策略及核心管线/策略版本均具备明确绑定版本
  if (
    decision.behaviorPolicy.policyVersion.status !== 'bound'
    || decision.versions.policy.status !== 'bound'
    || decision.versions.pipeline.status !== 'bound'
  ) {
    return false;
  }

  // 每条已记录动作必须携带位于 (0, 1] 区间内的合法随机 propensity 概率
  if (decision.actions.length === 0) {
    return false;
  }

  return decision.actions.every((action) => (
    action.behaviorPropensity.status === 'logged_randomized'
    && typeof action.behaviorPropensity.selectionProbability === 'number'
    && Number.isFinite(action.behaviorPropensity.selectionProbability)
    && action.behaviorPropensity.selectionProbability > 0
    && action.behaviorPropensity.selectionProbability <= 1
  ));
}

export async function persistRecommendationDecisionLogV1(
  value: RecommendationDecisionLogV1,
): Promise<void> {
  const decision = recommendationDecisionLogSchema.parse(value);
  if (decision.behaviorPolicyKind === 'logged_randomized' && !hasVerifiedRandomizedEvidence(decision)) {
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
  const poolOrderVerified = replayPool.poolKind === RUST_CANONICAL_REPLAY_POOL_KIND;
  const complete = poolOrderVerified
    && !replayPool.truncated
    && replayCountMatches
    && missingSelections.length === 0;
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
            : missingSelections.length > 0
              ? 'rust_replay_pool_missing_selected_candidate'
              : 'rust_replay_pool_order_unverified',
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
