import { Op } from 'sequelize';

import Contact, { ContactStatus } from '../../models/Contact';
import Post from '../../models/Post';
import RealGraphEdge from '../../models/RealGraphEdge';
import User from '../../models/User';
import UserAction, { ActionType } from '../../models/UserAction';
import UserFeatureVector from '../../models/UserFeatureVector';
import { buildUserStateContext } from '../../services/recommendation/utils/userState';
import { connectDemoStores, disconnectDemoStores } from './runtime';
import {
  DEMO_CLUSTER_CONFIGS,
  DEMO_CLUSTER_ORDER,
  DEMO_VIEWER_FOLLOW_STRONG_INDEXES,
  DEMO_VIEWER_FOLLOW_WEAK_INDEXES,
  DEMO_VIEWER_USERNAME,
  buildAuthorUsername,
} from './config';

const REPAIR_REQUEST_ID = 'interview_demo_recommendation_feature_repair_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_RECENT_POSITIVE_ACTIONS = 48;
const PRODUCTION_ACTION_SEQUENCE_LIMIT = 50;
const POPULAR_RECALL_INDEX_NAME = 'rec_popular_active_engagement_v1';

const positiveActions = [
  ActionType.CLICK,
  ActionType.LIKE,
  ActionType.REPLY,
  ActionType.REPOST,
];

const productionActionSequenceTypes = [
  ActionType.LIKE,
  ActionType.REPLY,
  ActionType.REPOST,
  ActionType.CLICK,
  ActionType.IMPRESSION,
];

type DemoUserRow = {
  id: string;
  username: string;
  createdAt?: Date;
};

type DemoPost = {
  _id: unknown;
  authorId: string;
  createdAt: Date;
  isNews?: boolean;
  stats?: {
    likeCount?: number;
    commentCount?: number;
    repostCount?: number;
  };
  engagementScore?: number;
};

type InteractionCounts = {
  followCount: number;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  quoteCount: number;
  mentionCount: number;
  profileViewCount: number;
  tweetClickCount: number;
  dwellTimeMs: number;
  addressBookCount: number;
  directMessageCount: number;
  coEngagementCount: number;
  contentAffinityCount: number;
  muteCount: number;
  blockCount: number;
  reportCount: number;
};

const emptyCounts = (): InteractionCounts => ({
  followCount: 0,
  likeCount: 0,
  replyCount: 0,
  retweetCount: 0,
  quoteCount: 0,
  mentionCount: 0,
  profileViewCount: 0,
  tweetClickCount: 0,
  dwellTimeMs: 0,
  addressBookCount: 0,
  directMessageCount: 0,
  coEngagementCount: 0,
  contentAffinityCount: 0,
  muteCount: 0,
  blockCount: 0,
  reportCount: 0,
});

const decayedSum = (counts: InteractionCounts): number =>
  counts.followCount * 10 +
  counts.likeCount * 1.4 +
  counts.replyCount * 3.2 +
  counts.retweetCount * 2.6 +
  counts.tweetClickCount * 0.5 +
  counts.profileViewCount * 0.45 +
  counts.contentAffinityCount * 0.7 +
  counts.dwellTimeMs * 0.0005;

const postEngagementScore = (post: Pick<DemoPost, 'stats'>): number => {
  const stats = post.stats || {};
  return (stats.likeCount || 0) + (stats.commentCount || 0) * 2 + (stats.repostCount || 0) * 3;
};

function targetAuthorUsernames(): string[] {
  const indexes = [...DEMO_VIEWER_FOLLOW_STRONG_INDEXES, ...DEMO_VIEWER_FOLLOW_WEAK_INDEXES];
  return DEMO_CLUSTER_ORDER.flatMap((cluster) =>
    indexes.map((index) => buildAuthorUsername(cluster, index)),
  );
}

async function ensureViewerContacts(viewer: DemoUserRow, authors: DemoUserRow[]): Promise<number> {
  let repaired = 0;
  for (const [index, author] of authors.entries()) {
    const [contact, created] = await Contact.findOrCreate({
      where: {
        userId: viewer.id,
        contactId: author.id,
      },
      defaults: {
        userId: viewer.id,
        contactId: author.id,
        status: ContactStatus.ACCEPTED,
        addedAt: new Date(Date.now() - (12 + index) * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
    });
    if (created) {
      repaired += 1;
      continue;
    }
    if (contact.status !== ContactStatus.ACCEPTED) {
      contact.status = ContactStatus.ACCEPTED;
      contact.updatedAt = new Date();
      await contact.save();
      repaired += 1;
    }
  }
  return repaired;
}

async function ensureViewerFeatureVector(viewer: DemoUserRow): Promise<void> {
  const now = new Date();
  const interestedInClusters = DEMO_CLUSTER_ORDER.map((cluster, index) => ({
    clusterId: DEMO_CLUSTER_CONFIGS[cluster].clusterId,
    score: Number((0.92 - index * 0.06).toFixed(3)),
  }));

  await UserFeatureVector.findOneAndUpdate(
    { userId: viewer.id },
    {
      $set: {
        userId: viewer.id,
        interestedInClusters,
        knownForCluster: DEMO_CLUSTER_CONFIGS.recsys.clusterId,
        knownForScore: 0.74,
        producerEmbedding: interestedInClusters.slice(0, 4),
        version: 4,
        modelVersion: 'interview_demo_recommendation_feature_repair_v1',
        computedAt: now,
        expiresAt: new Date(now.getTime() + 30 * DAY_MS),
        qualityScore: 0.86,
      },
    },
    { upsert: true, new: true },
  );
}

async function ensurePopularRecallIndex(): Promise<string> {
  await Post.collection.createIndex(
    { isNews: 1, deletedAt: 1, engagementScore: -1, createdAt: -1 },
    {
      name: POPULAR_RECALL_INDEX_NAME,
      background: true,
    },
  );
  return POPULAR_RECALL_INDEX_NAME;
}

async function ensureDemoPostEngagementScores(
  authors: DemoUserRow[],
): Promise<{ examined: number; repaired: number }> {
  const authorIds = authors.map((author) => author.id);
  const posts = await Post.find({
    authorId: { $in: authorIds },
    isNews: { $ne: true },
    deletedAt: null,
  })
    .select('_id stats engagementScore isNews')
    .lean<DemoPost[]>();

  const operations = posts
    .map((post) => {
      const engagementScore = postEngagementScore(post);
      if (post.engagementScore === engagementScore && post.isNews === false) return null;
      return {
        updateOne: {
          filter: { _id: post._id },
          update: {
            $set: {
              engagementScore,
              isNews: false,
            },
          },
        },
      };
    })
    .filter((operation): operation is NonNullable<typeof operation> => Boolean(operation));

  if (operations.length > 0) {
    await Post.bulkWrite(operations, { ordered: false });
  }

  return {
    examined: posts.length,
    repaired: operations.length,
  };
}

async function ensureRecentPositiveActions(
  viewer: DemoUserRow,
  authors: DemoUserRow[],
): Promise<number> {
  const authorIds = authors.map((author) => author.id);
  const posts = await Post.find({
    authorId: { $in: authorIds },
    isNews: { $ne: true },
    deletedAt: { $exists: false },
  })
    .sort({ createdAt: -1 })
    .limit(TARGET_RECENT_POSITIVE_ACTIONS * 2)
    .lean<DemoPost[]>();

  const selectedPosts = posts.slice(0, TARGET_RECENT_POSITIVE_ACTIONS);
  let upserted = 0;
  for (const [index, post] of selectedPosts.entries()) {
    const action = positiveActions[index % positiveActions.length];
    const timestamp = new Date(Date.now() - (index + 1) * 30 * 1000);
    const result = await UserAction.updateOne(
      {
        userId: viewer.id,
        requestId: REPAIR_REQUEST_ID,
        action,
        targetPostId: post._id,
      },
      {
        $set: {
          userId: viewer.id,
          action,
          targetPostId: post._id,
          targetAuthorId: post.authorId,
          requestId: REPAIR_REQUEST_ID,
          productSurface: 'space_feed',
          rank: (index % 20) + 1,
          score: 0,
          weightedScore: 0,
          inNetwork: authorIds.includes(post.authorId),
          isNews: Boolean(post.isNews),
          modelPostId: String(post._id),
          recallSource: authorIds.includes(post.authorId) ? 'FollowingSource' : 'GraphSource',
          experimentKeys: ['interview_demo:repair'],
          actionText: action === ActionType.REPLY
            ? 'Repair pass: recommendation graph feature should remain dense for this demo user.'
            : undefined,
          timestamp,
        },
      },
      { upsert: true },
    );
    upserted += result.upsertedCount || result.modifiedCount || 0;
  }
  return upserted;
}

async function ensureViewerGraphEdges(viewer: DemoUserRow, authors: DemoUserRow[]): Promise<number> {
  let repaired = 0;
  for (const [index, author] of authors.entries()) {
    const counts = emptyCounts();
    counts.followCount = 1;
    counts.likeCount = index % 3 === 0 ? 2 : 1;
    counts.replyCount = index % 4 === 0 ? 1 : 0;
    counts.retweetCount = index % 5 === 0 ? 1 : 0;
    counts.tweetClickCount = 2 + (index % 3);
    counts.contentAffinityCount = 1 + (index % 2);
    const score = decayedSum(counts);
    const now = new Date();
    const result = await RealGraphEdge.updateOne(
      {
        sourceUserId: viewer.id,
        targetUserId: author.id,
      },
      {
        $set: {
          sourceUserId: viewer.id,
          targetUserId: author.id,
          dailyCounts: counts,
          rollupCounts: counts,
          decayedSum: score,
          interactionProbability: Math.min(0.92, 0.54 + score / 100),
          modelVersion: 'interview_demo_recommendation_feature_repair_v1',
          firstInteractionAt: new Date(now.getTime() - 9 * DAY_MS),
          lastInteractionAt: new Date(now.getTime() - (index + 1) * 60 * 60 * 1000),
          lastDecayAppliedAt: now,
          lastPredictionAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    repaired += result.upsertedCount || result.modifiedCount || 0;
  }
  return repaired;
}

async function summarizeViewerState(viewer: DemoUserRow) {
  const [contacts, recentActions, productionActionWindow, featureVector, edges] = await Promise.all([
    Contact.findAll({
      where: {
        userId: viewer.id,
        status: ContactStatus.ACCEPTED,
      },
      attributes: ['contactId'],
    }),
    UserAction.find({
      userId: viewer.id,
      timestamp: { $gte: new Date(Date.now() - 7 * DAY_MS) },
    }).sort({ timestamp: -1 }).limit(100).lean(),
    UserAction.getUserActionSequence(
      viewer.id,
      PRODUCTION_ACTION_SEQUENCE_LIMIT,
      productionActionSequenceTypes,
    ),
    UserFeatureVector.findOne({ userId: viewer.id, expiresAt: { $gt: new Date() } }).lean(),
    RealGraphEdge.countDocuments({ sourceUserId: viewer.id }),
  ]);

  const userStateContext = buildUserStateContext({
    userFeatures: {
      followedUserIds: contacts.map((contact: { contactId: string }) => contact.contactId),
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
      accountCreatedAt: viewer.createdAt,
    },
    embeddingContext: featureVector
      ? {
          interestedInClusters: featureVector.interestedInClusters || [],
          producerEmbedding: featureVector.producerEmbedding || [],
          knownForCluster: featureVector.knownForCluster,
          knownForScore: featureVector.knownForScore,
          qualityScore: featureVector.qualityScore,
          computedAt: featureVector.computedAt,
          version: featureVector.version,
          usable: Boolean((featureVector.interestedInClusters || []).length),
          stale: false,
        }
      : undefined,
    userActionSequence: productionActionWindow,
  });

  const recent100UserStateContext = buildUserStateContext({
    userFeatures: {
      followedUserIds: contacts.map((contact: { contactId: string }) => contact.contactId),
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
      accountCreatedAt: viewer.createdAt,
    },
    embeddingContext: featureVector
      ? {
          interestedInClusters: featureVector.interestedInClusters || [],
          producerEmbedding: featureVector.producerEmbedding || [],
          knownForCluster: featureVector.knownForCluster,
          knownForScore: featureVector.knownForScore,
          qualityScore: featureVector.qualityScore,
          computedAt: featureVector.computedAt,
          version: featureVector.version,
          usable: Boolean((featureVector.interestedInClusters || []).length),
          stale: false,
        }
      : undefined,
    userActionSequence: recentActions,
  });

  return {
    followedCount: contacts.length,
    recentActionCount: recentActions.length,
    recentPositiveActionCount: recent100UserStateContext.recentPositiveActionCount,
    productionActionWindowCount: productionActionWindow.length,
    productionActionWindowPositiveCount: userStateContext.recentPositiveActionCount,
    featureClusters: featureVector?.interestedInClusters?.length || 0,
    graphEdges: edges,
    userStateContext,
    recent100UserStateContext,
  };
}

async function main(): Promise<void> {
  await connectDemoStores();
  try {
    const viewer = await User.findOne({
      where: { username: DEMO_VIEWER_USERNAME },
      attributes: ['id', 'username', 'createdAt'],
    });
    if (!viewer) {
      throw new Error(`demo viewer not found: ${DEMO_VIEWER_USERNAME}`);
    }

    const authorRows = await User.findAll({
      where: {
        username: { [Op.in]: targetAuthorUsernames() },
      },
      attributes: ['id', 'username', 'createdAt'],
      order: [['username', 'ASC']],
    });
    const viewerRow = viewer.get({ plain: true }) as DemoUserRow;
    const authors = authorRows.map((row) => row.get({ plain: true }) as DemoUserRow);
    if (authors.length < 12) {
      throw new Error(`expected at least 12 demo authors, got ${authors.length}`);
    }

    const popularRecallIndex = await ensurePopularRecallIndex();
    const demoPostScores = await ensureDemoPostEngagementScores(authors);
    const before = await summarizeViewerState(viewerRow);
    const contactRepairs = await ensureViewerContacts(viewerRow, authors);
    await ensureViewerFeatureVector(viewerRow);
    const actionRepairs = await ensureRecentPositiveActions(viewerRow, authors);
    const edgeRepairs = await ensureViewerGraphEdges(viewerRow, authors);
    const after = await summarizeViewerState(viewerRow);

    const failedChecks: string[] = [];
    if (after.followedCount < 12) failedChecks.push(`followedCount too low: ${after.followedCount}`);
    if (after.productionActionWindowPositiveCount < 30) {
      failedChecks.push(
        `productionActionWindowPositiveCount too low: ${after.productionActionWindowPositiveCount}`,
      );
    }
    if (after.featureClusters < 4) failedChecks.push(`featureClusters too low: ${after.featureClusters}`);
    if (after.graphEdges < 12) failedChecks.push(`graphEdges too low: ${after.graphEdges}`);
    if (after.userStateContext.state !== 'heavy') {
      failedChecks.push(`viewer production hydrator state is ${after.userStateContext.state}`);
    }

    console.log(JSON.stringify({
      viewer: viewerRow.username,
      before,
      repairs: {
        popularRecallIndex,
        demoPostScores,
        contacts: contactRepairs,
        recentActions: actionRepairs,
        graphEdges: edgeRepairs,
        featureVector: 1,
      },
      after,
      failedChecks,
    }, null, 2));

    if (failedChecks.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await disconnectDemoStores();
  }
}

main()
  .then(() => {
    const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
    process.exit(exitCode);
  })
  .catch(async (error) => {
    console.error('[repairInterviewDemoRecommendationFeatures] failed:', error);
    await disconnectDemoStores();
    process.exit(1);
  });
