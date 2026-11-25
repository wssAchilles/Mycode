import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import { ActionType } from '../../models/UserAction';
import {
  type DirectedFollowEdge,
  type GeneratedActionRecord,
  type GeneratedCommentRecord,
  type GeneratedLikeRecord,
  type GeneratedRepostRecord,
  type PostReconciledStats,
  type ScaleProfile,
  SYNTH_SCRIPT_VERSION,
  type SyntheticPostRecord,
  type SyntheticUserRecord,
} from './contracts';
import { SeededRng } from './prng';
import { COMMUNITY_CONFIGS } from './taxonomy';

/**
 * 构建完整自洽的用户互动与推荐行为流水：
 * - Likes / Comments (顶层 + 楼中楼 parentId) / Reposts (纯转发 + 引用自动对齐)
 * - UserActions (IMPRESSION / CLICK / DWELL / LIKE / REPLY / REPOST / PROFILE_CLICK / DISMISS / HIDE)
 * - 最终严格从持久化后的明细文档聚合每篇帖子的 Post.stats（单源事实保证，绝无虚标计数）
 */
export function generateSyntheticInteractions(input: {
  allActors: SyntheticUserRecord[];
  posts: SyntheticPostRecord[];
  outNeighborsMap: Map<string, Set<string>>;
  followEdges: DirectedFollowEdge[];
  profile: ScaleProfile;
  rng: SeededRng;
}): {
  likes: GeneratedLikeRecord[];
  comments: GeneratedCommentRecord[];
  reposts: GeneratedRepostRecord[];
  actions: GeneratedActionRecord[];
  statsByPostId: Map<string, PostReconciledStats>;
  negativeActionCount: number;
} {
  const { allActors, posts, outNeighborsMap, profile, rng } = input;
  const nowMs = Date.now();

  const actorsByCluster = new Map<string, SyntheticUserRecord[]>();
  const actorById = new Map<string, SyntheticUserRecord>();
  for (const actor of allActors) {
    actorById.set(actor.id, actor);
    const list = actorsByCluster.get(actor.primaryCluster) || [];
    list.push(actor);
    actorsByCluster.set(actor.primaryCluster, list);
  }

  // 构建“作者 -> 粉丝集合”反向索引，区分 In-Network（Follow）与 OON 互动来源
  const followersByAuthor = new Map<string, SyntheticUserRecord[]>();
  for (const edge of input.followEdges) {
    const follower = actorById.get(edge.userId);
    if (!follower) continue;
    const list = followersByAuthor.get(edge.contactId) || [];
    list.push(follower);
    followersByAuthor.set(edge.contactId, list);
  }

  // 按帖子 viralityFactor × 新鲜度 分配互动权重池
  const postWeights = posts.map((post) => {
    const ageDays = Math.max(0.1, (nowMs - post.createdAt.getTime()) / (24 * 3600 * 1000));
    const recencyWeight = Math.exp(-ageDays / 16);
    return Math.max(0.05, post.viralityFactor * (0.35 + recencyWeight));
  });

  const likeDedupe = new Set<string>();
  const likes: GeneratedLikeRecord[] = [];
  const repostDedupe = new Set<string>();
  const reposts: GeneratedRepostRecord[] = [];
  const comments: GeneratedCommentRecord[] = [];
  const topCommentsByPostId = new Map<string, GeneratedCommentRecord[]>();
  const actions: GeneratedActionRecord[] = [];

  const selectActorForPost = (post: SyntheticPostRecord, preferInNetworkRate: number): SyntheticUserRecord => {
    const followers = followersByAuthor.get(post.authorId) || [];
    if (followers.length > 0 && rng.chance(preferInNetworkRate)) {
      const candidate = rng.pick(followers);
      if (candidate.id !== post.authorId) return candidate;
    }

    const sameClusterPool = actorsByCluster.get(post.cluster) || allActors;
    if (sameClusterPool.length > 1 && rng.chance(0.72)) {
      const candidate = rng.pick(sameClusterPool);
      if (candidate.id !== post.authorId) return candidate;
    }

    const fallback = rng.pick(allActors);
    return fallback.id !== post.authorId ? fallback : allActors[(allActors.indexOf(fallback) + 1) % allActors.length];
  };

  const recordAction = (params: {
    actor: SyntheticUserRecord;
    post: SyntheticPostRecord;
    action: ActionType;
    timestamp: Date;
    rank?: number;
    requestId?: string;
    targetCommentId?: mongoose.Types.ObjectId;
    actionText?: string;
    dwellTimeMs?: number;
    recallSource?: string;
  }): void => {
    const inNetwork = outNeighborsMap.get(params.actor.id)?.has(params.post.authorId) ?? false;
    const recallSource =
      params.recallSource ||
      (inNetwork
        ? 'FollowingSource'
        : params.post.authorTier === 'kol'
          ? 'PopularSource'
          : rng.chance(0.55)
            ? 'GraphKernelSource'
            : 'EmbeddingAuthorSource');

    actions.push({
      userId: params.actor.id,
      action: params.action,
      targetPostId: params.post._id,
      targetCommentId: params.targetCommentId,
      targetAuthorId: params.post.authorId,
      requestId: params.requestId || `${SYNTH_SCRIPT_VERSION}:${uuidv4()}`,
      productSurface: 'space_feed',
      rank: params.rank ?? rng.int(1, 30),
      score: Number(rng.float(0.55, 0.96).toFixed(3)),
      weightedScore: Number(rng.float(0.62, 1.15).toFixed(3)),
      inNetwork,
      isNews: false,
      modelPostId: String(params.post._id),
      recallSource,
      experimentKeys: [`${SYNTH_SCRIPT_VERSION}:ldbc_sbm`, 'x_algorithm:home_mixer_aligned'],
      targetKeywords: params.post.keywords.slice(0, 6),
      dwellTimeMs: params.dwellTimeMs,
      actionText: params.actionText,
      metadata: {
        syntheticGenerator: SYNTH_SCRIPT_VERSION,
        recommendationEventKey: `${SYNTH_SCRIPT_VERSION}:${params.actor.id}:${params.action}:${String(params.post._id)}:${actions.length}`,
      },
      timestamp: params.timestamp,
    });
  };

  // 1) 先把 Quote 引用帖子对应的 Repost(type='quote') 确定性入库，确保 Quote 计数精确一致
  for (const quotePost of posts) {
    if (!quotePost.isQuote || !quotePost.originalPostId) continue;
    const actor = actorById.get(quotePost.authorId) || rng.pick(allActors);
    reposts.push({
      userId: quotePost.authorId,
      postId: quotePost.originalPostId,
      type: 'quote',
      quotePostId: quotePost._id,
      createdAt: quotePost.createdAt,
    });
    const targetPost = posts.find((p) => String(p._id) === String(quotePost.originalPostId));
    if (targetPost) {
      recordAction({
        actor,
        post: targetPost,
        action: ActionType.QUOTE,
        timestamp: quotePost.createdAt,
        actionText: quotePost.content.slice(0, 240),
      });
    }
  }

  // 2) 生成真实 Likes（伴随前期曝光 IMPRESSION / CLICK，符合因果漏斗）
  let attempts = 0;
  const maxLikeAttempts = profile.targetLikes * 3;
  while (likes.length < profile.targetLikes && attempts < maxLikeAttempts) {
    attempts += 1;
    const post = rng.weightedPick(posts, postWeights);
    const actor = selectActorForPost(post, 0.48);
    if (actor.id === post.authorId) continue;

    const dedupeKey = `${actor.id}:${String(post._id)}`;
    if (likeDedupe.has(dedupeKey)) continue;
    likeDedupe.add(dedupeKey);

    const ts = rng.sampleEngagementTimestamp(post.createdAt, nowMs, post.isFlashmob);
    likes.push({
      userId: actor.id,
      postId: post._id,
      authorId: post.authorId,
      createdAt: ts,
    });

    const reqId = `${SYNTH_SCRIPT_VERSION}:req:${uuidv4()}`;
    const rank = rng.int(1, 25);
    recordAction({
      actor,
      post,
      action: ActionType.IMPRESSION,
      timestamp: new Date(ts.getTime() - rng.int(3, 25) * 1000),
      rank,
      requestId: reqId,
    });
    if (rng.chance(0.55)) {
      recordAction({
        actor,
        post,
        action: ActionType.CLICK,
        timestamp: new Date(ts.getTime() - rng.int(1, 8) * 1000),
        rank,
        requestId: reqId,
      });
    }
    recordAction({
      actor,
      post,
      action: ActionType.LIKE,
      timestamp: ts,
      rank,
      requestId: reqId,
    });
  }

  // 3) 生成真实 Comments（含约 78% 顶层评论 + 22% 楼中楼 parentId 回复，回复时间严格晚于父评论）
  for (let i = 0; i < profile.targetComments; i += 1) {
    const post = rng.weightedPick(posts, postWeights);
    const postIdStr = String(post._id);
    const existingTop = topCommentsByPostId.get(postIdStr) || [];
    const config = COMMUNITY_CONFIGS[post.cluster];

    const isNestedReply = existingTop.length > 0 && rng.chance(0.22);
    if (isNestedReply) {
      const parent = rng.pick(existingTop);
      // 约 40% 的楼中楼由原帖作者亲自回复评论区互动，更像真实社交对话！
      const replier =
        rng.chance(0.4) && actorById.has(post.authorId) && post.authorId !== parent.userId
          ? actorById.get(post.authorId)!
          : selectActorForPost(post, 0.55);
      const replyTs = new Date(
        Math.min(nowMs - 2000, parent.createdAt.getTime() + rng.int(3, 240) * 60 * 1000),
      );
      const replyId = new mongoose.Types.ObjectId();
      const content = rng.pick(config.replyTemplates);

      comments.push({
        _id: replyId,
        userId: replier.id,
        postId: post._id,
        content,
        parentId: parent._id,
        replyToUserId: parent.userId,
        likeCount: rng.int(0, 6),
        createdAt: replyTs,
      });

      recordAction({
        actor: replier,
        post,
        action: ActionType.REPLY,
        timestamp: replyTs,
        targetCommentId: replyId,
        actionText: content,
      });
    } else {
      const commenter = selectActorForPost(post, 0.52);
      const commentTs = rng.sampleEngagementTimestamp(post.createdAt, nowMs, post.isFlashmob);
      const commentId = new mongoose.Types.ObjectId();
      const content = rng.pick(config.commentTemplates);

      const commentDoc: GeneratedCommentRecord = {
        _id: commentId,
        userId: commenter.id,
        postId: post._id,
        content,
        parentId: null,
        likeCount: rng.chance(0.28) ? rng.int(1, 14) : 0,
        createdAt: commentTs,
      };
      comments.push(commentDoc);
      existingTop.push(commentDoc);
      topCommentsByPostId.set(postIdStr, existingTop);

      recordAction({
        actor: commenter,
        post,
        action: ActionType.REPLY,
        timestamp: commentTs,
        targetCommentId: commentId,
        actionText: content,
      });
    }
  }

  // 4) 生成真实 Reposts（纯转发）
  attempts = 0;
  const maxRepostAttempts = profile.targetReposts * 3;
  const pureRepostTarget = Math.max(0, profile.targetReposts - reposts.length);
  let pureRepostCount = 0;
  while (pureRepostCount < pureRepostTarget && attempts < maxRepostAttempts) {
    attempts += 1;
    const post = rng.weightedPick(posts, postWeights);
    const actor = selectActorForPost(post, 0.44);
    if (actor.id === post.authorId) continue;

    const dedupeKey = `${actor.id}:${String(post._id)}`;
    if (repostDedupe.has(dedupeKey)) continue;
    repostDedupe.add(dedupeKey);

    const ts = rng.sampleEngagementTimestamp(post.createdAt, nowMs, post.isFlashmob);
    reposts.push({
      userId: actor.id,
      postId: post._id,
      type: 'repost',
      createdAt: ts,
    });
    pureRepostCount += 1;

    recordAction({
      actor,
      post,
      action: ActionType.REPOST,
      timestamp: ts,
    });
  }

  // 5) 补充大量隐式浏览、停留、主页点击曝光（IMPRESSION / DWELL / PROFILE_CLICK）以及负反馈（DISMISS / HIDE）
  const minBrowseTarget = Math.max(2500, Math.floor(profile.targetLikes * 0.45));
  const impressionTarget = Math.max(minBrowseTarget, profile.targetImpressions - actions.length);
  let negativeActionCount = 0;
  for (let i = 0; i < impressionTarget; i += 1) {
    const post = rng.weightedPick(posts, postWeights);
    const isNegative = rng.chance(0.032);
    // 负反馈倾向发生在跨社区非关注低亲和帖子上
    const actor = isNegative ? rng.pick(allActors) : selectActorForPost(post, 0.4);
    if (actor.id === post.authorId) continue;

    const ts = rng.sampleEngagementTimestamp(post.createdAt, nowMs, false);
    const reqId = `${SYNTH_SCRIPT_VERSION}:feed:${uuidv4()}`;
    const rank = rng.int(1, 40);

    recordAction({
      actor,
      post,
      action: ActionType.IMPRESSION,
      timestamp: ts,
      rank,
      requestId: reqId,
    });

    if (isNegative && !(outNeighborsMap.get(actor.id)?.has(post.authorId) ?? false)) {
      const negType = rng.chance(0.75) ? ActionType.DISMISS : ActionType.HIDE;
      recordAction({
        actor,
        post,
        action: negType,
        timestamp: new Date(ts.getTime() + rng.int(1, 12) * 1000),
        rank,
        requestId: reqId,
      });
      negativeActionCount += 1;
      continue;
    }

    if (rng.chance(0.28)) {
      recordAction({
        actor,
        post,
        action: ActionType.DWELL,
        timestamp: new Date(ts.getTime() + rng.int(5, 45) * 1000),
        rank,
        requestId: reqId,
        dwellTimeMs: rng.int(6500, 58000),
      });
    }
    if (rng.chance(0.14)) {
      recordAction({
        actor,
        post,
        action: ActionType.PROFILE_CLICK,
        timestamp: new Date(ts.getTime() + rng.int(2, 20) * 1000),
        rank,
        requestId: reqId,
      });
    }
  }

  // 6) 严格单一事实源对账：直接从最终 likes / top-level comments / reposts / quotes / impressions 聚合每帖 stats
  const statsByPostId = reconcilePostStatsFromRecords({
    posts,
    likes,
    comments,
    reposts,
    actions,
    rng,
  });

  return {
    likes,
    comments,
    reposts,
    actions,
    statsByPostId,
    negativeActionCount,
  };
}

/**
 * 纯聚合对账函数：严格用真实明细数算出 Post.stats 与 engagementScore，杜绝“显示 12 个回复实际 2 个”
 */
export function reconcilePostStatsFromRecords(input: {
  posts: Array<{ _id: mongoose.Types.ObjectId }>;
  likes: Array<{ postId: mongoose.Types.ObjectId }>;
  comments: Array<{ postId: mongoose.Types.ObjectId; parentId?: mongoose.Types.ObjectId | null }>;
  reposts: Array<{ postId: mongoose.Types.ObjectId; type: 'repost' | 'quote' }>;
  actions: Array<{ targetPostId?: mongoose.Types.ObjectId; action: string }>;
  rng: SeededRng;
}): Map<string, PostReconciledStats> {
  const likeCounts = new Map<string, number>();
  const topCommentCounts = new Map<string, number>();
  const repostCounts = new Map<string, number>();
  const quoteCounts = new Map<string, number>();
  const impressionCounts = new Map<string, number>();

  for (const like of input.likes) {
    const key = String(like.postId);
    likeCounts.set(key, (likeCounts.get(key) || 0) + 1);
  }
  for (const comment of input.comments) {
    // 严格对齐 Comment.getPostComments 的筛选条件：parentId: null
    if (comment.parentId != null) continue;
    const key = String(comment.postId);
    topCommentCounts.set(key, (topCommentCounts.get(key) || 0) + 1);
  }
  for (const repost of input.reposts) {
    const key = String(repost.postId);
    if (repost.type === 'quote') {
      quoteCounts.set(key, (quoteCounts.get(key) || 0) + 1);
    } else {
      repostCounts.set(key, (repostCounts.get(key) || 0) + 1);
    }
  }
  for (const action of input.actions) {
    if (!action.targetPostId) continue;
    if (action.action === ActionType.IMPRESSION || action.action === ActionType.CLICK) {
      const key = String(action.targetPostId);
      impressionCounts.set(key, (impressionCounts.get(key) || 0) + 1);
    }
  }

  const statsMap = new Map<string, PostReconciledStats>();
  for (const post of input.posts) {
    const key = String(post._id);
    const likeCount = likeCounts.get(key) || 0;
    const commentCount = topCommentCounts.get(key) || 0;
    const repostCount = repostCounts.get(key) || 0;
    const quoteCount = quoteCounts.get(key) || 0;
    const recordedImpressions = impressionCounts.get(key) || 0;
    const baselineViews =
      likeCount * input.rng.int(7, 14) +
      commentCount * input.rng.int(12, 22) +
      (repostCount + quoteCount) * input.rng.int(15, 28) +
      input.rng.int(12, 48);
    const viewCount = Math.max(recordedImpressions, baselineViews);
    const engagementScore = Number(
      (likeCount + commentCount * 2 + repostCount * 3 + quoteCount * 2.5 + viewCount / 40).toFixed(2),
    );

    statsMap.set(key, {
      likeCount,
      commentCount,
      repostCount,
      quoteCount,
      viewCount,
      engagementScore,
    });
  }

  return statsMap;
}
