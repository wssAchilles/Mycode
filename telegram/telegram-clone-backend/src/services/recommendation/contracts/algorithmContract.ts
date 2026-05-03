import { z } from 'zod';
import type {
  RecommendationCandidatePayload,
  RecommendationQueryPayload,
} from '../rust/contracts';

export const ALGORITHM_CONTRACT_VERSION = 'recommendation_algorithm_contract_v1';

export const phoenixScoresSchema = z.object({
  likeScore: z.number().finite().optional(),
  replyScore: z.number().finite().optional(),
  repostScore: z.number().finite().optional(),
  quoteScore: z.number().finite().optional(),
  clickScore: z.number().finite().optional(),
  quotedClickScore: z.number().finite().optional(),
  profileClickScore: z.number().finite().optional(),
  dwellScore: z.number().finite().optional(),
  dwellTime: z.number().finite().optional(),
  shareScore: z.number().finite().optional(),
  shareViaDmScore: z.number().finite().optional(),
  shareViaCopyLinkScore: z.number().finite().optional(),
  photoExpandScore: z.number().finite().optional(),
  followAuthorScore: z.number().finite().optional(),
  videoQualityViewScore: z.number().finite().optional(),
  notInterestedScore: z.number().finite().optional(),
  dismissScore: z.number().finite().optional(),
  blockAuthorScore: z.number().finite().optional(),
  blockScore: z.number().finite().optional(),
  muteAuthorScore: z.number().finite().optional(),
  reportScore: z.number().finite().optional(),
});

export const algorithmRequestContextSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1),
  limit: z.number().int().min(1),
  inNetworkOnly: z.boolean(),
  seenIds: z.array(z.string()),
  servedIds: z.array(z.string()),
  userActionSequence: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const candidateIdentitySchema = z.object({
  postId: z.string().min(1),
  externalId: z.string().min(1).optional(),
  authorId: z.string().min(1),
  source: z.string().min(1),
  inNetwork: z.boolean(),
});

export const candidateProvenanceSchema = z.object({
  primarySource: z.string().min(1),
  retrievalLane: z.string().min(1).optional(),
  interestPoolKind: z.string().min(1).optional(),
  secondarySources: z.array(z.string().min(1)).default([]),
  selectionPool: z.string().min(1).optional(),
  selectionReason: z.string().min(1).optional(),
});

export const candidateFeaturesSchema = z.object({
  isNews: z.boolean(),
  hasVideo: z.boolean().optional(),
  videoDurationSec: z.number().finite().nullable().optional(),
});

export const scoreMetadataSchema = z.object({
  scoreContractVersion: z.string().min(1).optional(),
  scoreBreakdownVersion: z.string().min(1).optional(),
});

export const algorithmCandidateSchema = z.object({
  identity: candidateIdentitySchema,
  provenance: candidateProvenanceSchema,
  features: candidateFeaturesSchema.default({ isNews: false }),
  phoenixScores: phoenixScoresSchema.default({}),
  scoreMetadata: scoreMetadataSchema.default({}),
  weightedScore: z.number().finite(),
  finalScore: z.number().finite(),
});

export const algorithmContractFixtureSchema = z.object({
  contractVersion: z.literal(ALGORITHM_CONTRACT_VERSION),
  requestContext: algorithmRequestContextSchema,
  candidates: z.array(algorithmCandidateSchema),
});

export type PhoenixScoresContract = z.infer<typeof phoenixScoresSchema>;
export type AlgorithmRequestContext = z.infer<typeof algorithmRequestContextSchema>;
export type CandidateIdentity = z.infer<typeof candidateIdentitySchema>;
export type CandidateProvenance = z.infer<typeof candidateProvenanceSchema>;
export type CandidateFeatures = z.infer<typeof candidateFeaturesSchema>;
export type ScoreMetadata = z.infer<typeof scoreMetadataSchema>;
export type AlgorithmCandidate = z.infer<typeof algorithmCandidateSchema>;
export type AlgorithmContractFixture = z.infer<typeof algorithmContractFixtureSchema>;

export function parseAlgorithmContractFixture(value: unknown): AlgorithmContractFixture {
  return algorithmContractFixtureSchema.parse(value);
}

export function projectRecommendationQueryToAlgorithmContext(
  query: RecommendationQueryPayload,
): AlgorithmRequestContext {
  return algorithmRequestContextSchema.parse({
    requestId: query.requestId,
    userId: query.userId,
    limit: query.limit,
    inNetworkOnly: query.inNetworkOnly,
    seenIds: query.seenIds,
    servedIds: query.servedIds,
    userActionSequence: query.userActionSequence ?? [],
  });
}

export function projectRecommendationCandidateToAlgorithmCandidate(
  candidate: RecommendationCandidatePayload,
): AlgorithmCandidate {
  const source = candidate.recallSource?.trim();
  if (!source) {
    throw new Error('algorithm_contract_violation: candidate.recallSource is required');
  }
  if (candidate.inNetwork === undefined) {
    throw new Error('algorithm_contract_violation: candidate.inNetwork is required');
  }

  return algorithmCandidateSchema.parse({
    identity: {
      postId: candidate.postId,
      externalId: resolveExternalId(candidate),
      authorId: candidate.authorId,
      source,
      inNetwork: candidate.inNetwork,
    },
    provenance: {
      primarySource: source,
      retrievalLane: trimmedOptionalString(candidate.retrievalLane),
      interestPoolKind: trimmedOptionalString(candidate.interestPoolKind),
      secondarySources: trimmedStringArray(candidate.secondaryRecallSources),
      selectionPool: trimmedOptionalString(candidate.selectionPool),
      selectionReason: trimmedOptionalString(candidate.selectionReason),
    },
    features: {
      isNews: Boolean(candidate.isNews),
      hasVideo: candidate.hasVideo,
      videoDurationSec: candidate.videoDurationSec ?? undefined,
    },
    phoenixScores: candidate.phoenixScores ?? {},
    scoreMetadata: {
      scoreContractVersion: trimmedOptionalString(candidate.scoreContractVersion),
      scoreBreakdownVersion: trimmedOptionalString(candidate.scoreBreakdownVersion),
    },
    weightedScore: candidate.weightedScore,
    finalScore: candidate.score,
  });
}

export function projectRecommendationBoundaryToAlgorithmContract(
  query: RecommendationQueryPayload,
  candidates: RecommendationCandidatePayload[],
): AlgorithmContractFixture {
  return algorithmContractFixtureSchema.parse({
    contractVersion: ALGORITHM_CONTRACT_VERSION,
    requestContext: projectRecommendationQueryToAlgorithmContext(query),
    candidates: candidates.map(projectRecommendationCandidateToAlgorithmCandidate),
  });
}

function resolveExternalId(candidate: RecommendationCandidatePayload): string | undefined {
  const newsExternalId = candidate.newsMetadata?.externalId?.trim();
  if (newsExternalId) {
    return newsExternalId;
  }

  const modelPostId = candidate.modelPostId?.trim();
  if (modelPostId && modelPostId !== candidate.postId) {
    return modelPostId;
  }

  return undefined;
}

function trimmedOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function trimmedStringArray(values: string[] | undefined): string[] {
  return values?.map((value) => value.trim()).filter(Boolean) ?? [];
}
