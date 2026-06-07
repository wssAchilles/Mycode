import mongoose from 'mongoose';
import { Op } from 'sequelize';

import Comment from '../../models/Comment';
import Contact, { ContactStatus } from '../../models/Contact';
import Like from '../../models/Like';
import Post from '../../models/Post';
import RealGraphEdge from '../../models/RealGraphEdge';
import Repost, { RepostType } from '../../models/Repost';
import User from '../../models/User';
import UserAction, { ActionType } from '../../models/UserAction';
import UserSignal, { ProductSurface, SignalType, TargetType } from '../../models/UserSignal';
import InNetworkTimelineService from '../../services/recommendation/InNetworkTimelineService';
import { postFeatureSnapshotService } from '../../services/recommendation/contentFeatures';
import {
  DEMO_CLUSTER_CONFIGS,
  DEMO_CLUSTER_ORDER,
  DEMO_VIEWER_USERNAME,
} from './config';
import { connectDemoStores, disconnectDemoStores } from './runtime';

type DemoRole = 'viewer' | 'author' | 'bridge' | 'audience' | 'seed' | 'other';

type DemoUserRow = {
  id: string;
  username: string;
  createdAt?: Date;
};

type DemoUser = DemoUserRow & {
  role: DemoRole;
  cluster: string;
};

type DemoPost = {
  _id: mongoose.Types.ObjectId;
  authorId: string;
  content: string;
  keywords?: string[];
  createdAt: Date;
  updatedAt?: Date;
  stats?: {
    likeCount?: number;
    repostCount?: number;
    quoteCount?: number;
    commentCount?: number;
    viewCount?: number;
  };
  engagementScore?: number;
  isNews?: boolean;
};

type ExpansionOptions = {
  dryRun: boolean;
  authorLimit: number;
  audienceLimit: number;
  bridgeLimit: number;
  postsPerAuthor: number;
  viewerPosts: number;
  actionsPerAudience: number;
};

type CounterMap = Record<string, number>;

const SCRIPT_VERSION = 'demo_interviewer_social_graph_expansion_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const REALGRAPH_MODEL_VERSION = 'heuristic_realgraph_v1';
const REALGRAPH_FEATURE_VERSION = 'realgraph_features_v1';
const DEFAULT_EXPIRES_AT = () => new Date(Date.now() + 30 * DAY_MS);

const parseBooleanFlag = (flag: string): boolean => process.argv.includes(flag);

const parseNumberArg = (flag: string, fallback: number): number => {
  const direct = process.argv.find((value) => value.startsWith(`${flag}=`));
  const flagIndex = process.argv.indexOf(flag);
  const raw = direct ? direct.slice(flag.length + 1) : flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
  if (!raw || raw.startsWith('--')) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseOptions = (): ExpansionOptions => ({
  dryRun: parseBooleanFlag('--dry-run'),
  authorLimit: parseNumberArg('--authors', 96),
  audienceLimit: parseNumberArg('--audience', 360),
  bridgeLimit: parseNumberArg('--bridges', 24),
  postsPerAuthor: parseNumberArg('--posts-per-author', 2),
  viewerPosts: parseNumberArg('--viewer-posts', 30),
  actionsPerAudience: parseNumberArg('--actions-per-audience', 4),
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const pick = <T>(items: T[], index: number): T => items[index % items.length];

const dedupe = <T>(items: T[]): T[] => Array.from(new Set(items.filter(Boolean)));

const inferRole = (username: string): DemoRole => {
  if (username === DEMO_VIEWER_USERNAME) return 'viewer';
  if (/^demo_.*_author_\d{2}$/.test(username)) return 'author';
  if (/^demo_bridge_\d{2}$/.test(username)) return 'bridge';
  if (/^demo_audience_\d{4}$/.test(username)) return 'audience';
  if (/^trend_seed_/.test(username)) return 'seed';
  return 'other';
};

const inferCluster = (username: string): string => {
  for (const cluster of DEMO_CLUSTER_ORDER) {
    const stem = DEMO_CLUSTER_CONFIGS[cluster].usernameStem;
    if (username.includes(`_${stem}_`) || username.includes(stem)) {
      return cluster;
    }
  }
  const numeric = username.match(/(\d+)$/)?.[1];
  return DEMO_CLUSTER_ORDER[Number(numeric || 0) % DEMO_CLUSTER_ORDER.length];
};

const scorePost = (stats: NonNullable<DemoPost['stats']>): number =>
  (stats.likeCount || 0) + (stats.commentCount || 0) * 2 + (stats.repostCount || 0) * 3 + (stats.viewCount || 0) / 28;

const signalTypeForAction = (action: ActionType): SignalType | null => {
  switch (action) {
    case ActionType.IMPRESSION:
      return SignalType.IMPRESSION;
    case ActionType.CLICK:
      return SignalType.TWEET_CLICK;
    case ActionType.LIKE:
      return SignalType.FAVORITE;
    case ActionType.REPLY:
      return SignalType.REPLY;
    case ActionType.REPOST:
      return SignalType.RETWEET;
    case ActionType.SHARE:
      return SignalType.SHARE;
    case ActionType.DWELL:
      return SignalType.DWELL;
    case ActionType.PROFILE_CLICK:
      return SignalType.PROFILE_CLICK;
    default:
      return null;
  }
};

const emptyCounts = () => ({
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

const decayedSum = (counts: ReturnType<typeof emptyCounts>): number =>
  counts.followCount * 10 +
  counts.likeCount +
  counts.replyCount * 3 +
  counts.retweetCount * 2 +
  counts.quoteCount * 2.5 +
  counts.mentionCount * 1.5 +
  counts.profileViewCount * 0.5 +
  counts.tweetClickCount * 0.3 +
  counts.dwellTimeMs * 0.001 +
  counts.addressBookCount * 6 +
  counts.directMessageCount * 5 +
  counts.coEngagementCount * 2.2 +
  counts.contentAffinityCount * 1.8 -
  counts.muteCount * 5 -
  counts.blockCount * 10 -
  counts.reportCount * 8;

const buildPostContent = (author: DemoUser, postIndex: number): { content: string; keywords: string[] } => {
  const cluster = DEMO_CLUSTER_ORDER.includes(author.cluster as any)
    ? author.cluster as keyof typeof DEMO_CLUSTER_CONFIGS
    : 'recsys';
  const config = DEMO_CLUSTER_CONFIGS[cluster];
  const angle = pick(config.contentAngles, postIndex + author.username.length);
  const outcome = pick(config.contentOutcomes, postIndex * 3 + author.username.length);
  const content = `[${SCRIPT_VERSION}] ${author.username} expands the ${config.label} circle around demo_interviewer: ${angle}; ${outcome}. Expansion post ${postIndex + 1}.`;
  return {
    content,
    keywords: dedupe([...config.keywords, 'demo_interviewer', 'social_graph', 'recommendation']),
  };
};

const buildViewerPostContent = (postIndex: number): { content: string; keywords: string[] } => {
  const cluster = DEMO_CLUSTER_ORDER[postIndex % DEMO_CLUSTER_ORDER.length];
  const config = DEMO_CLUSTER_CONFIGS[cluster];
  return {
    content: `[${SCRIPT_VERSION}] demo_interviewer hub note ${postIndex + 1}: ${pick(config.contentAngles, postIndex)} connects ${config.label} into Home Mixer style retrieval, ranking, and served-history proof.`,
    keywords: dedupe([...config.keywords, 'demo_interviewer', 'home_mixer', 'realgraph', 'phoenix']),
  };
};

async function loadDemoUsers(): Promise<{ viewer: DemoUser; authors: DemoUser[]; bridges: DemoUser[]; audiences: DemoUser[]; all: DemoUser[] }> {
  const rows = await User.findAll({
    where: {
      [Op.or]: [
        { username: { [Op.like]: 'demo_%' } },
        { username: { [Op.like]: 'trend_seed_%' } },
      ],
    },
    attributes: ['id', 'username', 'createdAt'],
    order: [['username', 'ASC']],
  });
  const all = rows.map((row) => {
    const plain = row.get({ plain: true }) as DemoUserRow;
    return {
      ...plain,
      role: inferRole(plain.username),
      cluster: inferCluster(plain.username),
    };
  });
  const viewer = all.find((user) => user.username === DEMO_VIEWER_USERNAME);
  if (!viewer) {
    throw new Error(`demo viewer not found: ${DEMO_VIEWER_USERNAME}`);
  }
  return {
    viewer,
    authors: all.filter((user) => user.role === 'author'),
    bridges: all.filter((user) => user.role === 'bridge' || user.role === 'seed'),
    audiences: all.filter((user) => user.role === 'audience'),
    all,
  };
}

async function summarize(viewer: DemoUser) {
  const [contactsOut, contactsIn, actions, signals, graphOut, graphIn, posts, snapshots, likes, comments, reposts] = await Promise.all([
    Contact.count({ where: { userId: viewer.id, status: ContactStatus.ACCEPTED } }),
    Contact.count({ where: { contactId: viewer.id, status: ContactStatus.ACCEPTED } }),
    UserAction.countDocuments({ userId: viewer.id }),
    UserSignal.countDocuments({ userId: viewer.id }),
    RealGraphEdge.countDocuments({ sourceUserId: viewer.id }),
    RealGraphEdge.countDocuments({ targetUserId: viewer.id }),
    Post.countDocuments({ authorId: viewer.id, deletedAt: null }),
    mongoose.connection.collection('post_feature_snapshots').countDocuments({
      authorId: viewer.id,
    }),
    Like.countDocuments({ authorId: viewer.id }),
    Comment.countDocuments({
      postId: {
        $in: await Post.find({ authorId: viewer.id, deletedAt: null }).distinct('_id'),
      },
    }),
    Repost.countDocuments({
      postId: {
        $in: await Post.find({ authorId: viewer.id, deletedAt: null }).distinct('_id'),
      },
    }),
  ]);
  return { contactsOut, contactsIn, actions, signals, graphOut, graphIn, posts, snapshots, likes, comments, reposts };
}

async function ensureContacts(input: {
  viewer: DemoUser;
  authors: DemoUser[];
  bridges: DemoUser[];
  audiences: DemoUser[];
  dryRun: boolean;
}): Promise<number> {
  const contactPairs: Array<{ userId: string; contactId: string; alias: string }> = [];
  for (const [index, user] of [...input.authors, ...input.bridges, ...input.audiences.slice(0, 120)].entries()) {
    contactPairs.push({ userId: input.viewer.id, contactId: user.id, alias: `demo hub ${index + 1}` });
  }
  for (const [index, user] of input.audiences.entries()) {
    contactPairs.push({ userId: user.id, contactId: input.viewer.id, alias: 'demo interviewer hub' });
    const author = pick(input.authors, index);
    const bridge = pick(input.bridges, index);
    contactPairs.push({ userId: user.id, contactId: author.id, alias: `cluster author ${index + 1}` });
    if (index % 3 === 0) {
      contactPairs.push({ userId: user.id, contactId: bridge.id, alias: `bridge ${index + 1}` });
    }
  }
  for (const [index, author] of input.authors.entries()) {
    contactPairs.push({ userId: author.id, contactId: input.viewer.id, alias: 'demo interviewer hub' });
    contactPairs.push({ userId: author.id, contactId: pick(input.bridges, index).id, alias: 'demo bridge' });
  }

  const uniquePairs = dedupe(contactPairs.map((pair) => `${pair.userId}:${pair.contactId}`))
    .map((key) => {
      const [userId, contactId] = key.split(':');
      const original = contactPairs.find((pair) => pair.userId === userId && pair.contactId === contactId);
      return { userId, contactId, alias: original?.alias || 'demo social graph' };
    })
    .filter((pair) => pair.userId !== pair.contactId);

  if (input.dryRun) return uniquePairs.length;

  const now = new Date();
  await Contact.bulkCreate(
    uniquePairs.map((pair, index) => ({
      userId: pair.userId,
      contactId: pair.contactId,
      status: ContactStatus.ACCEPTED,
      alias: pair.alias,
      addedAt: new Date(Date.now() - (index + 2) * HOUR_MS),
      updatedAt: now,
    })),
    {
      updateOnDuplicate: ['status', 'alias', 'updatedAt'],
    },
  );
  return uniquePairs.length;
}

async function ensurePosts(input: {
  viewer: DemoUser;
  authors: DemoUser[];
  bridges: DemoUser[];
  dryRun: boolean;
  postsPerAuthor: number;
  viewerPosts: number;
}): Promise<{ postIds: mongoose.Types.ObjectId[]; changed: number; timelineWrites: number }> {
  const drafts: Array<{ author: DemoUser; content: string; keywords: string[]; createdAt: Date; stats: NonNullable<DemoPost['stats']>; isPinned: boolean }> = [];
  for (let index = 0; index < input.viewerPosts; index += 1) {
    const built = buildViewerPostContent(index);
    const createdAt = new Date(Date.now() - index * 2 * HOUR_MS);
    const stats = {
      likeCount: 72 + index * 3,
      commentCount: 18 + (index % 8),
      repostCount: 12 + (index % 6),
      quoteCount: 0,
      viewCount: 980 + index * 31,
    };
    drafts.push({ author: input.viewer, content: built.content, keywords: built.keywords, createdAt, stats, isPinned: index === 0 });
  }
  for (const [authorIndex, author] of [...input.authors, ...input.bridges].entries()) {
    for (let postIndex = 0; postIndex < input.postsPerAuthor; postIndex += 1) {
      const built = buildPostContent(author, postIndex);
      const createdAt = new Date(Date.now() - (authorIndex * 4 + postIndex + 3) * HOUR_MS);
      const stats = {
        likeCount: 28 + (authorIndex % 15) + postIndex * 4,
        commentCount: 7 + (authorIndex % 6),
        repostCount: 5 + (postIndex % 4),
        quoteCount: 0,
        viewCount: 360 + authorIndex * 9 + postIndex * 29,
      };
      drafts.push({ author, content: built.content, keywords: built.keywords, createdAt, stats, isPinned: false });
    }
  }

  if (input.dryRun) {
    return { postIds: [], changed: drafts.length, timelineWrites: drafts.length };
  }

  await Post.bulkWrite(
    drafts.map((draft) => ({
      updateOne: {
        filter: { authorId: draft.author.id, content: draft.content },
        update: {
          $set: {
            authorId: draft.author.id,
            content: draft.content,
            keywords: draft.keywords,
            stats: draft.stats,
            engagementScore: scorePost(draft.stats),
            isPinned: draft.isPinned,
            isNews: false,
            language: 'en',
            isNsfw: false,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            media: [],
            isRepost: false,
            isReply: false,
            createdAt: draft.createdAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  const posts = await Post.find({
    content: { $regex: `^\\[${SCRIPT_VERSION}\\]` },
    deletedAt: null,
  })
    .select('_id authorId content keywords createdAt updatedAt media stats engagementScore isNews language')
    .lean<DemoPost[]>();

  await postFeatureSnapshotService.ensureSnapshotsForPosts(posts as any);
  let timelineWrites = 0;
  for (const post of posts) {
    await InNetworkTimelineService.addPost(post.authorId, String(post._id), post.createdAt);
    timelineWrites += 1;
  }

  return { postIds: posts.map((post) => post._id), changed: drafts.length, timelineWrites };
}

async function loadExpansionPosts(authorIds: string[]): Promise<DemoPost[]> {
  return Post.find({
    authorId: { $in: authorIds },
    isNews: { $ne: true },
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .limit(900)
    .select('_id authorId content keywords createdAt updatedAt stats engagementScore isNews')
    .lean<DemoPost[]>();
}

async function ensureInteractions(input: {
  viewer: DemoUser;
  authors: DemoUser[];
  bridges: DemoUser[];
  audiences: DemoUser[];
  dryRun: boolean;
  actionsPerAudience: number;
}): Promise<{ actions: number; signals: number; likes: number; comments: number; reposts: number }> {
  const authorIds = dedupe([input.viewer.id, ...input.authors.map((user) => user.id), ...input.bridges.map((user) => user.id)]);
  const posts = await loadExpansionPosts(authorIds);
  const viewerPosts = posts.filter((post) => post.authorId === input.viewer.id);
  const nonViewerPosts = posts.filter((post) => post.authorId !== input.viewer.id);
  if (posts.length === 0 || viewerPosts.length === 0 || nonViewerPosts.length === 0) {
    throw new Error('not enough demo posts to create recommendation interactions');
  }

  const actionPlans: Array<{
    actor: DemoUser;
    post: DemoPost;
    action: ActionType;
    timestamp: Date;
    rank: number;
  }> = [];

  const viewerActions = [
    ActionType.IMPRESSION,
    ActionType.CLICK,
    ActionType.LIKE,
    ActionType.REPLY,
    ActionType.REPOST,
    ActionType.DWELL,
    ActionType.PROFILE_CLICK,
  ];
  for (let index = 0; index < Math.min(nonViewerPosts.length, 220); index += 1) {
    actionPlans.push({
      actor: input.viewer,
      post: nonViewerPosts[index],
      action: pick(viewerActions, index),
      timestamp: new Date(Date.now() - (index + 1) * 11 * 60 * 1000),
      rank: (index % 40) + 1,
    });
  }

  const audienceActions = [ActionType.IMPRESSION, ActionType.CLICK, ActionType.LIKE, ActionType.REPLY, ActionType.REPOST, ActionType.DWELL];
  for (const [audienceIndex, audience] of input.audiences.entries()) {
    for (let actionIndex = 0; actionIndex < input.actionsPerAudience; actionIndex += 1) {
      actionPlans.push({
        actor: audience,
        post: pick(viewerPosts, audienceIndex + actionIndex),
        action: pick(audienceActions, audienceIndex + actionIndex),
        timestamp: new Date(Date.now() - (audienceIndex * 3 + actionIndex + 1) * 7 * 60 * 1000),
        rank: (actionIndex % 30) + 1,
      });
    }
    if (audienceIndex % 4 === 0) {
      actionPlans.push({
        actor: audience,
        post: pick(nonViewerPosts, audienceIndex),
        action: ActionType.LIKE,
        timestamp: new Date(Date.now() - (audienceIndex + 1) * 13 * 60 * 1000),
        rank: (audienceIndex % 30) + 1,
      });
    }
  }

  for (const [bridgeIndex, bridge] of input.bridges.entries()) {
    for (let actionIndex = 0; actionIndex < 8; actionIndex += 1) {
      actionPlans.push({
        actor: bridge,
        post: actionIndex % 2 === 0 ? pick(viewerPosts, bridgeIndex + actionIndex) : pick(nonViewerPosts, bridgeIndex + actionIndex),
        action: pick([ActionType.CLICK, ActionType.LIKE, ActionType.REPOST, ActionType.REPLY], actionIndex),
        timestamp: new Date(Date.now() - (bridgeIndex * 5 + actionIndex + 1) * 17 * 60 * 1000),
        rank: (actionIndex % 20) + 1,
      });
    }
  }

  if (input.dryRun) {
    return {
      actions: actionPlans.length,
      signals: actionPlans.filter((plan) => signalTypeForAction(plan.action)).length,
      likes: actionPlans.filter((plan) => plan.action === ActionType.LIKE).length,
      comments: actionPlans.filter((plan) => plan.action === ActionType.REPLY).length,
      reposts: actionPlans.filter((plan) => plan.action === ActionType.REPOST).length,
    };
  }

  const actionOps: any[] = [];
  const signalDocs: any[] = [];
  const likeOps: any[] = [];
  const commentDocs: any[] = [];
  const repostOps: any[] = [];
  for (const [index, plan] of actionPlans.entries()) {
    const requestId = `${SCRIPT_VERSION}:${plan.actor.id}:${plan.action}:${plan.post._id}`;
    const targetKeywords = dedupe([...(plan.post.keywords || []), 'demo_interviewer', 'recommendation']);
    actionOps.push({
      updateOne: {
        filter: { userId: plan.actor.id, requestId, action: plan.action, targetPostId: plan.post._id },
        update: {
          $set: {
            userId: plan.actor.id,
            action: plan.action,
            targetPostId: plan.post._id,
            targetAuthorId: plan.post.authorId,
            requestId,
            productSurface: 'space_feed',
            rank: plan.rank,
            score: Number((0.62 + (index % 30) / 100).toFixed(3)),
            weightedScore: Number((0.74 + (index % 20) / 100).toFixed(3)),
            inNetwork: true,
            isNews: false,
            modelPostId: String(plan.post._id),
            recallSource: plan.post.authorId === input.viewer.id ? 'GraphSource' : 'FollowingSource',
            experimentKeys: ['demo_interviewer:social_graph_expansion', 'x_algorithm:home_mixer_aligned'],
            targetKeywords,
            dwellTimeMs: plan.action === ActionType.DWELL ? 24_000 + (index % 20) * 850 : undefined,
            actionText: plan.action === ActionType.REPLY
              ? `Expansion reply ${index + 1}: this connects ${targetKeywords.slice(0, 4).join(', ')} back to demo_interviewer.`
              : undefined,
            timestamp: plan.timestamp,
          },
        },
        upsert: true,
      },
    });

    const signalType = signalTypeForAction(plan.action);
    if (signalType) {
      signalDocs.push({
        userId: plan.actor.id,
        signalType,
        targetId: String(plan.post._id),
        targetType: TargetType.POST,
        targetAuthorId: plan.post.authorId,
        productSurface: ProductSurface.SPACE_FEED,
        requestId,
        metadata: {
          demoExpansionId: requestId,
          recommendationPosition: plan.rank,
          recommendationSource: plan.post.authorId === input.viewer.id ? 'GraphSource' : 'FollowingSource',
          dwellTimeMs: plan.action === ActionType.DWELL ? 24_000 + (index % 20) * 850 : undefined,
          xAlgorithmAlignment: ['query_hydration', 'side_effects', 'engagement_history'],
        },
        timestamp: plan.timestamp,
        expiresAt: DEFAULT_EXPIRES_AT(),
      });
    }

    if (plan.action === ActionType.LIKE) {
      likeOps.push({
        updateOne: {
          filter: { userId: plan.actor.id, postId: plan.post._id },
          update: {
            $setOnInsert: {
              userId: plan.actor.id,
              postId: plan.post._id,
              authorId: plan.post.authorId,
              createdAt: plan.timestamp,
            },
          },
          upsert: true,
        },
      });
    } else if (plan.action === ActionType.REPLY) {
      const content = `Expansion reply ${index + 1}: ${plan.actor.username} validates the demo_interviewer recommendation path.`;
      commentDocs.push({
        userId: plan.actor.id,
        postId: plan.post._id,
        content,
        parentId: null,
        likeCount: index % 5,
        deletedAt: null,
        createdAt: plan.timestamp,
        updatedAt: plan.timestamp,
      });
    } else if (plan.action === ActionType.REPOST) {
      repostOps.push({
        updateOne: {
          filter: { userId: plan.actor.id, postId: plan.post._id, type: RepostType.REPOST },
          update: {
            $setOnInsert: {
              userId: plan.actor.id,
              postId: plan.post._id,
              type: RepostType.REPOST,
              createdAt: plan.timestamp,
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (actionOps.length > 0) await UserAction.bulkWrite(actionOps, { ordered: false });
  if (signalDocs.length > 0) {
    await UserSignal.deleteMany({ 'metadata.demoExpansionId': { $regex: `^${SCRIPT_VERSION}:` } });
    await UserSignal.insertMany(signalDocs, { ordered: false });
  }
  if (likeOps.length > 0) await Like.bulkWrite(likeOps, { ordered: false });
  if (commentDocs.length > 0) {
    await Comment.deleteMany({
      content: {
        $regex: '^Expansion reply \\d+: .*demo_interviewer recommendation path\\.$',
      },
    });
    await Comment.insertMany(commentDocs, { ordered: false });
  }
  if (repostOps.length > 0) await Repost.bulkWrite(repostOps, { ordered: false });

  return {
    actions: actionOps.length,
    signals: signalDocs.length,
    likes: likeOps.length,
    comments: commentDocs.length,
    reposts: repostOps.length,
  };
}

async function ensureRealGraph(input: {
  viewer: DemoUser;
  authors: DemoUser[];
  bridges: DemoUser[];
  audiences: DemoUser[];
  dryRun: boolean;
}): Promise<number> {
  const edgeCounts = new Map<string, ReturnType<typeof emptyCounts>>();
  const bump = (sourceUserId: string, targetUserId: string, updater: (counts: ReturnType<typeof emptyCounts>) => void): void => {
    if (sourceUserId === targetUserId) return;
    const key = `${sourceUserId}:${targetUserId}`;
    const counts = edgeCounts.get(key) || emptyCounts();
    updater(counts);
    edgeCounts.set(key, counts);
  };

  for (const [index, user] of [...input.authors, ...input.bridges, ...input.audiences.slice(0, 160)].entries()) {
    bump(input.viewer.id, user.id, (counts) => {
      counts.followCount = 1;
      counts.profileViewCount = Math.max(counts.profileViewCount, 1 + (index % 3));
      counts.tweetClickCount += 2 + (index % 4);
      counts.contentAffinityCount += 2;
      counts.dwellTimeMs += 18_000 + (index % 5) * 1200;
    });
  }
  for (const [index, audience] of input.audiences.entries()) {
    bump(audience.id, input.viewer.id, (counts) => {
      counts.followCount = 1;
      counts.likeCount += 2 + (index % 3);
      counts.replyCount += index % 4 === 0 ? 1 : 0;
      counts.retweetCount += index % 5 === 0 ? 1 : 0;
      counts.tweetClickCount += 2;
      counts.contentAffinityCount += 1;
      counts.dwellTimeMs += 22_000 + (index % 6) * 900;
    });
  }
  for (const [index, author] of input.authors.entries()) {
    bump(author.id, input.viewer.id, (counts) => {
      counts.followCount = 1;
      counts.likeCount += 1 + (index % 2);
      counts.replyCount += index % 3 === 0 ? 1 : 0;
      counts.contentAffinityCount += 2;
      counts.coEngagementCount += 1;
    });
    bump(author.id, pick(input.bridges, index).id, (counts) => {
      counts.followCount = 1;
      counts.coEngagementCount += 2;
      counts.contentAffinityCount += 1;
    });
  }

  if (input.dryRun) return edgeCounts.size;

  const now = new Date();
  const graphOps = Array.from(edgeCounts.entries()).map(([key, counts]) => {
    const [sourceUserId, targetUserId] = key.split(':');
    const score = decayedSum(counts);
    return {
      updateOne: {
        filter: { sourceUserId, targetUserId },
        update: {
          $set: {
            sourceUserId,
            targetUserId,
            dailyCounts: counts,
            rollupCounts: counts,
            decayedSum: Number(score.toFixed(3)),
            interactionProbability: Number(clamp(0.42 + score / 120, 0.05, 0.96).toFixed(3)),
            predictionMode: 'heuristic',
            modelVersion: REALGRAPH_MODEL_VERSION,
            featureVersion: REALGRAPH_FEATURE_VERSION,
            firstInteractionAt: new Date(now.getTime() - 14 * DAY_MS),
            lastInteractionAt: now,
            lastDecayAppliedAt: now,
            lastPredictionAt: now,
          },
        },
        upsert: true,
      },
    };
  });
  if (graphOps.length > 0) await RealGraphEdge.bulkWrite(graphOps, { ordered: false });
  return graphOps.length;
}

async function collectEvidence(viewer: DemoUser) {
  const viewerPosts = await Post.find({ authorId: viewer.id, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('_id content keywords stats engagementScore createdAt')
    .lean();
  const [topOutEdges, topInEdges, recentActions, recentSignals] = await Promise.all([
    RealGraphEdge.find({ sourceUserId: viewer.id })
      .sort({ decayedSum: -1 })
      .limit(5)
      .select('targetUserId decayedSum interactionProbability modelVersion featureVersion lastPredictionAt rollupCounts')
      .lean(),
    RealGraphEdge.find({ targetUserId: viewer.id })
      .sort({ decayedSum: -1 })
      .limit(5)
      .select('sourceUserId decayedSum interactionProbability modelVersion featureVersion lastPredictionAt rollupCounts')
      .lean(),
    UserAction.find({ userId: viewer.id, requestId: { $regex: `^${SCRIPT_VERSION}:` } })
      .sort({ timestamp: -1 })
      .limit(5)
      .select('action targetAuthorId targetPostId requestId recallSource targetKeywords timestamp')
      .lean(),
    UserSignal.find({ userId: viewer.id, 'metadata.demoExpansionId': { $regex: `^${SCRIPT_VERSION}:` } })
      .sort({ timestamp: -1 })
      .limit(5)
      .select('signalType targetAuthorId targetId requestId metadata timestamp')
      .lean(),
  ]);
  return { viewerPosts, topOutEdges, topInEdges, recentActions, recentSignals };
}

async function main(): Promise<void> {
  const options = parseOptions();
  await connectDemoStores();
  try {
    const loaded = await loadDemoUsers();
    const authors = loaded.authors.slice(0, options.authorLimit);
    const bridges = loaded.bridges.slice(0, options.bridgeLimit);
    const audiences = loaded.audiences.slice(0, options.audienceLimit);
    if (authors.length < 24 || audiences.length < 120) {
      throw new Error(`not enough demo users for expansion: authors=${authors.length}, audiences=${audiences.length}`);
    }

    const before = await summarize(loaded.viewer);
    const contacts = await ensureContacts({ viewer: loaded.viewer, authors, bridges, audiences, dryRun: options.dryRun });
    const posts = await ensurePosts({
      viewer: loaded.viewer,
      authors,
      bridges,
      dryRun: options.dryRun,
      postsPerAuthor: options.postsPerAuthor,
      viewerPosts: options.viewerPosts,
    });
    const interactions = await ensureInteractions({
      viewer: loaded.viewer,
      authors,
      bridges,
      audiences,
      dryRun: options.dryRun,
      actionsPerAudience: options.actionsPerAudience,
    });
    const graphEdges = await ensureRealGraph({ viewer: loaded.viewer, authors, bridges, audiences, dryRun: options.dryRun });
    const after = options.dryRun ? before : await summarize(loaded.viewer);
    const evidence = options.dryRun ? null : await collectEvidence(loaded.viewer);

    const output: {
      scriptVersion: string;
      dryRun: boolean;
      selectedUsers: CounterMap;
      before: Awaited<ReturnType<typeof summarize>>;
      writes: Record<string, unknown>;
      after: Awaited<ReturnType<typeof summarize>>;
      evidence: Awaited<ReturnType<typeof collectEvidence>> | null;
    } = {
      scriptVersion: SCRIPT_VERSION,
      dryRun: options.dryRun,
      selectedUsers: {
        allDemoLike: loaded.all.length,
        authors: authors.length,
        bridges: bridges.length,
        audiences: audiences.length,
      },
      before,
      writes: {
        contacts,
        posts: posts.changed,
        postSnapshotCandidates: posts.postIds.length,
        timelineWrites: posts.timelineWrites,
        interactions,
        graphEdges,
      },
      after,
      evidence,
    };
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await disconnectDemoStores();
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('[expandDemoInterviewerSocialGraph] failed:', error);
    await disconnectDemoStores();
    process.exit(1);
  });
