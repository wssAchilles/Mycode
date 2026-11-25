import { describe, expect, it } from 'vitest';

import { generateSyntheticPosts } from '../../src/scripts/synthetic/contentGenerator';
import { SCALE_PROFILES } from '../../src/scripts/synthetic/contracts';
import {
  buildSyntheticClusterDefinitions,
  buildSyntheticRealGraphEdges,
  buildSyntheticUserFeatureVectors,
} from '../../src/scripts/synthetic/featureGenerator';
import {
  generateCorrelatedFollowGraph,
  generateSyntheticUsers,
} from '../../src/scripts/synthetic/graphGenerator';
import { generateSyntheticInteractions } from '../../src/scripts/synthetic/interactionGenerator';
import { SeededRng } from '../../src/scripts/synthetic/prng';
import { classifyEmbeddingContractEvidence } from '../../src/services/recommendation/contracts/embeddingContractEvidence';

describe('synthetic social graph & recommendation data generator', () => {
  it('generates scale-free homophilic graph, exact post stats reconciliation, and contract-valid feature vectors', () => {
    const profile = SCALE_PROFILES.compact;
    const rng = new SeededRng(20261125);

    const syntheticUsers = generateSyntheticUsers(profile, rng);
    expect(syntheticUsers).toHaveLength(profile.totalUsers);

    const graphResult = generateCorrelatedFollowGraph({
      syntheticUsers,
      realUsersToAttach: [
        { id: '359ac58e-f58d-461b-bee6-40429e6b2f0a', username: '666', region: 'CN', language: 'zh' },
      ],
      rng,
    });
    const allActors = [...syntheticUsers, ...graphResult.attachedUsers];

    // 1. 验证同质性与幂律分层度分布（KOL 平均入度显著高于 Reader）
    const kolInDegrees = syntheticUsers
      .filter((u) => u.tier === 'kol')
      .map((u) => graphResult.inDegreeMap.get(u.id) || 0);
    const readerInDegrees = syntheticUsers
      .filter((u) => u.tier === 'reader')
      .map((u) => graphResult.inDegreeMap.get(u.id) || 0);
    const avgKolIn = kolInDegrees.reduce((a, b) => a + b, 0) / kolInDegrees.length;
    const avgReaderIn = readerInDegrees.reduce((a, b) => a + b, 0) / readerInDegrees.length;
    expect(avgKolIn).toBeGreaterThan(avgReaderIn * 4);

    // 验证真实融入账号同时具备关注出度、被关注入度，以及丰富的 2-hop 邻域
    const realOutCount = graphResult.outNeighborsMap.get('359ac58e-f58d-461b-bee6-40429e6b2f0a')?.size || 0;
    const realInCount = graphResult.inDegreeMap.get('359ac58e-f58d-461b-bee6-40429e6b2f0a') || 0;
    expect(realOutCount).toBeGreaterThanOrEqual(8);
    expect(realInCount).toBeGreaterThanOrEqual(8);

    // 2. 验证内容生成覆盖近 7 天热窗与 Quote/Flashmob 分布
    const posts = generateSyntheticPosts({
      users: syntheticUsers,
      attachedRealUsers: graphResult.attachedUsers,
      profile,
      rng,
    });
    expect(posts).toHaveLength(profile.targetPosts);
    expect(posts.some((p) => p.isFlashmob)).toBe(true);
    expect(posts.some((p) => p.isQuote && Boolean(p.originalPostId))).toBe(true);

    // 3. 验证互动生成与 Post.stats 严格单一事实源对账
    const interactions = generateSyntheticInteractions({
      allActors,
      posts,
      outNeighborsMap: graphResult.outNeighborsMap,
      followEdges: graphResult.edges,
      profile,
      rng,
    });

    const likeCounts = new Map<string, number>();
    for (const like of interactions.likes) {
      const k = String(like.postId);
      likeCounts.set(k, (likeCounts.get(k) || 0) + 1);
    }
    const topCommentCounts = new Map<string, number>();
    for (const comment of interactions.comments) {
      if (comment.parentId != null) continue;
      const k = String(comment.postId);
      topCommentCounts.set(k, (topCommentCounts.get(k) || 0) + 1);
    }

    for (const post of posts) {
      const reconciled = interactions.statsByPostId.get(String(post._id))!;
      expect(reconciled.likeCount).toBe(likeCounts.get(String(post._id)) || 0);
      expect(reconciled.commentCount).toBe(topCommentCounts.get(String(post._id)) || 0);
    }

    expect(interactions.comments.some((c) => c.parentId != null)).toBe(true);
    expect(interactions.negativeActionCount).toBeGreaterThan(0);

    // 4. 验证 RealGraphEdge 与 Embedding Contract 合规性
    const realGraphEdges = buildSyntheticRealGraphEdges({
      followEdges: graphResult.edges,
      actions: interactions.actions,
      allUsers: allActors,
    });
    expect(realGraphEdges.length).toBeGreaterThanOrEqual(graphResult.edges.length);
    for (const edge of realGraphEdges) {
      expect(edge.decayedSum).toBeGreaterThanOrEqual(0.05);
      expect(edge.interactionProbability).toBeGreaterThan(0);
    }

    const userVectors = buildSyntheticUserFeatureVectors(allActors);
    for (const vec of userVectors) {
      expect(vec.interestedInClusters.length).toBeGreaterThanOrEqual(3);
      expect(vec.qualityScore).toBeGreaterThan(0.45);
      const ttStatus = classifyEmbeddingContractEvidence({
        vector: vec.twoTowerEmbedding,
        perVectorContract: vec.twoTowerEmbeddingContract,
      });
      const phStatus = classifyEmbeddingContractEvidence({
        vector: vec.phoenixEmbedding,
        perVectorContract: vec.phoenixEmbeddingContract,
      });
      expect(ttStatus).toBe('verified_local_fallback');
      expect(phStatus).toBe('verified_local_fallback');
    }

    const clusterDefs = buildSyntheticClusterDefinitions({
      allUsers: allActors,
      posts,
      statsByPostId: interactions.statsByPostId,
      rng,
    });
    expect(clusterDefs).toHaveLength(12);
    for (const def of clusterDefs) {
      expect(def.topProducers.length).toBeGreaterThan(0);
    }
  });
});
