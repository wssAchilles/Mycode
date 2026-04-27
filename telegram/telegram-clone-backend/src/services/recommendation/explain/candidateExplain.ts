import type { FeedCandidate, RecommendationExplain } from '../types/FeedCandidate';
import type { FeedQuery } from '../types/FeedQuery';
import { buildAuthorRecommendationReason } from '../signals/authorSemantics';
import { buildCandidateSignalSnapshot, readFeedSignalValue } from '../signals/feedSignalSemantics';

export function attachRecommendationExplain(
  candidates: FeedCandidate[],
  query?: FeedQuery,
): FeedCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    recommendationExplain: buildRecommendationExplain(candidate, query),
  }));
}

export function buildRecommendationExplain(
  candidate: FeedCandidate,
  query?: FeedQuery,
): RecommendationExplain | undefined {
  if (!candidate.recallSource && candidate.inNetwork === undefined && !candidate._scoreBreakdown) {
    return undefined;
  }

  const source = candidate.recallSource || 'unknown';
  const signalInput = {
    candidate,
    scoreBreakdown: candidate._scoreBreakdown,
  };
  const authorClusterScore = readFeedSignalValue(signalInput, 'retrievalAuthorClusterScore') || 0;
  const candidateClusterScore = readFeedSignalValue(signalInput, 'retrievalCandidateClusterScore') || 0;
  const denseVectorScore = readFeedSignalValue(signalInput, 'retrievalDenseVectorScore') || 0;
  const keywordScore = readFeedSignalValue(signalInput, 'retrievalKeywordScore') || 0;
  const embeddingScore = readFeedSignalValue(signalInput, 'retrievalEmbeddingScore') || 0;
  const authorAffinityScore = readFeedSignalValue(signalInput, 'authorAffinityScore') || 0;
  const evidenceConfidence = readFeedSignalValue(signalInput, 'retrievalEvidenceConfidence') || 0;
  const crossLaneSourceCount = readFeedSignalValue(signalInput, 'retrievalCrossLaneSourceCount') || 0;
  const trendAffinityStrength = readFeedSignalValue(signalInput, 'trendAffinityStrength') || 0;
  const trendPersonalizationStrength =
    readFeedSignalValue(signalInput, 'trendPersonalizationStrength') || 0;
  const explorationEligible = readFeedSignalValue(signalInput, 'explorationEligible') || 0;
  const explorationRisk = readFeedSignalValue(signalInput, 'explorationRisk') || 0;
  const explorationNovelty = readFeedSignalValue(signalInput, 'explorationNovelty') || 0;
  const interestDecayMultiplier = readFeedSignalValue(signalInput, 'interestDecayMultiplier') || 1;
  const interestDecayNegativePenalty =
    readFeedSignalValue(signalInput, 'interestDecayNegativePenalty') || 0;
  const negativeFeedbackStrength = readFeedSignalValue(signalInput, 'negativeFeedbackStrength') || 0;
  const negativeFeedbackMultiplier = readFeedSignalValue(signalInput, 'negativeFeedbackMultiplier') || 1;
  const fatigueStrength = readFeedSignalValue(signalInput, 'fatigueStrength') || 0;
  const sessionSuppressionStrength =
    readFeedSignalValue(signalInput, 'sessionSuppressionStrength') || 0;
  const intraRequestRedundancyPenalty =
    readFeedSignalValue(signalInput, 'intraRequestRedundancyPenalty') || 0;
  const contentQuality = Math.max(
    readFeedSignalValue(signalInput, 'contentQuality') || 0,
    readFeedSignalValue(signalInput, 'contentQualityPrior') || 0,
  );
  const diversityMultiplier = readFeedSignalValue(signalInput, 'diversityMultiplier') || 1;
  const embeddingMatched =
    authorClusterScore > 0.01 ||
    candidateClusterScore > 0.01 ||
    denseVectorScore > 0.01 ||
    keywordScore > 0.01 ||
    embeddingScore > 0.01;
  const graphMatched =
    source === 'GraphSource' ||
    source === 'GraphKernelSource' ||
    typeof candidate.graphRecallType === 'string';
  const popularFallback = source === 'PopularSource' && !embeddingMatched;
  const diversityAdjusted = diversityMultiplier < 0.999;
  const evidence = buildEvidence(candidate, {
    embeddingMatched,
    graphMatched,
    popularFallback,
    diversityAdjusted,
    authorClusterScore,
    candidateClusterScore,
    denseVectorScore,
    keywordScore,
    authorAffinityScore,
    evidenceConfidence,
    crossLaneSourceCount,
    contentQuality,
    trendAffinityStrength,
    trendPersonalizationStrength,
    explorationEligible,
    explorationRisk,
    explorationNovelty,
    interestDecayMultiplier,
    interestDecayNegativePenalty,
    negativeFeedbackStrength,
    negativeFeedbackMultiplier,
    fatigueStrength,
    sessionSuppressionStrength,
    intraRequestRedundancyPenalty,
  });

  return {
    detail: buildRecommendationDetail(candidate, {
      embeddingMatched,
      popularFallback,
      authorClusterScore,
      candidateClusterScore,
      keywordScore,
      authorAffinityScore,
      evidenceConfidence,
      crossLaneSourceCount,
      contentQuality,
      trendAffinityStrength,
      trendPersonalizationStrength,
      explorationEligible,
      explorationRisk,
      explorationNovelty,
      interestDecayMultiplier,
      interestDecayNegativePenalty,
      negativeFeedbackStrength,
      negativeFeedbackMultiplier,
    }),
    primarySource: source,
    sourceReason: buildSourceReason(source, { embeddingMatched, graphMatched, popularFallback }),
    inNetwork: candidate.inNetwork === true,
    embeddingMatched,
    graphMatched,
    popularFallback,
    diversityAdjusted,
    userState: query?.userStateContext?.state,
    selectionPool: candidate.selectionPool,
    selectionReason: candidate.selectionReason,
    evidence,
    signals: buildCandidateSignalSnapshot(candidate),
  };
}

type ExplainContext = {
  embeddingMatched: boolean;
  graphMatched: boolean;
  popularFallback: boolean;
  diversityAdjusted: boolean;
  authorClusterScore: number;
  candidateClusterScore: number;
  denseVectorScore: number;
  keywordScore: number;
  authorAffinityScore: number;
  evidenceConfidence: number;
  crossLaneSourceCount: number;
  contentQuality: number;
  trendAffinityStrength: number;
  trendPersonalizationStrength: number;
  explorationEligible: number;
  explorationRisk: number;
  explorationNovelty: number;
  interestDecayMultiplier: number;
  interestDecayNegativePenalty: number;
  negativeFeedbackStrength: number;
  negativeFeedbackMultiplier: number;
  fatigueStrength: number;
  sessionSuppressionStrength: number;
  intraRequestRedundancyPenalty: number;
};

function buildEvidence(candidate: FeedCandidate, context: ExplainContext): string[] {
  const evidence: string[] = [];

  if (candidate.inNetwork) evidence.push('in_network');
  if (context.graphMatched) evidence.push('graph_match');
  if (context.authorClusterScore > 0.05) evidence.push('author_cluster');
  if (context.candidateClusterScore > 0.05) evidence.push('candidate_cluster');
  if (context.denseVectorScore > 0.05) evidence.push('dense_vector');
  if (context.keywordScore > 0.05) evidence.push('keyword_overlap');
  if (context.authorAffinityScore > 0.1) evidence.push('author_affinity');
  if (context.evidenceConfidence >= 0.55 || context.crossLaneSourceCount >= 1) {
    evidence.push('multi_source_consensus');
  }
  if (context.contentQuality >= 0.72 && (candidate.commentCount || 0) >= 2) {
    evidence.push('high_quality_discussion');
  }
  if (context.trendPersonalizationStrength >= 0.08) evidence.push('trend_personalized');
  if (context.trendAffinityStrength >= 0.12) evidence.push('trend_affinity');
  if (context.explorationEligible >= 0.5 && context.explorationRisk <= 0.58) {
    evidence.push('safe_exploration');
  }
  if (context.explorationNovelty >= 0.4) evidence.push('novelty_budget');
  if (context.interestDecayMultiplier >= 1.04) evidence.push('recent_interest_lift');
  if (context.interestDecayNegativePenalty > 0.02 || context.negativeFeedbackStrength > 0.02) {
    evidence.push('negative_feedback_guardrail');
  }
  if (context.negativeFeedbackMultiplier < 0.98) evidence.push('behavior_penalty_applied');
  if (context.sessionSuppressionStrength > 0.01 || context.intraRequestRedundancyPenalty > 0.01) {
    evidence.push('session_diversified');
  }
  if (candidate.interestPoolKind) {
    evidence.push(`interest_pool:${candidate.interestPoolKind}`);
  }
  if (candidate.selectionPool) evidence.push(`selection_pool:${candidate.selectionPool}`);
  if (candidate.selectionReason) evidence.push(`selection_reason:${candidate.selectionReason}`);
  if (context.popularFallback) evidence.push('popular_fallback');
  if (candidate.isNews) evidence.push('news_candidate');
  if (context.diversityAdjusted) evidence.push('diversity_adjusted');

  return evidence;
}

function buildSourceReason(
  source: string,
  context: Pick<ExplainContext, 'embeddingMatched' | 'graphMatched' | 'popularFallback'>,
): string {
  switch (source) {
    case 'FollowingSource':
      return 'following_author';
    case 'GraphSource':
    case 'GraphKernelSource':
      return 'social_graph';
    case 'EmbeddingAuthorSource':
      return 'embedding_author_retrieval';
    case 'TwoTowerSource':
      return 'embedding_post_retrieval';
    case 'PopularSource':
      return context.popularFallback ? 'popular_fallback' : 'popular_embedding_rerank';
    case 'NewsAnnSource':
      return context.embeddingMatched ? 'news_ann_embedding' : 'news_ann';
    case 'ColdStartSource':
      return 'cold_start_bootstrap';
    default:
      return context.graphMatched ? 'graph_match' : context.embeddingMatched ? 'embedding_match' : 'unknown';
  }
}

function buildRecommendationDetail(
  candidate: FeedCandidate,
  context: Pick<
    ExplainContext,
    | 'embeddingMatched'
    | 'popularFallback'
    | 'authorClusterScore'
    | 'candidateClusterScore'
    | 'keywordScore'
    | 'authorAffinityScore'
    | 'evidenceConfidence'
    | 'crossLaneSourceCount'
    | 'contentQuality'
    | 'trendAffinityStrength'
    | 'trendPersonalizationStrength'
    | 'explorationEligible'
    | 'explorationRisk'
    | 'explorationNovelty'
    | 'interestDecayMultiplier'
    | 'interestDecayNegativePenalty'
    | 'negativeFeedbackStrength'
    | 'negativeFeedbackMultiplier'
  >,
): string | undefined {
    if (candidate.selectionReason === 'in_network_primary') {
        return '你关注作者的新内容';
    }
    if (context.trendPersonalizationStrength >= 0.1) {
        return '你关注的趋势话题';
    }
    if (context.trendAffinityStrength >= 0.16) {
        return '正在上升的趋势内容';
    }
    if (context.evidenceConfidence >= 0.62 || context.crossLaneSourceCount >= 2) {
        return '多路召回共同推荐';
    }
    if (context.explorationEligible >= 0.5 && context.explorationRisk <= 0.5) {
        return '低风险探索内容';
    }
    if (context.interestDecayMultiplier >= 1.05) {
        return '近期兴趣增强推荐';
    }
    if (context.explorationNovelty >= 0.48 && candidate.selectionPool === 'exploration') {
        return '多样化探索内容';
    }
    if (context.authorAffinityScore >= 0.24) {
        return '你常互动的作者';
    }
    if (context.contentQuality >= 0.74 && (candidate.commentCount || 0) >= 2) {
        return '近期高质量讨论';
    }

    switch (candidate.recallSource) {
        case 'FollowingSource':
            return buildAuthorRecommendationReason({
                inNetwork: true,
                authorAffinity: context.authorAffinityScore,
                recentPosts: candidate.commentCount,
                engagementScore: candidate.likeCount,
            });
        case 'GraphSource':
        case 'GraphKernelSource':
            if (context.embeddingMatched) {
                return '跨圈层桥接作者';
            }
            return buildAuthorRecommendationReason({
                graphProximity: candidate.graphScore,
                authorAffinity: context.authorAffinityScore,
            });
        case 'EmbeddingAuthorSource':
            return buildAuthorRecommendationReason({
                graphProximity: candidate.graphScore,
                embeddingAffinity: Math.max(
                    context.authorClusterScore,
                    context.candidateClusterScore,
                ),
                clusterProducerPrior: context.authorClusterScore,
                authorAffinity: context.authorAffinityScore,
            });
        case 'TwoTowerSource':
            if (candidate.interestPoolKind === 'dense_pool') {
                return '与你近期兴趣相近';
            }
            if (candidate.interestPoolKind === 'cluster_pool') {
                return '与你关注的主题相近';
            }
            if (context.keywordScore > 0.1) {
                return '兴趣相近作者 · 关键词重合';
            }
            return buildAuthorRecommendationReason({
                embeddingAffinity: Math.max(
                    context.authorClusterScore,
                    context.candidateClusterScore,
                ),
                clusterProducerPrior: context.authorClusterScore,
                authorAffinity: context.authorAffinityScore,
            });
        case 'PopularSource':
            if (candidate.interestPoolKind === 'popular_embedding') {
                return '热门内容，且与你的兴趣相近';
            }
            return context.popularFallback
                ? '当前热门内容'
        : '热门内容，且与你的兴趣相近';
    case 'NewsAnnSource':
      return context.embeddingMatched ? '基于主题向量召回' : '新闻主题召回';
    case 'ColdStartSource':
      return '帮助你发现新的作者';
    default:
      if (context.authorAffinityScore > 0.2) {
        return '基于你的互动偏好';
      }
      return undefined;
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
