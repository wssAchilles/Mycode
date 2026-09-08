import { describe, expect, it } from 'vitest';

import { evaluateReplayRequests } from '../../src/services/recommendation/replay/evaluator';

const labels = {
  click: false,
  like: false,
  reply: false,
  repost: false,
  quote: false,
  share: false,
  dismiss: false,
  blockAuthor: false,
  report: false,
  engagement: false,
  negative: false,
  dwellTimeMs: 0,
};

describe('replay logging readiness', () => {
  it('reports missing source, rank, score, experiment, and join fields separately from ranking quality', () => {
    const result = evaluateReplayRequests([
      {
        requestId: 'req_1',
        userId: 'user_1',
        requestAt: '2026-04-23T00:00:00.000Z',
        productSurface: 'space_feed',
        degradedReasons: [],
        selectedCount: 1,
        inNetworkCount: 0,
        outOfNetworkCount: 1,
        sourceCounts: [{ source: 'GraphSource', count: 1 }],
        authorDiversity: 1,
        replyRatio: 0,
        averageScore: 0.7,
        experimentKeys: ['space_feed_recsys:treatment'],
        candidates: [
          {
            postId: 'post_1',
            authorId: 'author_1',
            rank: 1,
            baselineRank: 1,
            recallSource: 'GraphSource',
            inNetwork: false,
            isNews: false,
            score: 0.7,
            labels: { ...labels, click: true, engagement: true },
          },
        ],
      },
      {
        requestId: '',
        userId: 'user_2',
        requestAt: '2026-04-23T00:01:00.000Z',
        productSurface: 'space_feed',
        degradedReasons: [],
        selectedCount: 1,
        inNetworkCount: 0,
        outOfNetworkCount: 1,
        sourceCounts: [],
        authorDiversity: 1,
        replyRatio: 0,
        averageScore: 0,
        experimentKeys: [],
        candidates: [
          {
            postId: '',
            authorId: 'author_2',
            baselineRank: Number.NaN,
            recallSource: '',
            inNetwork: false,
            isNews: false,
            labels,
          },
        ],
      },
    ] as any, 10, 'trace_final_score_v1');

    expect(result.loggingReadiness).toEqual({
      totalRequests: 2,
      requestsMissingRank: 1,
      requestsMissingRecallSource: 1,
      requestsMissingScore: 1,
      requestsMissingExperimentKeys: 1,
      requestsMissingFeedbackJoinKey: 1,
    });
    expect(result.baseline.averageNdcgAtK).toBeGreaterThanOrEqual(0);
  });
});
