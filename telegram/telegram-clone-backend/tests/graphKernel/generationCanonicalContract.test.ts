import { createHash } from 'node:crypto';

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as canonicalModule from '../../src/services/graphKernel/generation/canonical';
import type { GenerationWireManifest } from '../../src/services/graphKernel/generation/contracts';

const { canonicalizeGenerationEdges } = canonicalModule;

const counts = {
  followCount: 1,
  likeCount: 2,
  replyCount: 3,
  retweetCount: 4,
  quoteCount: 5,
  mentionCount: 6,
  profileViewCount: 7,
  tweetClickCount: 8,
  dwellTimeMs: 9,
  addressBookCount: 10,
  directMessageCount: 11,
  coEngagementCount: 12,
  contentAffinityCount: 13,
  muteCount: 14,
  blockCount: 15,
  reportCount: 16,
};

const edge = (sourceUserId: string, edgeId: string, targetUserId = 'target') => ({
  sourceUserId,
  targetUserId,
  edgeId,
  decayedSum: 1.5,
  interactionProbability: 0.25,
  dailySignalCounts: { ...counts },
  rollupSignalCounts: { ...counts },
  edgeKinds: ['like', 'follow'],
  lastInteractionAtMs: undefined,
  updatedAtMs: undefined,
});

describe('graph generation canonical NDJSON contract', () => {
  it('sorts by UTF-8 keyset and hashes the fixed literal bytes including final LF', () => {
    const first = edge('a', 'edge-a');
    const second = edge('\u{e000}', 'edge-b');
    const third = edge('\u{10000}', 'edge-c');

    const forward = canonicalizeGenerationEdges([third, second, first]);
    const reverse = canonicalizeGenerationEdges([first, second, third]);
    const countLiteral = '{"followCount":1,"likeCount":2,"replyCount":3,"retweetCount":4,"quoteCount":5,"mentionCount":6,"profileViewCount":7,"tweetClickCount":8,"dwellTimeMs":9,"addressBookCount":10,"directMessageCount":11,"coEngagementCount":12,"contentAffinityCount":13,"muteCount":14,"blockCount":15,"reportCount":16}';
    const expected = [first, second, third]
      .map((item) => `{"sourceUserId":${JSON.stringify(item.sourceUserId)},"targetUserId":"target","edgeId":"${item.edgeId}","decayedSum":1.5,"interactionProbability":0.25,"dailySignalCounts":${countLiteral},"rollupSignalCounts":${countLiteral},"edgeKinds":["follow","like"],"lastInteractionAtMs":null,"updatedAtMs":null}\n`)
      .join('');

    expect(canonicalModule).toHaveProperty('serializeCanonicalEdge');
    const serializeCanonicalEdge = (canonicalModule as unknown as {
      serializeCanonicalEdge: (value: typeof forward.edges[number]) => string;
    }).serializeCanonicalEdge;

    expect(forward).not.toHaveProperty('bytes');
    expect(forward.canonicalSha256).toBe(reverse.canonicalSha256);
    expect(forward.edges.map((item) => `${serializeCanonicalEdge(item)}\n`).join('')).toBe(expected);
    expect(forward.canonicalSha256).toBe(
      createHash('sha256').update(expected, 'utf8').digest('hex'),
    );
    expect(forward.generationId).toBe(`graph_generation_v2:${forward.canonicalSha256}`);
    expect(forward.contentVersion).toBe(`sha256:${forward.canonicalSha256}`);
  });

  it('uses target and edge id tie-breakers and rejects duplicate keysets', () => {
    const byTarget = edge('source', 'edge-z', 'target-a');
    const byEdge = edge('source', 'edge-a', 'target-z');
    const last = edge('source', 'edge-z', 'target-z');

    expect(canonicalizeGenerationEdges([last, byEdge, byTarget]).edges.map((item) => [
      item.targetUserId,
      item.edgeId,
    ])).toEqual([
      ['target-a', 'edge-z'],
      ['target-z', 'edge-a'],
      ['target-z', 'edge-z'],
    ]);
    expect(() => canonicalizeGenerationEdges([byEdge, { ...byEdge }])).toThrow(
      'generation_edge_duplicate_keyset',
    );
  });

  it('rejects missing opaque ids and non-finite numeric values', () => {
    expect(() => canonicalizeGenerationEdges([{ ...edge('a', '') }])).toThrow(
      'generation_edge_edge_id_required',
    );
    expect(() => canonicalizeGenerationEdges([
      { ...edge('a', 'edge-a'), decayedSum: Number.NaN },
    ])).toThrow('generation_edge_decayed_sum_non_finite');
    expect(() => canonicalizeGenerationEdges([
      {
        ...edge('a', 'edge-a'),
        dailySignalCounts: { ...counts, likeCount: Number.POSITIVE_INFINITY },
      },
    ])).toThrow('generation_edge_daily_signal_counts_like_count_non_finite');
    expect(() => canonicalizeGenerationEdges([
      { ...edge('a', 'edge-a'), decayedSum: -1 },
    ])).toThrow('generation_edge_decayed_sum_negative');
    expect(() => canonicalizeGenerationEdges([
      { ...edge('a', 'edge-a'), updatedAtMs: 1.5 },
    ])).toThrow('generation_edge_updated_at_ms_invalid_epoch_ms');
    expect(() => canonicalizeGenerationEdges([
      { ...edge('a', 'edge-a'), lastInteractionAtMs: -1 },
    ])).toThrow('generation_edge_last_interaction_at_ms_invalid_epoch_ms');
  });

  it('defaults only missing count fields and rejects invalid containers or explicit null', () => {
    expect(canonicalizeGenerationEdges([
      { ...edge('a', 'edge-a'), dailySignalCounts: {} },
    ]).edges[0].dailySignalCounts.likeCount).toBe(0);
    for (const dailySignalCounts of [null, [], 1]) {
      expect(() => canonicalizeGenerationEdges([
        { ...edge('a', 'edge-a'), dailySignalCounts } as never,
      ])).toThrow('generation_edge_daily_signal_counts_invalid');
    }
    expect(() => canonicalizeGenerationEdges([
      {
        ...edge('a', 'edge-a'),
        dailySignalCounts: { ...counts, likeCount: null },
      } as never,
    ])).toThrow('generation_edge_daily_signal_counts_like_count_non_finite');
  });

  it('accepts valid astral identifiers and rejects unpaired UTF-16 surrogates', () => {
    expect(() => canonicalizeGenerationEdges([edge('\u{10000}', 'edge-a')])).not.toThrow();
    expect(() => canonicalizeGenerationEdges([edge('\ud800', 'edge-a')])).toThrow(
      'generation_edge_source_user_id_invalid_utf16',
    );
    expect(() => canonicalizeGenerationEdges([
      { ...edge('source', 'edge-a'), edgeKinds: ['valid', '\udc00'] },
    ])).toThrow('generation_edge_edge_kind_invalid_utf16');
  });

  it('exposes only ready manifests on the wire', () => {
    expectTypeOf<GenerationWireManifest['status']>().toEqualTypeOf<'ready'>();
  });
});
