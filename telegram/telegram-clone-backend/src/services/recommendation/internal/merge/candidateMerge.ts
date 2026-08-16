import type { FeedCandidate, RecallEvidence } from '../../types/FeedCandidate';
import type { FeedQuery } from '../../types/FeedQuery';
import type { SourceCandidateBatch as PipelineSourceCandidateBatch } from '../../framework';
import { getSourceMixingMultiplier } from '../../utils/sourceMixing';

export type SourceCandidateBatch = PipelineSourceCandidateBatch<FeedCandidate>;

export interface CandidateMergeResult {
  candidates: FeedCandidate[];
  laneCounts: Record<string, number>;
  detail: Record<string, unknown>;
}

export function mergeSourceCandidates(
  query: FeedQuery,
  sourceBatches: SourceCandidateBatch[],
  sourceOrder: string[],
): CandidateMergeResult {
  const sourceOrderRank = new Map(sourceOrder.map((sourceName, index) => [sourceName, index]));
  const merged: FeedCandidate[] = [];
  const indexByKey = new Map<string, number>();
  let duplicateRecallHits = 0;
  let multiSourceCandidates = 0;
  let secondaryRecallEdges = 0;
  let crossLaneRecallEdges = 0;

  for (const batch of sourceBatches) {
    for (const [candidateRank, rawCandidate] of batch.candidates.entries()) {
      const candidate = normalizeCandidateSource(
        rawCandidate,
        batch.sourceName,
        candidateRank,
        batch.candidates.length,
      );
      const key = candidateMergeKey(candidate);
      const existingIndex = indexByKey.get(key);
      if (existingIndex === undefined) {
        indexByKey.set(key, merged.length);
        merged.push(candidate);
        continue;
      }

      duplicateRecallHits += 1;
      const existing = merged[existingIndex];
      const incomingSource = candidate.recallSource || batch.sourceName;
      const existingSource = existing.recallSource || 'unknown';
      const promoteIncoming = shouldPromotePrimarySource(
        query,
        incomingSource,
        existingSource,
        sourceOrderRank.get(incomingSource) ?? Number.MAX_SAFE_INTEGER,
        sourceOrderRank.get(existingSource) ?? Number.MAX_SAFE_INTEGER,
      );

      if (promoteIncoming) {
        mergeSecondarySources(candidate, incomingSource, [
          existingSource,
          ...(existing.secondaryRecallSources || []),
        ]);
        fillMissingCandidateFields(candidate, existing);
        merged[existingIndex] = candidate;
      } else {
        fillMissingCandidateFields(existing, candidate);
        mergeSecondarySources(existing, existingSource, [
          incomingSource,
          ...(candidate.secondaryRecallSources || []),
        ]);
      }
    }
  }

  const laneCounts = Object.create(null) as Record<string, number>;
  for (const candidate of merged) {
    candidate.retrievalLane ||= sourceRetrievalLane(candidate.recallSource || '');
    laneCounts[candidate.retrievalLane] = (laneCounts[candidate.retrievalLane] || 0) + 1;
    const evidence = applyMultiSourceEvidence(candidate);
    if (evidence.secondaryCount > 0) {
      multiSourceCandidates += 1;
      secondaryRecallEdges += evidence.secondaryCount;
      crossLaneRecallEdges += evidence.crossLaneCount;
    }
  }

  return {
    candidates: merged,
    laneCounts,
    detail: {
      laneCounts,
      duplicateRecallHits,
      multiSourceCandidates,
      secondaryRecallEdges,
      crossLaneRecallEdges,
    },
  };
}

function normalizeCandidateSource(
  candidate: FeedCandidate,
  sourceName: string,
  sourceRank: number,
  sourceCandidateCount: number,
): FeedCandidate {
  const recallSource = candidate.recallSource || sourceName;
  const normalized = {
    ...candidate,
    recallSource,
    retrievalLane: candidate.retrievalLane || sourceRetrievalLane(recallSource),
    _scoreBreakdown: candidate._scoreBreakdown ? { ...candidate._scoreBreakdown } : undefined,
    recallEvidence: candidate.recallEvidence ? { ...candidate.recallEvidence } : undefined,
    secondaryRecallSources: candidate.secondaryRecallSources
      ? [...candidate.secondaryRecallSources]
      : undefined,
  };
  normalized.recallEvidence = buildSourceRecallEvidence(
    normalized,
    sourceRank,
    sourceCandidateCount,
  );
  return normalized;
}

function candidateMergeKey(candidate: FeedCandidate): string {
  const modelPostId = candidate.modelPostId?.trim();
  return modelPostId || candidate.postId.toString();
}

function shouldPromotePrimarySource(
  query: FeedQuery,
  incomingSource: string,
  existingSource: string,
  incomingRank: number,
  existingRank: number,
): boolean {
  const incomingMixing = getSourceMixingMultiplier(query, incomingSource);
  const existingMixing = getSourceMixingMultiplier(query, existingSource);
  return incomingMixing > existingMixing + Number.EPSILON
    || (Math.abs(incomingMixing - existingMixing) <= Number.EPSILON && incomingRank < existingRank);
}

function mergeSecondarySources(
  candidate: FeedCandidate,
  primarySource: string,
  incomingSources: string[],
): void {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const source of [...incomingSources, ...(candidate.secondaryRecallSources || [])]) {
    if (!source || source === primarySource || seen.has(source)) {
      continue;
    }
    seen.add(source);
    merged.push(source);
  }
  candidate.secondaryRecallSources = merged.length > 0 ? merged : undefined;
}

function fillMissingCandidateFields(target: FeedCandidate, source: FeedCandidate): void {
  const targetWithGraph = target as FeedCandidate & {
    graphScore?: number;
    graphPath?: string;
    graphRecallType?: string;
  };
  const sourceWithGraph = source as FeedCandidate & {
    graphScore?: number;
    graphPath?: string;
    graphRecallType?: string;
  };

  targetWithGraph.graphScore ??= sourceWithGraph.graphScore;
  targetWithGraph.graphPath ??= sourceWithGraph.graphPath;
  targetWithGraph.graphRecallType ??= sourceWithGraph.graphRecallType;
  target.inNetwork = target.inNetwork === true || source.inNetwork === true;
  target.authorAffinityScore ??= source.authorAffinityScore;
  target._scoreBreakdown = mergeScoreBreakdown(target._scoreBreakdown, source._scoreBreakdown);
}

function mergeScoreBreakdown(
  target: Record<string, number> | undefined,
  source: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!source) {
    return target;
  }
  const merged = { ...(target || {}) };
  for (const [key, value] of Object.entries(source)) {
    if (!Number.isFinite(value)) {
      continue;
    }
    const current = merged[key];
    merged[key] = typeof current === 'number' && Number.isFinite(current)
      ? Math.max(current, value)
      : value;
  }
  return merged;
}

function applyMultiSourceEvidence(candidate: FeedCandidate): {
  secondaryCount: number;
  sameLaneCount: number;
  crossLaneCount: number;
} {
  const primaryLane = candidate.retrievalLane || sourceRetrievalLane(candidate.recallSource || '');
  const secondarySources = candidate.secondaryRecallSources || [];
  let sameLaneCount = 0;
  let crossLaneCount = 0;

  for (const source of secondarySources) {
    if (sourceRetrievalLane(source) === primaryLane) {
      sameLaneCount += 1;
    } else {
      crossLaneCount += 1;
    }
  }

  const secondaryCount = secondarySources.length;
  const existing = candidate.recallEvidence || buildSourceRecallEvidence(candidate, 0, 1);
  const sourceRankScore = finiteNumber(existing.sourceRankScore) ?? 0;
  const sourceScore = finiteNumber(existing.sourceScore) ?? primaryCandidateScore(candidate);
  const sourceCount = 1 + secondaryCount;
  const effectiveSourceCount = Math.min(
    1 + secondaryCount,
    1 + Math.min(sameLaneCount, 2) * 0.55 + Math.min(crossLaneCount, 3) * 0.9,
  );
  const sourceDiversityScore = secondaryCount === 0
    ? 0
    : Math.min(1, (crossLaneCount / secondaryCount) * 0.82 + Math.min(sameLaneCount, 2) * 0.12);
  const confidence = Math.min(
    1,
    Math.max(finiteNumber(existing.confidence) ?? 0, 0.38)
      + sourceRankScore * 0.08
      + normalizeSourceScore(sourceScore) * 0.06
      + Math.max(0, effectiveSourceCount - 1) * 0.05
      + sourceDiversityScore * 0.08,
  );
  const multiSourceBonus = Math.min(0.14, sameLaneCount * 0.02 + crossLaneCount * 0.045);

  candidate.recallEvidence = {
    ...existing,
    primarySource: candidate.recallSource || existing.primarySource,
    primaryLane,
    sourceRank: finiteNumber(existing.sourceRank),
    sourceRankScore,
    sourceScore,
    sourceCount,
    sameLaneSourceCount: sameLaneCount,
    crossLaneSourceCount: crossLaneCount,
    confidence,
  };
  candidate._scoreBreakdown = {
    ...(candidate._scoreBreakdown || {}),
    retrievalSourceCount: sourceCount,
    retrievalSourceRankScore: sourceRankScore,
    retrievalSourceScore: sourceScore,
    retrievalSecondarySourceCount: secondaryCount,
    retrievalSameLaneSourceCount: sameLaneCount,
    retrievalCrossLaneSourceCount: crossLaneCount,
    retrievalCrossLaneBonus: Math.min(0.12, crossLaneCount * 0.045),
    retrievalMultiSourceBonus: multiSourceBonus,
    retrievalEvidenceConfidence: confidence,
  };

  return { secondaryCount, sameLaneCount, crossLaneCount };
}

function buildSourceRecallEvidence(
  candidate: FeedCandidate,
  sourceRank: number,
  sourceCandidateCount: number,
): RecallEvidence {
  const existing = candidate.recallEvidence;
  const rank = finiteNumber(existing?.sourceRank) ?? sourceRank;
  const rankScore = finiteNumber(existing?.sourceRankScore)
    ?? (sourceCandidateCount <= 1 ? 1 : 1 - sourceRank / (sourceCandidateCount - 1));
  const sourceScore = finiteNumber(existing?.sourceScore) ?? primaryCandidateScore(candidate);
  return {
    ...existing,
    primarySource: candidate.recallSource || existing?.primarySource,
    primaryLane: candidate.retrievalLane || existing?.primaryLane,
    sourceRank: rank,
    sourceRankScore: rankScore,
    sourceScore,
    sourceCount: finiteNumber(existing?.sourceCount) ?? 1,
    sameLaneSourceCount: finiteNumber(existing?.sameLaneSourceCount) ?? 0,
    crossLaneSourceCount: finiteNumber(existing?.crossLaneSourceCount) ?? 0,
    confidence: finiteNumber(existing?.confidence)
      ?? Math.min(1, 0.42 + rankScore * 0.24 + normalizeSourceScore(sourceScore) * 0.18),
  };
}

function primaryCandidateScore(candidate: FeedCandidate): number {
  return finiteNumber(candidate.score)
    ?? finiteNumber(candidate._pipelineScore)
    ?? finiteNumber(candidate.weightedScore)
    ?? 0;
}

function normalizeSourceScore(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value <= 1 ? value : value / (1 + value);
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sourceRetrievalLane(sourceName: string): string {
  switch (sourceName) {
    case 'FollowingSource':
      return 'in_network';
    case 'GraphSource':
    case 'GraphKernelSource':
      return 'social_expansion';
    case 'TwoTowerSource':
    case 'EmbeddingAuthorSource':
    case 'NewsAnnSource':
      return 'interest';
    default:
      return 'fallback';
  }
}
