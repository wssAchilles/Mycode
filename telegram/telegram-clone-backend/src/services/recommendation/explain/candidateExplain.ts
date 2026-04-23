import type { FeedCandidate, RecommendationExplain } from '../types/FeedCandidate';
import type { FeedQuery } from '../types/FeedQuery';
import { buildAuthorRecommendationReason } from '../signals/authorSemantics';

const SIGNAL_KEYS = [
  'retrievalEmbeddingScore',
  'retrievalAuthorClusterScore',
  'retrievalCandidateClusterScore',
  'retrievalDenseVectorScore',
  'retrievalKeywordScore',
  'retrievalEngagementPrior',
  'annRetrievalScore',
  'calibrationSourceMultiplier',
  'calibrationEmbeddingQualityMultiplier',
  'authorAffinity',
  'affinityBoost',
  'diversityMultiplier',
  'oonFactor',
] as const;

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
  const breakdown = candidate._scoreBreakdown || {};
  const authorClusterScore = finite(breakdown.retrievalAuthorClusterScore) || 0;
  const candidateClusterScore = finite(breakdown.retrievalCandidateClusterScore) || 0;
  const denseVectorScore = finite(breakdown.retrievalDenseVectorScore) || 0;
  const keywordScore = finite(breakdown.retrievalKeywordScore) || 0;
  const embeddingScore = finite(breakdown.retrievalEmbeddingScore) || 0;
  const authorAffinityScore = finite(candidate.authorAffinityScore) || 0;
  const diversityMultiplier = finite(breakdown.diversityMultiplier) || 1;
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
  });

  return {
    detail: buildRecommendationDetail(candidate, {
      embeddingMatched,
      popularFallback,
      authorClusterScore,
      candidateClusterScore,
      keywordScore,
      authorAffinityScore,
    }),
    primarySource: source,
    sourceReason: buildSourceReason(source, { embeddingMatched, graphMatched, popularFallback }),
    inNetwork: candidate.inNetwork === true,
    embeddingMatched,
    graphMatched,
    popularFallback,
    diversityAdjusted,
    userState: query?.userStateContext?.state,
    evidence,
    signals: pickSignals(candidate),
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
  >,
): string | undefined {
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

function pickSignals(candidate: FeedCandidate): Record<string, number> | undefined {
  const breakdown = candidate._scoreBreakdown || {};
  const entries: Array<[string, number]> = [];

  for (const key of SIGNAL_KEYS) {
    const value = finite(breakdown[key]);
    if (typeof value === 'number') {
      entries.push([key, value]);
    }
  }

  const authorAffinityScore = finite(candidate.authorAffinityScore);
  if (typeof authorAffinityScore === 'number') {
    entries.push(['authorAffinityScore', authorAffinityScore]);
  }
  const weightedScore = finite(candidate.weightedScore);
  if (typeof weightedScore === 'number') {
    entries.push(['weightedScore', weightedScore]);
  }
  const finalScore = finite(candidate.score);
  if (typeof finalScore === 'number') {
    entries.push(['finalScore', finalScore]);
  }

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
