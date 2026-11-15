import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import {
  recommendationCandidatePayloadSchema,
  recommendationQueryPayloadSchema,
  RecommendationCandidatePayload,
} from '../../src/services/recommendation/rust/contracts';
import { phoenixScoresSchema } from '../../src/services/recommendation/contracts/algorithmContract';
import { canonicalDecisionJson } from '../../src/services/recommendation/decisionLog/contracts';

describe('Cross-Language Contract Roundtrip Tests', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const goldenCandidatePath = path.join(repoRoot, 'fixtures/contracts/golden_candidate_v1.json');
  const goldenQueryPath = path.join(repoRoot, 'fixtures/contracts/golden_query_v1.json');

  test('golden_candidate_v1 should preserve all extended fields without being stripped by Zod', () => {
    const rawContent = fs.readFileSync(goldenCandidatePath, 'utf8');
    const rawCandidate = JSON.parse(rawContent);

    // 解析前的原始断言
    expect(rawCandidate.topicIds).toEqual(['tech', 'ai', 'systems']);
    expect(rawCandidate.hasMedia).toBe(true);
    expect(rawCandidate.mediaType).toBe('video');
    expect(rawCandidate.videoDurationMs).toBe(42500);
    expect(rawCandidate.authorBlocksViewer).toBe(false);
    expect(rawCandidate.languageCode).toBe('zh-CN');
    expect(rawCandidate.postType).toBe('article');
    expect(rawCandidate.mutualFollowJaccard).toBe(0.625);
    expect(rawCandidate.followingReplied).toBe(true);
    expect(rawCandidate.isSubscriptionOnly).toBe(false);
    expect(rawCandidate.rankingSignals.contentKind).toBe(0.65);
    expect(rawCandidate.rankingSignals.trend).toBe(0.89);
    expect(rawCandidate.rankingSignals.sourceQuality).toBe(0.94);

    // 通过 Zod Schema 解析
    const parsed = recommendationCandidatePayloadSchema.parse(rawCandidate) as unknown as Record<string, unknown>;

    // 验证 Zod 是否无损保留了所有字段（在修复前，漏声明的字段会被 strip 掉变为 undefined）
    expect(parsed.topicIds).toEqual(['tech', 'ai', 'systems']);
    expect(parsed.hasMedia).toBe(true);
    expect(parsed.mediaType).toBe('video');
    expect(parsed.videoDurationMs).toBe(42500);
    expect(parsed.authorBlocksViewer).toBe(false);
    expect(parsed.languageCode).toBe('zh-CN');
    expect(parsed.postType).toBe('article');
    expect(parsed.mutualFollowJaccard).toBe(0.625);
    expect(parsed.followingReplied).toBe(true);
    expect(parsed.isSubscriptionOnly).toBe(false);

    // 验证 rankingSignals 字段
    const signals = parsed.rankingSignals as Record<string, number>;
    expect(signals.contentKind).toBe(0.65);
    expect(signals.trend).toBe(0.89);
    expect(signals.sourceQuality).toBe(0.94);

    // 验证跨端 Canonical 指纹生成
    const parsedHash = createHash('sha256').update(canonicalDecisionJson(parsed)).digest('hex');
    const rawHash = createHash('sha256').update(canonicalDecisionJson(rawCandidate)).digest('hex');
    expect(parsedHash).toBe(rawHash);
  });

  test('golden_query_v1 should parse demographics ageRange flexibly', () => {
    const rawContent = fs.readFileSync(goldenQueryPath, 'utf8');
    const rawQuery = JSON.parse(rawContent);

    expect(rawQuery.demographics).toBeDefined();
    expect(rawQuery.demographics.ageRange).toBe('18-24');
  });

  test('golden_candidate_v3 and golden_query_v3 should roundtrip V3 fields losslessly through Zod', () => {
    const rawCandidate = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'fixtures/contracts/golden_candidate_v3.json'), 'utf8'),
    );
    const rawQuery = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'fixtures/contracts/golden_query_v3.json'), 'utf8'),
    );

    const parsedCandidate = recommendationCandidatePayloadSchema.parse(rawCandidate) as unknown as Record<string, unknown>;
    const parsedScores = phoenixScoresSchema.parse(rawCandidate.phoenixScores);
    expect(parsedScores.expectedDwellSec).toBe(27.5);
    expect(parsedScores.dwellProbs).toHaveLength(5);
    expect(parsedCandidate.semanticIds).toEqual([12, 87, 203, 5, 199, 64]);
    expect(parsedCandidate.pageDecodeSlot).toBe(2);
    expect((parsedCandidate.contentSafetyLabels as Record<string, unknown>).safe).toBe(true);
    expect((parsedCandidate.slateContext as Record<string, unknown>).sidKL1).toBe(12);

    const parsedCandidateHash = createHash('sha256').update(canonicalDecisionJson(parsedCandidate)).digest('hex');
    const rawCandidateHash = createHash('sha256').update(canonicalDecisionJson(rawCandidate)).digest('hex');
    expect(parsedCandidateHash).toBe(rawCandidateHash);

    const parsedQuery = recommendationQueryPayloadSchema.parse(rawQuery) as unknown as Record<string, unknown>;
    expect(parsedQuery.predictionId).toBe('pred_v3_0001');
    expect(parsedQuery.hasCachedPosts).toBe(true);
    expect(parsedQuery.bloomFilterEntries).toEqual([123456789, 987654321]);
    expect((parsedQuery.columnarRetrievalSequence as Array<Record<string, unknown>>)[0].actionMask).toHaveLength(13);

    const parsedQueryHash = createHash('sha256').update(canonicalDecisionJson(parsedQuery)).digest('hex');
    const rawQueryHash = createHash('sha256').update(canonicalDecisionJson(rawQuery)).digest('hex');
    expect(parsedQueryHash).toBe(rawQueryHash);
  });
});
