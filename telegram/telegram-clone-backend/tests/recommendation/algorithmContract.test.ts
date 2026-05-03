import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  ALGORITHM_CONTRACT_VERSION,
  parseAlgorithmContractFixture,
  projectRecommendationBoundaryToAlgorithmContract,
} from '../../src/services/recommendation/contracts/algorithmContract';

const fixturePath = path.resolve(
  __dirname,
  '../../../telegram-rust-recommendation/tests/fixtures/algorithm_contract_sample.json',
);

describe('canonical recommendation algorithm contract', () => {
  it('parses the same fixture used by the Rust recommendation contract', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const parsed = parseAlgorithmContractFixture(fixture);

    expect(parsed.contractVersion).toBe(ALGORITHM_CONTRACT_VERSION);
    expect(parsed.requestContext).toMatchObject({
      requestId: 'req-algorithm-contract-1',
      userId: 'viewer-1',
      limit: 3,
      inNetworkOnly: false,
      seenIds: ['post-seen-1'],
      servedIds: ['post-served-1'],
    });
    expect(parsed.requestContext.userActionSequence).toHaveLength(1);
    expect(parsed.candidates).toHaveLength(2);

    expect(parsed.candidates[0]).toMatchObject({
      identity: {
        postId: '507f191e810c19729de8c001',
        externalId: 'N12345',
        authorId: 'author-1',
        source: 'TwoTowerSource',
        inNetwork: false,
      },
      provenance: {
        primarySource: 'TwoTowerSource',
        retrievalLane: 'oon_ml',
        interestPoolKind: 'ann_pool',
        secondarySources: ['NewsAnnSource'],
        selectionPool: 'ranked_pool',
        selectionReason: 'weighted_score',
      },
      features: {
        isNews: true,
        hasVideo: false,
        videoDurationSec: null,
      },
      phoenixScores: {
        likeScore: 0.42,
        clickScore: 0.63,
        notInterestedScore: 0.02,
      },
      scoreMetadata: {
        scoreContractVersion: 'score_contract_v1',
        scoreBreakdownVersion: 'score_breakdown_v1',
      },
      weightedScore: 1.734,
      finalScore: 1.561,
    });

    expect(parsed.candidates[1].identity).toMatchObject({
      postId: '507f191e810c19729de8c002',
      authorId: 'author-2',
      source: 'FollowingSource',
      inNetwork: true,
    });
    expect(parsed.candidates[1].identity.externalId).toBeUndefined();
    expect(parsed.candidates[1].phoenixScores.videoQualityViewScore).toBe(0.52);
  });

  it('rejects payloads that blur score ownership', () => {
    const invalid = {
      contractVersion: ALGORITHM_CONTRACT_VERSION,
      requestContext: {
        requestId: 'req-1',
        userId: 'viewer-1',
        limit: 10,
        inNetworkOnly: false,
        seenIds: [],
        servedIds: [],
      },
      candidates: [
        {
          identity: {
            postId: 'post-1',
            authorId: 'author-1',
            source: 'FollowingSource',
            inNetwork: true,
          },
          features: { isNews: false },
          phoenixScores: {},
          weightedScore: 1,
        },
      ],
    };

    expect(() => parseAlgorithmContractFixture(invalid)).toThrow();
  });

  it('projects existing Rust boundary payloads into the canonical algorithm contract', () => {
    const projected = projectRecommendationBoundaryToAlgorithmContract(
      {
        requestId: 'req-boundary-1',
        userId: 'viewer-1',
        limit: 2,
        inNetworkOnly: false,
        seenIds: ['post-seen-1'],
        servedIds: ['post-served-1'],
        isBottomRequest: false,
        userActionSequence: [
          {
            actionType: 'like',
            targetPostId: 'post-history-1',
          },
        ],
      },
      [
        {
          postId: '507f191e810c19729de8c001',
          modelPostId: 'N12345',
          authorId: 'author-1',
          content: 'candidate',
          createdAt: '2026-05-03T00:00:00.000Z',
          isReply: false,
          isRepost: false,
          inNetwork: false,
          recallSource: 'TwoTowerSource',
          retrievalLane: 'oon_ml',
          interestPoolKind: 'ann_pool',
          secondaryRecallSources: ['NewsAnnSource', '  '],
          isNews: true,
          newsMetadata: {
            externalId: 'N12345',
          },
          phoenixScores: {
            likeScore: 0.42,
            clickScore: 0.63,
          },
          selectionPool: 'ranked_pool',
          selectionReason: 'weighted_score',
          scoreContractVersion: 'score_contract_v1',
          scoreBreakdownVersion: 'score_breakdown_v1',
          weightedScore: 1.734,
          score: 1.561,
        },
        {
          postId: '507f191e810c19729de8c002',
          modelPostId: '507f191e810c19729de8c002',
          authorId: 'author-2',
          content: 'candidate',
          createdAt: '2026-05-03T00:00:00.000Z',
          isReply: false,
          isRepost: false,
          inNetwork: true,
          recallSource: 'FollowingSource',
          retrievalLane: 'in_network',
          hasVideo: true,
          videoDurationSec: 42,
          phoenixScores: {
            videoQualityViewScore: 0.52,
          },
          scoreContractVersion: 'score_contract_v1',
          scoreBreakdownVersion: 'score_breakdown_v1',
          weightedScore: 1.212,
          score: 1.212,
        },
      ],
    );

    expect(projected.requestContext.userActionSequence).toHaveLength(1);
    expect(projected.candidates[0].identity).toMatchObject({
      postId: '507f191e810c19729de8c001',
      externalId: 'N12345',
      source: 'TwoTowerSource',
      inNetwork: false,
    });
    expect(projected.candidates[0].provenance).toMatchObject({
      primarySource: 'TwoTowerSource',
      retrievalLane: 'oon_ml',
      interestPoolKind: 'ann_pool',
      secondarySources: ['NewsAnnSource'],
      selectionPool: 'ranked_pool',
    });
    expect(projected.candidates[0].scoreMetadata).toMatchObject({
      scoreContractVersion: 'score_contract_v1',
      scoreBreakdownVersion: 'score_breakdown_v1',
    });
    expect(projected.candidates[1].identity.externalId).toBeUndefined();
    expect(projected.candidates[1].provenance.retrievalLane).toBe('in_network');
    expect(projected.candidates[1].features.videoDurationSec).toBe(42);
  });

  it('rejects boundary candidates without stable source and lane ownership', () => {
    expect(() =>
      projectRecommendationBoundaryToAlgorithmContract(
        {
          requestId: 'req-boundary-1',
          userId: 'viewer-1',
          limit: 1,
          inNetworkOnly: false,
          seenIds: [],
          servedIds: [],
          isBottomRequest: false,
        },
        [
          {
            postId: 'post-1',
            authorId: 'author-1',
            content: 'candidate',
            createdAt: '2026-05-03T00:00:00.000Z',
            isReply: false,
            isRepost: false,
            weightedScore: 1,
            score: 1,
          },
        ],
      ),
    ).toThrow(/candidate\.recallSource is required/);
  });
});
