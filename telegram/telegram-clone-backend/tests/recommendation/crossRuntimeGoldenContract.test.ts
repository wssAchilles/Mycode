import crypto from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  deserializeRecommendationQuery,
  recommendationQueryPayloadSchema,
  serializeRecommendationQuery,
} from '../../src/services/recommendation/rust/contracts';
import {
  RECOMMENDATION_QUERY_HYDRATOR_ORDER,
  recommendationQueryHydratorStage,
} from '../../src/services/recommendation/internal/componentCatalog';
import { WeightedScorer } from '../../src/services/recommendation/scorers/WeightedScorer';

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures',
);
const FLOAT_TOLERANCE = 1e-8;

const fixtureReferenceSchema = z.object({
  path: z.string().min(1),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
});

const manifestSchema = z.object({
  manifestVersion: z.literal('recommendation_cross_runtime_manifest_v1'),
  domains: z.array(z.object({
    domain: z.string().min(1),
    version: z.string().min(1),
    fixtures: z.array(fixtureReferenceSchema).min(1),
  })).length(9),
});

const queryHydratorContractSchema = z.object({
  contractVersion: z.literal('recommendation_query_hydrator_contract_v1'),
  hydrators: z.array(z.object({
    name: z.string().min(1),
    stage: z.enum(['base', 'dependent']),
  })).min(1),
}).strict();

const identityEnvelopeSchema = z.object({
  servingPostId: z.string().min(1),
  modelPostId: z.string().min(1),
  idNamespace: z.string().min(1),
});

const weightedSummarySchema = z.object({
  inputMode: z.enum(['phoenix', 'action', 'heuristic']),
  baseRawScore: z.number(),
  positiveScore: z.number(),
  negativeScore: z.number(),
  evidenceScore: z.number(),
  rawScore: z.number(),
  normalizedWeightedScore: z.number(),
}).strict();

const weightedFixtureSchema = z.object({
  fixtureVersion: z.literal('recommendation_weighted_score_golden_v1'),
  identity: identityEnvelopeSchema,
  cases: z.array(z.object({
    name: z.string().min(1),
    input: z.object({
      phoenixScores: z.record(z.string(), z.number()).optional(),
      actionScores: z.record(z.string(), z.number()).optional(),
      heuristicScores: z.record(z.string(), z.number()).default({}),
      evidencePrior: z.number().default(0),
      signalPrior: z.number().default(0),
      videoDurationSec: z.number().optional(),
    }),
    expected: weightedSummarySchema,
  })).length(6),
});

type GoldenSummary = z.infer<typeof weightedSummarySchema> | {
  inputMode: 'node_legacy_fallback';
  baseRawScore: number;
  positiveScore: number;
  negativeScore: number;
  evidenceScore: number;
  rawScore: number;
  normalizedWeightedScore: number;
};

const phoenixFieldNames: Record<string, string> = {
  like: 'likeScore',
  reply: 'replyScore',
  repost: 'repostScore',
  quote: 'quoteScore',
  photoExpand: 'photoExpandScore',
  click: 'clickScore',
  quotedClick: 'quotedClickScore',
  profileClick: 'profileClickScore',
  videoQualityView: 'videoQualityViewScore',
  share: 'shareScore',
  shareViaDm: 'shareViaDmScore',
  shareViaCopyLink: 'shareViaCopyLinkScore',
  dwell: 'dwellScore',
  dwellTime: 'dwellTime',
  followAuthor: 'followAuthorScore',
  notInterested: 'notInterestedScore',
  dismiss: 'dismissScore',
  blockAuthor: 'blockAuthorScore',
  block: 'blockScore',
  muteAuthor: 'muteAuthorScore',
  report: 'reportScore',
};

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

function fixtureVersion(value: Record<string, unknown>): unknown {
  return value.fixtureVersion ?? value.replayVersion ?? value.manifestVersion ?? value.contractVersion;
}

function phoenixScores(scores?: Record<string, number>): Record<string, number> | undefined {
  return scores
    ? Object.fromEntries(Object.entries(scores).map(([key, value]) => [phoenixFieldNames[key], value]))
    : undefined;
}

function candidateInput(input: z.infer<typeof weightedFixtureSchema>['cases'][number]['input']) {
  const heuristic = input.heuristicScores;
  const viewCount = 100;
  const commentCount = (heuristic.replyProxy ?? 0) * 8;
  const repostCount = (heuristic.repostProxy ?? 0) * 6;
  const likeCount =
    (heuristic.engagementRate ?? 0) * 0.12 * viewCount - commentCount * 2 - repostCount * 3;
  const contentLength = (heuristic.contentProxy ?? 0) * 280;

  if (likeCount < 0 || !Number.isInteger(contentLength)) {
    throw new Error('weighted fixture heuristic input is not representable by a Node candidate');
  }

  return {
    phoenixScores: phoenixScores(input.phoenixScores),
    actionScores: input.actionScores,
    videoDurationSec: input.videoDurationSec,
    likeCount,
    commentCount,
    repostCount,
    viewCount,
    hasImage: heuristic.clickProxy === 0.18,
    hasVideo: false,
    content: 'x'.repeat(contentLength),
    authorAffinityScore: heuristic.followProxy ?? 0,
    rankingSignals: {
      relevance: input.signalPrior / 0.32,
      freshness: 0,
      popularity: 0,
      quality: 0,
      authorAffinity: 0,
      topicAffinity: 0,
      sourceAffinity: 0,
      conversationAffinity: 0,
      sourceEvidence: 0,
      network: 0,
      negativeFeedback: 0,
      deliveryFatigue: 0,
    },
    _scoreBreakdown: {
      retrievalAuthorPrior: (heuristic.retrievalSupport ?? 0) / 0.45,
      retrievalEvidenceConfidence: input.evidencePrior / 0.28,
    },
  };
}

function expectSummaryClose(actual: GoldenSummary, expected: z.infer<typeof weightedSummarySchema>) {
  expect(actual.inputMode).toBe(expected.inputMode);
  for (const field of [
    'baseRawScore',
    'positiveScore',
    'negativeScore',
    'evidenceScore',
    'rawScore',
    'normalizedWeightedScore',
  ] as const) {
    expect(Math.abs(actual[field] - expected[field])).toBeLessThanOrEqual(FLOAT_TOLERANCE);
  }
}

describe('cross-runtime golden contracts', () => {
  it('keeps the Node query hydrator catalog and stages aligned with the shared contract', () => {
    const contract = queryHydratorContractSchema.parse(
      JSON.parse(readFixture('query_hydrator_contract.json')),
    );

    expect([...RECOMMENDATION_QUERY_HYDRATOR_ORDER]).toEqual(
      contract.hydrators.map(({ name }) => name),
    );
    expect(contract.hydrators.map(({ name, stage }) => ({
      name,
      stage: recommendationQueryHydratorStage(name) === 0 ? 'base' : 'dependent',
    }))).toEqual(contract.hydrators);
  });

  it('validates manifest references, versions, and SHA-256 digests', () => {
    const manifest = manifestSchema.parse(JSON.parse(readFixture('cross_runtime_manifest.json')));
    expect(manifest.domains).toHaveLength(9);
    const fixturePaths = manifest.domains.flatMap(
      ({ fixtures }) => fixtures.map(({ path: fixturePath }) => fixturePath),
    );
    expect(fixturePaths).toContain('target_policy_distribution_stream_v1.json');
    expect(fixturePaths).toContain('target_distribution_stream_receipt_v2.json');

    for (const domain of manifest.domains) {
      for (const reference of domain.fixtures) {
        const raw = readFixture(reference.path);
        expect(crypto.createHash('sha256').update(raw).digest('hex')).toBe(reference.digest);
        expect(fixtureVersion(JSON.parse(raw))).toBe(domain.version);
      }
    }
  });

  it('matches Rust weighted summaries for canonical Phoenix, action, and heuristic inputs', () => {
    const fixture = weightedFixtureSchema.parse(JSON.parse(readFixture('weighted_score_golden.json')));
    expect(identityEnvelopeSchema.parse(JSON.parse(JSON.stringify(fixture.identity)))).toEqual(
      fixture.identity,
    );
    const scorer = new WeightedScorer() as WeightedScorer & {
      summarize(candidate: Record<string, unknown>): GoldenSummary;
    };

    for (const testCase of fixture.cases) {
      const summary = scorer.summarize(candidateInput(testCase.input));
      expectSummaryClose(summary, testCase.expected);
    }
  });

  it('labels unsupported heuristic input as node_legacy_fallback', () => {
    const scorer = new WeightedScorer() as WeightedScorer & {
      summarize(candidate: Record<string, unknown>): GoldenSummary;
    };

    expect(scorer.summarize({ likeCount: 20, viewCount: 100 })).toEqual({
      inputMode: 'node_legacy_fallback',
      baseRawScore: 0,
      positiveScore: 0,
      negativeScore: 0,
      evidenceScore: 0,
      rawScore: 0,
      normalizedWeightedScore: 0.1,
    });
  });

  it('round-trips the shared replay query embedding contract through Zod normalizers (Phase 1B)', () => {
    const replay = JSON.parse(readFixture('replay_warm_user.json'));
    const parsed = recommendationQueryPayloadSchema.parse(replay.scenarios[0].query);
    const roundTrip = serializeRecommendationQuery(deserializeRecommendationQuery(parsed));

    expect(roundTrip.embeddingContext?.embeddingContract).toEqual({
      embeddingSpace: 'recommendation_two_tower_v1',
      dimensions: 256,
      retrievalEmbeddingDim: 256,
      rankingEmbeddingDim: 256,
      modelVersion: '2026-04-29_kuai_lite256',
      artifactVersion: '2026-04-29_kuai_lite256',
      producer: 'cross_runtime_golden_fixture',
      semantic: true,
    });
  });

  it('round-trips a partial embedding contract through Zod normalizers', () => {
    const embeddingContract = {
      embeddingSpace: 'recommendation_two_tower_v1',
      modelVersion: '2026-04-29_kuai_lite256',
    };
    const parsed = recommendationQueryPayloadSchema.parse({
      requestId: 'partial-embedding-contract',
      decisionId: '942282e1-f2d4-4522-bbd2-fe5678279154',
      userId: 'viewer-partial',
      limit: 1,
      inNetworkOnly: false,
      seenIds: [],
      servedIds: [],
      isBottomRequest: false,
      embeddingContext: {
        interestedInClusters: [],
        producerEmbedding: [],
        usable: true,
        embeddingContract,
      },
    });
    const roundTrip = serializeRecommendationQuery(deserializeRecommendationQuery(parsed));

    expect(roundTrip.embeddingContext?.embeddingContract).toEqual(embeddingContract);
  });

  it('rejects non-positive embedding contract dimensions', () => {
    const query = {
      requestId: 'invalid-embedding-contract',
      decisionId: '4ae94c30-3d21-4cb9-8eeb-a6f354b74ac0',
      userId: 'viewer-invalid',
      limit: 1,
      inNetworkOnly: false,
      seenIds: [],
      servedIds: [],
      isBottomRequest: false,
      embeddingContext: {
        interestedInClusters: [],
        producerEmbedding: [],
        usable: true,
      },
    };

    for (const [field, value] of [
      ['dimensions', 0],
      ['dimensions', -1],
      ['retrievalEmbeddingDim', 0],
      ['retrievalEmbeddingDim', -1],
      ['rankingEmbeddingDim', 0],
      ['rankingEmbeddingDim', -1],
    ] as const) {
      expect(() => recommendationQueryPayloadSchema.parse({
        ...query,
        embeddingContext: {
          ...query.embeddingContext,
          embeddingContract: { [field]: value },
        },
      })).toThrow();
    }
  });
});
