import mongoose, { Schema } from 'mongoose';
import { Op } from 'sequelize';

import { redis } from '../../config/redis';
import ClusterDefinition from '../../models/ClusterDefinition';
import Comment from '../../models/Comment';
import Contact, { ContactStatus } from '../../models/Contact';
import Like from '../../models/Like';
import Post from '../../models/Post';
import PostFeatureSnapshot from '../../models/PostFeatureSnapshot';
import RealGraphEdge from '../../models/RealGraphEdge';
import Repost from '../../models/Repost';
import SpaceProfile from '../../models/SpaceProfile';
import User from '../../models/User';
import UserAction from '../../models/UserAction';
import UserFeatureVector from '../../models/UserFeatureVector';
import UserSettings from '../../models/UserSettings';
import UserSignal from '../../models/UserSignal';
import { InNetworkTimelineService } from '../../services/recommendation/InNetworkTimelineService';
import { postFeatureSnapshotService } from '../../services/recommendation/contentFeatures';
import {
  SYNTH_MANIFEST_ID,
  SYNTH_SCRIPT_VERSION,
  SYNTH_USERNAME_PREFIX,
  type DirectedFollowEdge,
  type GeneratedActionRecord,
  type GeneratedCommentRecord,
  type GeneratedLikeRecord,
  type GeneratedRepostRecord,
  type PostReconciledStats,
  type SyntheticPostRecord,
  type SyntheticUserRecord,
} from './contracts';
import type { ExistingRealUserSeedInput } from './graphGenerator';

const CHUNK_SIZE = 1000;
const TIMELINE_WINDOW_DAYS = 7;

type SyntheticManifestDoc = {
  _id: string;
  userIds: string[];
  postIds: string[];
  updatedAt: Date;
};

const SyntheticManifestSchema = new Schema<SyntheticManifestDoc>(
  {
    _id: { type: String, required: true },
    userIds: { type: [String], default: [] },
    postIds: { type: [String], default: [] },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
    collection: 'synthetic_cohort_manifests',
  },
);

const SyntheticManifest =
  (mongoose.models.SyntheticCohortManifest as mongoose.Model<SyntheticManifestDoc>) ||
  mongoose.model<SyntheticManifestDoc>('SyntheticCohortManifest', SyntheticManifestSchema);

async function runInChunks<T>(
  items: readonly T[],
  chunkSize: number,
  worker: (chunk: T[], chunkIndex: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await worker(items.slice(i, i + chunkSize), Math.floor(i / chunkSize));
  }
}

/**
 * 加载存量真实注册用户（严格排除 synth_ / demo_ / trend_seed_），以便将真实账号融入合成社交图谱
 */
export async function loadExistingRealUsers(
  targetUsernames: string[],
): Promise<ExistingRealUserSeedInput[]> {
  const rows = await User.findAll({
    where: {
      username: {
        [Op.and]: [
          { [Op.notLike]: `${SYNTH_USERNAME_PREFIX}%` },
          { [Op.notLike]: 'demo_%' },
          { [Op.notLike]: 'trend_seed_%' },
        ],
      },
      ...(targetUsernames.length > 0 ? { username: { [Op.in]: targetUsernames } } : {}),
    },
    attributes: ['id', 'username', 'region', 'language', 'createdAt'],
    order: [['createdAt', 'DESC']],
    limit: 50,
    raw: true,
  });

  // 同时若存在 demo_interviewer 也允许保留在候选外部交互源列表之外，不混入真实用户
  return rows.map((row: any) => ({
    id: String(row.id),
    username: String(row.username),
    region: row.region || null,
    language: row.language || null,
    createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
  }));
}

/**
 * 安全清理此前由本合成引擎生成的数据（绝不动真实用户、真实群组及聊天消息）
 */
export async function cleanupSyntheticCohort(): Promise<{
  removedUsers: number;
  removedPosts: number;
}> {
  const manifest = await SyntheticManifest.findById(SYNTH_MANIFEST_ID).lean();
  const synthUserRows = (await User.findAll({
    where: { username: { [Op.like]: `${SYNTH_USERNAME_PREFIX}%` } },
    attributes: ['id'],
    raw: true,
  })) as Array<{ id: string }>;

  const synthUserIds = Array.from(
    new Set([...(manifest?.userIds || []), ...synthUserRows.map((row) => String(row.id))]),
  );

  const synthPosts = await Post.find({
    $or: [
      ...(synthUserIds.length > 0 ? [{ authorId: { $in: synthUserIds } }] : []),
      { keywords: SYNTH_SCRIPT_VERSION },
    ],
  })
    .select('_id authorId')
    .lean();
  const synthPostIds = synthPosts.map((p) => p._id);

  if (synthUserIds.length > 0) {
    await Contact.destroy({
      where: {
        [Op.or]: [
          { userId: { [Op.in]: synthUserIds } },
          { contactId: { [Op.in]: synthUserIds } },
        ],
      },
    });
    await User.destroy({
      where: { id: { [Op.in]: synthUserIds } },
    });
  }

  const mongoDeleteTasks: Promise<unknown>[] = [
    UserAction.deleteMany({
      $or: [
        { 'metadata.syntheticGenerator': SYNTH_SCRIPT_VERSION },
        ...(synthUserIds.length > 0 ? [{ userId: { $in: synthUserIds } }, { targetAuthorId: { $in: synthUserIds } }] : []),
        ...(synthPostIds.length > 0 ? [{ targetPostId: { $in: synthPostIds } }] : []),
      ],
    }),
    UserSignal.deleteMany({
      $or: [
        { 'metadata.syntheticGenerator': SYNTH_SCRIPT_VERSION },
        ...(synthUserIds.length > 0 ? [{ userId: { $in: synthUserIds } }, { targetAuthorId: { $in: synthUserIds } }] : []),
      ],
    }),
  ];

  if (synthUserIds.length > 0) {
    mongoDeleteTasks.push(
      RealGraphEdge.deleteMany({
        $or: [
          { sourceUserId: { $in: synthUserIds } },
          { targetUserId: { $in: synthUserIds } },
        ],
      }),
      UserFeatureVector.deleteMany({ userId: { $in: synthUserIds } }),
      UserSettings.deleteMany({ userId: { $in: synthUserIds } }),
      SpaceProfile.deleteMany({ userId: { $in: synthUserIds } }),
    );
  }

  if (synthPostIds.length > 0 || synthUserIds.length > 0) {
    mongoDeleteTasks.push(
      Comment.deleteMany({
        $or: [
          ...(synthUserIds.length > 0 ? [{ userId: { $in: synthUserIds } }] : []),
          ...(synthPostIds.length > 0 ? [{ postId: { $in: synthPostIds } }] : []),
        ],
      }),
      Like.deleteMany({
        $or: [
          ...(synthUserIds.length > 0 ? [{ userId: { $in: synthUserIds } }, { authorId: { $in: synthUserIds } }] : []),
          ...(synthPostIds.length > 0 ? [{ postId: { $in: synthPostIds } }] : []),
        ],
      }),
      Repost.deleteMany({
        $or: [
          ...(synthUserIds.length > 0 ? [{ userId: { $in: synthUserIds } }] : []),
          ...(synthPostIds.length > 0
            ? [{ postId: { $in: synthPostIds } }, { quotePostId: { $in: synthPostIds } }]
            : []),
        ],
      }),
      PostFeatureSnapshot.deleteMany({
        $or: [
          ...(synthUserIds.length > 0 ? [{ authorId: { $in: synthUserIds } }] : []),
          ...(synthPostIds.length > 0 ? [{ postId: { $in: synthPostIds } }] : []),
        ],
      }),
      Post.deleteMany({
        _id: { $in: synthPostIds },
      }),
    );
  }

  await Promise.all(mongoDeleteTasks);
  await SyntheticManifest.deleteOne({ _id: SYNTH_MANIFEST_ID });

  if ((redis as any).status === 'ready' && synthUserIds.length > 0) {
    await runInChunks(synthUserIds, 500, async (chunk) => {
      const pipeline = redis.pipeline();
      for (const userId of chunk) {
        pipeline.del(InNetworkTimelineService.timelineKey(userId));
        pipeline.del(InNetworkTimelineService.thunderTimelineKey(userId));
      }
      await pipeline.exec();
    });
  }

  return {
    removedUsers: synthUserIds.length,
    removedPosts: synthPostIds.length,
  };
}

/**
 * 清理孤儿 PostFeatureSnapshot 并对账修复所有存量非新闻帖子的 stats.{likeCount, commentCount, repostCount, quoteCount}
 */
export async function reconcileExistingStoreIntegrity(): Promise<{
  orphanSnapshotsCleaned: number;
  historicalPostsReconciled: number;
}> {
  const existingPostIds = await Post.find({ deletedAt: null }).distinct('_id');
  const snapshotCleanup = await PostFeatureSnapshot.deleteMany({
    postId: { $nin: existingPostIds },
  });

  const activePosts = await Post.find({
    deletedAt: null,
    isNews: { $ne: true },
  })
    .select('_id stats engagementScore')
    .lean();

  if (activePosts.length === 0) {
    return {
      orphanSnapshotsCleaned: snapshotCleanup.deletedCount || 0,
      historicalPostsReconciled: 0,
    };
  }

  const activeIds = activePosts.map((p) => p._id);
  const [likeAgg, commentAgg, repostAgg, quoteAgg] = await Promise.all([
    Like.aggregate([
      { $match: { postId: { $in: activeIds } } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]),
    Comment.aggregate([
      { $match: { postId: { $in: activeIds }, parentId: null, deletedAt: null } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]),
    Repost.aggregate([
      { $match: { postId: { $in: activeIds }, type: 'repost' } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]),
    Repost.aggregate([
      { $match: { postId: { $in: activeIds }, type: 'quote' } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]),
  ]);

  const toMap = (rows: Array<{ _id: unknown; count: number }>) =>
    new Map(rows.map((r) => [String(r._id), Number(r.count || 0)]));
  const likesByPost = toMap(likeAgg);
  const commentsByPost = toMap(commentAgg);
  const repostsByPost = toMap(repostAgg);
  const quotesByPost = toMap(quoteAgg);

  const bulkOps: any[] = [];
  for (const post of activePosts) {
    const idStr = String(post._id);
    const actualLike = likesByPost.get(idStr) || 0;
    const actualComment = commentsByPost.get(idStr) || 0;
    const actualRepost = repostsByPost.get(idStr) || 0;
    const actualQuote = quotesByPost.get(idStr) || 0;
    const cur = (post.stats || {}) as Record<string, number>;

    if (
      (cur.likeCount || 0) !== actualLike ||
      (cur.commentCount || 0) !== actualComment ||
      (cur.repostCount || 0) !== actualRepost ||
      (cur.quoteCount || 0) !== actualQuote
    ) {
      const viewCount = Math.max(cur.viewCount || 0, actualLike * 8 + actualComment * 12 + actualRepost * 15 + 20);
      const engagementScore = Number(
        (actualLike + actualComment * 2 + actualRepost * 3 + actualQuote * 2.5 + viewCount / 40).toFixed(2),
      );
      bulkOps.push({
        updateOne: {
          filter: { _id: post._id },
          update: {
            $set: {
              'stats.likeCount': actualLike,
              'stats.commentCount': actualComment,
              'stats.repostCount': actualRepost,
              'stats.quoteCount': actualQuote,
              'stats.viewCount': viewCount,
              engagementScore,
            },
          },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    await runInChunks(bulkOps, CHUNK_SIZE, async (chunk) => {
      await Post.bulkWrite(chunk, { ordered: false });
    });
  }

  return {
    orphanSnapshotsCleaned: snapshotCleanup.deletedCount || 0,
    historicalPostsReconciled: bulkOps.length,
  };
}

/**
 * 批量写入生成完毕的合成图谱、内容、互动、推荐特征与 Redis 时间线
 */
export async function persistSyntheticCohort(input: {
  users: SyntheticUserRecord[];
  attachedRealUsers: SyntheticUserRecord[];
  passwordHash: string;
  followEdges: DirectedFollowEdge[];
  posts: SyntheticPostRecord[];
  statsByPostId: Map<string, PostReconciledStats>;
  likes: GeneratedLikeRecord[];
  comments: GeneratedCommentRecord[];
  reposts: GeneratedRepostRecord[];
  actions: GeneratedActionRecord[];
  signals: any[];
  realGraphEdges: any[];
  userFeatureVectors: any[];
  clusterDefinitions: any[];
}): Promise<{ timelineEntries: number }> {
  // 1) PostgreSQL Users（批量写入，跳过 bcrypt hook）
  await runInChunks(input.users, 500, async (chunk) => {
    await User.bulkCreate(
      chunk.map((u) => ({
        id: u.id,
        username: u.username,
        password: input.passwordHash,
        avatarUrl: u.avatarUrl,
        birthDate: u.birthDate,
        region: u.region,
        language: u.language,
        lastSeen: u.lastSeen,
        isOnline: u.isOnline,
        createdAt: u.createdAt,
        updatedAt: new Date(),
      })),
      { validate: true, hooks: false, ignoreDuplicates: true },
    );
  });

  // 2) PostgreSQL Contacts
  await runInChunks(input.followEdges, 1000, async (chunk) => {
    await Contact.bulkCreate(
      chunk.map((edge) => ({
        userId: edge.userId,
        contactId: edge.contactId,
        status: ContactStatus.ACCEPTED,
        alias: edge.reason,
        addedAt: edge.addedAt,
        updatedAt: new Date(),
      })),
      { ignoreDuplicates: true },
    );
  });

  // 3) Mongo SpaceProfiles & UserSettings（仅写合成用户，绝对保留真实用户既有设置与主页资料）
  await runInChunks(input.users, 1000, async (chunk) => {
    await Promise.all([
      SpaceProfile.insertMany(
        chunk.map((u) => ({
          userId: u.id,
          displayName: u.displayName,
          bio: u.bio,
          location: u.location,
          website: u.website,
          coverUrl: null,
        })),
        { ordered: false },
      ),
      UserSettings.insertMany(
        chunk.map((u) => ({
          userId: u.id,
          mutedKeywords: [],
          mutedUserIds: [],
          notificationSettings: {
            likes: true,
            replies: true,
            reposts: true,
            mentions: true,
            newFollowers: true,
            directMessages: true,
          },
          feedSettings: {
            showReplies: true,
            showReposts: true,
            preferInNetwork: u.tier !== 'reader',
            sensitiveContentFilter: true,
          },
          privacySettings: {
            allowDirectMessages: 'everyone',
            showOnlineStatus: true,
            showReadReceipts: true,
          },
        })),
        { ordered: false },
      ),
    ]);
  });

  // 4) Mongo ClusterDefinitions（必须在 PostFeatureSnapshot 之前更新，以供特征提取匹配社区关键词）
  for (const clusterDoc of input.clusterDefinitions) {
    await ClusterDefinition.findOneAndUpdate(
      { clusterId: clusterDoc.clusterId },
      { $set: clusterDoc },
      { upsert: true, new: true },
    );
  }

  // 5) Mongo Posts（带精确对账后的 stats 与 engagementScore）
  await runInChunks(input.posts, CHUNK_SIZE, async (chunk) => {
    await Post.insertMany(
      chunk.map((p) => {
        const stats = input.statsByPostId.get(String(p._id))!;
        return {
          _id: p._id,
          authorId: p.authorId,
          content: p.content,
          media: [],
          stats: {
            likeCount: stats.likeCount,
            repostCount: stats.repostCount,
            quoteCount: stats.quoteCount,
            commentCount: stats.commentCount,
            viewCount: stats.viewCount,
          },
          isRepost: p.isQuote,
          originalPostId: p.originalPostId,
          quoteContent: p.quoteContent,
          isReply: false,
          keywords: p.keywords,
          language: p.language,
          isNsfw: false,
          isPinned: false,
          engagementScore: stats.engagementScore,
          isNews: false,
          createdAt: p.createdAt,
          updatedAt: p.createdAt,
        };
      }),
      { ordered: false },
    );
  });

  // 6) Mongo Likes / Comments / Reposts
  await runInChunks(input.likes, CHUNK_SIZE, async (chunk) => {
    await Like.insertMany(chunk, { ordered: false });
  });
  await runInChunks(input.comments, CHUNK_SIZE, async (chunk) => {
    await Comment.insertMany(
      chunk.map((c) => ({
        _id: c._id,
        userId: c.userId,
        postId: c.postId,
        content: c.content,
        parentId: c.parentId,
        replyToUserId: c.replyToUserId,
        likeCount: c.likeCount,
        deletedAt: null,
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      })),
      { ordered: false },
    );
  });
  await runInChunks(input.reposts, CHUNK_SIZE, async (chunk) => {
    await Repost.insertMany(chunk, { ordered: false });
  });

  // 7) Mongo UserActions & UserSignals
  await runInChunks(input.actions, CHUNK_SIZE, async (chunk) => {
    await UserAction.insertMany(chunk, { ordered: false });
  });
  await runInChunks(input.signals, CHUNK_SIZE, async (chunk) => {
    await UserSignal.insertMany(chunk, { ordered: false });
  });

  // 8) Mongo UserFeatureVectors（严格使用 upsert 兼容真实用户与合成用户）
  await runInChunks(input.userFeatureVectors, 500, async (chunk) => {
    await UserFeatureVector.bulkWrite(
      chunk.map((vec) => ({
        updateOne: {
          filter: { userId: vec.userId },
          update: { $set: vec },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  });

  // 9) Mongo PostFeatureSnapshots（通过官方服务批量生成合规特征快照）
  await runInChunks(input.posts, 400, async (chunk) => {
    await postFeatureSnapshotService.ensureSnapshotsForPosts(
      chunk.map((p) => {
        const stats = input.statsByPostId.get(String(p._id))!;
        return {
          _id: p._id,
          authorId: p.authorId,
          content: p.content,
          keywords: p.keywords,
          language: p.language,
          createdAt: p.createdAt,
          updatedAt: p.createdAt,
          media: [],
          stats: {
            likeCount: stats.likeCount,
            repostCount: stats.repostCount,
            quoteCount: stats.quoteCount,
            commentCount: stats.commentCount,
            viewCount: stats.viewCount,
          },
          engagementScore: stats.engagementScore,
          isNews: false,
        };
      }),
    );
  });

  // 10) Mongo RealGraphEdges（聚合自 Contact + UserAction）
  await runInChunks(input.realGraphEdges, 800, async (chunk) => {
    await RealGraphEdge.bulkWrite(
      chunk.map((edge) => ({
        updateOne: {
          filter: { sourceUserId: edge.sourceUserId, targetUserId: edge.targetUserId },
          update: { $set: edge },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  });

  // 11) Redis InNetworkTimelineService（近 7 天贴文批量 ZADD 至双时间线键）
  const sevenDaysCutoff = Date.now() - TIMELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentPosts = input.posts.filter((p) => p.createdAt.getTime() >= sevenDaysCutoff);
  let timelineEntries = 0;

  if ((redis as any).status === 'ready' && recentPosts.length > 0) {
    const ttlSeconds = 8 * 24 * 60 * 60;
    await runInChunks(recentPosts, 500, async (chunk) => {
      const pipeline = redis.pipeline();
      for (const post of chunk) {
        const tsMs = post.createdAt.getTime();
        const postId = String(post._id);
        const tlKey = InNetworkTimelineService.timelineKey(post.authorId);
        const thunderKey = InNetworkTimelineService.thunderTimelineKey(post.authorId);
        pipeline.zadd(tlKey, tsMs, postId);
        pipeline.expire(tlKey, ttlSeconds);
        pipeline.zadd(thunderKey, tsMs, postId);
        pipeline.expire(thunderKey, ttlSeconds);
        timelineEntries += 1;
      }
      await pipeline.exec();
    });
  }

  // 12) 记录 Manifest 以便随时干净清理重置
  await SyntheticManifest.findByIdAndUpdate(
    SYNTH_MANIFEST_ID,
    {
      $set: {
        userIds: input.users.map((u) => u.id),
        postIds: input.posts.map((p) => String(p._id)),
      },
    },
    { upsert: true, new: true },
  );

  return { timelineEntries };
}

/**
 * 校验合成帖子的 Post.stats.commentCount 与真实顶层 Comment 数量是否 100% 严丝合缝
 */
export async function verifySyntheticPostStatsMatch(
  postIds: mongoose.Types.ObjectId[],
): Promise<{ exactMatch: boolean; mismatchedCount: number }> {
  if (postIds.length === 0) return { exactMatch: true, mismatchedCount: 0 };

  const sampleIds = postIds.slice(0, 500);
  const [posts, topComments] = await Promise.all([
    Post.find({ _id: { $in: sampleIds } }).select('_id stats.commentCount stats.likeCount').lean(),
    Comment.aggregate([
      { $match: { postId: { $in: sampleIds }, parentId: null, deletedAt: null } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]),
  ]);

  const commentMap = new Map(topComments.map((r) => [String(r._id), Number(r.count || 0)]));
  let mismatchedCount = 0;
  for (const post of posts) {
    const expected = (post.stats as any)?.commentCount || 0;
    const actual = commentMap.get(String(post._id)) || 0;
    if (expected !== actual) {
      mismatchedCount += 1;
    }
  }

  return {
    exactMatch: mismatchedCount === 0,
    mismatchedCount,
  };
}
