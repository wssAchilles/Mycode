import type { FeedCandidate } from '../../types/FeedCandidate';
import type { FeedQuery } from '../../types/FeedQuery';
import { getSourceMixingMultiplier } from '../../utils/sourceMixing';

export interface SourceCandidateBatch {
  sourceName: string;
  candidates: FeedCandidate[];
}

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
  const sourceRank = new Map(sourceOrder.map((sourceName, index) => [sourceName, index]));
  const merged: FeedCandidate[] = [];
  const indexByKey = new Map<string, number>();
  let duplicateRecallHits = 0;
  let multiSourceCandidates = 0;
  let secondaryRecallEdges = 0;
  let crossLaneRecallEdges = 0;

  for (const batch of sourceBatches) {
    for (const rawCandidate of batch.candidates) {
      const candidate = normalizeCandidateSource(rawCandidate, batch.sourceName);
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
        sourceRank.get(incomingSource) ?? Number.MAX_SAFE_INTEGER,
        sourceRank.get(existingSource) ?? Number.MAX_SAFE_INTEGER,
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

  const laneCounts: Record<string, number> = {};
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

function normalizeCandidateSource(candidate: FeedCandidate, sourceName: string): FeedCandidate {
  const recallSource = candidate.recallSource || sourceName;
  return {
    ...candidate,
    recallSource,
    retrievalLane: candidate.retrievalLane || sourceRetrievalLane(recallSource),
    _scoreBreakdown: candidate._scoreBreakdown ? { ...candidate._scoreBreakdown } : undefined,
    secondaryRecallSources: candidate.secondaryRecallSources
      ? [...candidate.secondaryRecallSources]
      : undefined,
  };
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
  if (secondaryCount > 0) {
    const multiSourceBonus = Math.min(0.14, sameLaneCount * 0.02 + crossLaneCount * 0.045);
    candidate._scoreBreakdown = {
      ...(candidate._scoreBreakdown || {}),
      retrievalSecondarySourceCount: secondaryCount,
      retrievalSameLaneSourceCount: sameLaneCount,
      retrievalCrossLaneSourceCount: crossLaneCount,
      retrievalCrossLaneBonus: Math.min(0.12, crossLaneCount * 0.045),
      retrievalMultiSourceBonus: multiSourceBonus,
      retrievalEvidenceConfidence: Math.min(1, 0.5 + secondaryCount * 0.1 + crossLaneCount * 0.12),
    };
  }

  return { secondaryCount, sameLaneCount, crossLaneCount };
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
