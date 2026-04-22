import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import Comment from '../../models/Comment';
import Contact, { ContactStatus } from '../../models/Contact';
import Group, { GroupType } from '../../models/Group';
import GroupMember, { MemberRole, MemberStatus } from '../../models/GroupMember';
import Like from '../../models/Like';
import Message from '../../models/Message';
import Post from '../../models/Post';
import RealGraphEdge from '../../models/RealGraphEdge';
import Repost, { RepostType } from '../../models/Repost';
import SpaceProfile from '../../models/SpaceProfile';
import User from '../../models/User';
import UserAction, { ActionType } from '../../models/UserAction';
import UserFeatureVector from '../../models/UserFeatureVector';
import UserSettings from '../../models/UserSettings';
import ClusterDefinition from '../../models/ClusterDefinition';
import GroupState from '../../models/GroupState';
import ChatCounter from '../../models/ChatCounter';
import ChatMemberState from '../../models/ChatMemberState';
import UpdateCounter from '../../models/UpdateCounter';
import UpdateLog from '../../models/UpdateLog';
import ChatDeliveryOutbox from '../../models/ChatDeliveryOutbox';
import { createAndFanoutMessage, getGroupChatId } from '../../services/messageWriteService';
import InNetworkTimelineService from '../../services/recommendation/InNetworkTimelineService';
import {
  buildAudienceUsername,
  buildAuthorUsername,
  buildBridgeUsername,
  buildClusterWebsite,
  DEMO_AUTHOR_POST_COUNT,
  DEMO_AVATAR_POOL_SIZE,
  DEMO_BRIDGE_POST_COUNT,
  DEMO_BRIDGE_WITH_POST_COUNT,
  DEMO_CLUSTER_CONFIGS,
  DEMO_CLUSTER_IDS,
  DEMO_CLUSTER_ORDER,
  DEMO_DEFAULT_PASSWORD,
  DEMO_GROUP_BLUEPRINTS,
  DEMO_GROUP_MESSAGE_THEMES,
  DEMO_RECENT_WINDOW_DAYS,
  DEMO_TOTAL_AUDIENCE_COUNT,
  DEMO_VIEWER_FOLLOW_STRONG_INDEXES,
  DEMO_VIEWER_FOLLOW_WEAK_INDEXES,
  DEMO_VIEWER_USERNAME,
} from './config';
import { prepareGroupAvatarUrls, preparePortraitPool } from './avatarStorage';
import { cleanupDemoCohort, collectExistingDemoState } from './cohortStore';
import type { DemoClusterKey, DemoGroupSeed, DemoUserSeed } from './contracts';
import {
  buildFrontendTargetWarnings,
  connectDemoStores,
  disconnectDemoStores,
  resolvePublicApiBaseUrl,
} from './runtime';
import { persistDemoCohortManifest } from './cohortStore';

type PostSeedDraft = {
  cluster: DemoClusterKey;
  authorId: string;
  authorUsername: string;
  content: string;
  keywords: string[];
  stats: {
    likeCount: number;
    commentCount: number;
    repostCount: number;
    quoteCount: number;
    viewCount: number;
  };
  engagementScore: number;
  createdAt: Date;
  updatedAt: Date;
  isPinned: boolean;
};

type InsertedPostMeta = {
  cluster: DemoClusterKey;
  authorId: string;
  authorUsername: string;
  doc: any;
};

type InteractionContext = {
  actionDocs: any[];
  likeDocs: any[];
  repostDocs: any[];
  commentDocs: any[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const parseArg = (flag: string): string | null => {
  const direct = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (direct) {
    return direct.slice(flag.length + 1);
  }
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
};

const requiredViewerPassword = (): string => {
  const value = parseArg('--viewer-password') || process.env.DEMO_VIEWER_PASSWORD || '';
  if (value.length < 6) {
    throw new Error('demo:prepare requires --viewer-password with at least 6 characters');
  }
  return value;
};

const pick = <T>(items: T[], index: number): T => items[index % items.length];

const dedupe = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const buildCreatedAt = (daysAgo: number, hourOffset: number): Date =>
  new Date(Date.now() - daysAgo * DAY_MS - hourOffset * HOUR_MS);

const clusterLocation = (cluster: DemoClusterKey): string => {
  switch (cluster) {
    case 'ai':
      return 'San Francisco, CA';
    case 'recsys':
      return 'Seattle, WA';
    case 'rust':
      return 'Austin, TX';
    case 'go':
      return 'Portland, OR';
    case 'frontend':
      return 'Los Angeles, CA';
    case 'growth':
      return 'New York, NY';
    default:
      return 'Remote';
  }
};

const buildAudienceBio = (index: number): string =>
  pick(
    [
      'joins demo groups to keep the realtime path busy and believable',
      'follows infra and product conversations around the interview cohort',
      'acts as a steady source of audience traffic for the large-group demo',
    ],
    index,
  );

const buildBridgeClusters = (index: number): DemoClusterKey[] => {
  const primary = DEMO_CLUSTER_ORDER[index % DEMO_CLUSTER_ORDER.length];
  const secondary = DEMO_CLUSTER_ORDER[(index + 2) % DEMO_CLUSTER_ORDER.length];
  return primary === secondary ? [primary] : [primary, secondary];
};

const buildDemoUsers = async (input: {
  viewerPasswordHash: string;
  defaultPasswordHash: string;
  portraitPool: string[];
}): Promise<{
  allUsers: DemoUserSeed[];
  viewer: DemoUserSeed;
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  bridges: DemoUserSeed[];
  audiences: DemoUserSeed[];
}> => {
  let avatarCursor = 0;
  const nextAvatar = (): string => {
    const url = input.portraitPool[avatarCursor % input.portraitPool.length];
    avatarCursor += 1;
    return url;
  };

  const viewer: DemoUserSeed = {
    id: uuidv4(),
    username: DEMO_VIEWER_USERNAME,
    displayName: 'Interview Demo Viewer',
    role: 'viewer',
    passwordHash: input.viewerPasswordHash,
    avatarUrl: nextAvatar(),
    cluster: 'recsys',
    secondaryClusters: ['ai', 'rust', 'go'],
    bio: 'Owns the interview demo view and follows the strongest retrieval, ranking, and systems contributors.',
    location: 'Shanghai, CN',
    website: buildClusterWebsite(DEMO_VIEWER_USERNAME),
    isOnline: true,
    lastSeen: new Date(),
  };

  const authorsByCluster = {} as Record<DemoClusterKey, DemoUserSeed[]>;
  for (const cluster of DEMO_CLUSTER_ORDER) {
    const clusterConfig = DEMO_CLUSTER_CONFIGS[cluster];
    authorsByCluster[cluster] = clusterConfig.authorDisplayNames.map((displayName, index) => ({
      id: uuidv4(),
      username: buildAuthorUsername(cluster, index),
      displayName,
      role: 'author',
      passwordHash: input.defaultPasswordHash,
      avatarUrl: nextAvatar(),
      cluster,
      secondaryClusters: clusterConfig.adjacentClusters.slice(0, 2),
      bio: `${displayName} ${pick(clusterConfig.bioFragments, index)}.`,
      location: clusterLocation(cluster),
      website: buildClusterWebsite(buildAuthorUsername(cluster, index)),
      isOnline: index < 4,
      lastSeen: buildCreatedAt(index % 2, (index % 3) + 1),
    }));
  }

  const bridges: DemoUserSeed[] = Array.from({ length: 24 }, (_, index) => {
    const clusters = buildBridgeClusters(index);
    const primary = clusters[0];
    const secondary = clusters[1] ? [clusters[1]] : [];
    return {
      id: uuidv4(),
      username: buildBridgeUsername(index),
      displayName: `Bridge Operator ${String(index + 1).padStart(2, '0')}`,
      role: 'bridge',
      passwordHash: input.defaultPasswordHash,
      avatarUrl: nextAvatar(),
      cluster: primary,
      secondaryClusters: secondary,
      bio: `Connects ${DEMO_CLUSTER_CONFIGS[primary].label} with ${DEMO_CLUSTER_CONFIGS[secondary[0] || primary].label} to make graph recall less brittle.`,
      location: clusterLocation(primary),
      website: buildClusterWebsite(buildBridgeUsername(index)),
      isOnline: index < 8,
      lastSeen: buildCreatedAt(index % 3, (index % 5) + 1),
    };
  });

  const audiences: DemoUserSeed[] = Array.from({ length: DEMO_TOTAL_AUDIENCE_COUNT }, (_, index) => ({
    id: uuidv4(),
    username: buildAudienceUsername(index),
    displayName: `Audience ${String(index + 1).padStart(4, '0')}`,
    role: 'audience',
    passwordHash: input.defaultPasswordHash,
    avatarUrl: nextAvatar(),
    secondaryClusters: [],
    bio: buildAudienceBio(index),
    location: 'Remote',
    website: buildClusterWebsite(buildAudienceUsername(index)),
    isOnline: index % 7 === 0,
    lastSeen: buildCreatedAt(index % 2, (index % 9) + 1),
  }));

  return {
    viewer,
    authorsByCluster,
    bridges,
    audiences,
    allUsers: [
      viewer,
      ...DEMO_CLUSTER_ORDER.flatMap((cluster) => authorsByCluster[cluster]),
      ...bridges,
      ...audiences,
    ],
  };
};

const buildContacts = (input: {
  viewer: DemoUserSeed;
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  bridges: DemoUserSeed[];
}): any[] => {
  const rows: any[] = [];
  const seen = new Set<string>();
  const push = (userId: string, contactId: string, hoursOffset: number) => {
    const key = `${userId}:${contactId}`;
    if (!userId || !contactId || userId === contactId || seen.has(key)) return;
    seen.add(key);
    const addedAt = new Date(Date.now() - hoursOffset * HOUR_MS);
    rows.push({
      userId,
      contactId,
      status: ContactStatus.ACCEPTED,
      addedAt,
      updatedAt: addedAt,
    });
  };

  for (const cluster of DEMO_CLUSTER_ORDER) {
    const authors = input.authorsByCluster[cluster];
    for (const index of DEMO_VIEWER_FOLLOW_STRONG_INDEXES) {
      push(input.viewer.id, authors[index].id, 12 + index);
    }
    for (const index of DEMO_VIEWER_FOLLOW_WEAK_INDEXES) {
      push(input.viewer.id, authors[index].id, 36 + index);
    }
  }

  input.bridges.forEach((bridge, index) => {
    const primaryAuthors = input.authorsByCluster[bridge.cluster || 'recsys'].slice(0, 2);
    const secondaryAuthors = (bridge.secondaryClusters[0]
      ? input.authorsByCluster[bridge.secondaryClusters[0]]
      : input.authorsByCluster[bridge.cluster || 'recsys']
    ).slice(2, 4);
    const tertiaryCluster = DEMO_CLUSTER_CONFIGS[bridge.cluster || 'recsys'].adjacentClusters[0];
    const tertiaryAuthor = input.authorsByCluster[tertiaryCluster][4 + (index % 2)];

    [...primaryAuthors, ...secondaryAuthors, tertiaryAuthor].forEach((author, offset) => {
      push(bridge.id, author.id, 24 + index + offset);
    });

    const nextBridge = input.bridges[(index + 1) % input.bridges.length];
    const secondBridge = input.bridges[(index + 6) % input.bridges.length];
    push(bridge.id, nextBridge.id, 72 + index);
    push(bridge.id, secondBridge.id, 84 + index);
  });

  return rows;
};

const buildDemoGroups = (input: {
  viewer: DemoUserSeed;
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  bridges: DemoUserSeed[];
  audiences: DemoUserSeed[];
  groupAvatarUrls: Record<'perf_arena' | 'recsys_lab' | 'product_review', string>;
}): DemoGroupSeed[] => {
  const allRustAndGoAuthors = [
    ...input.authorsByCluster.rust,
    ...input.authorsByCluster.go,
  ].map((user) => user.id);
  const allRecsysAuthors = [
    ...input.authorsByCluster.recsys,
    ...input.authorsByCluster.ai.slice(0, 8),
    ...input.bridges.slice(0, 6),
  ].map((user) => user.id);
  const allProductAuthors = [
    ...input.authorsByCluster.growth,
    ...input.authorsByCluster.frontend.slice(0, 6),
    ...input.bridges.slice(6, 12),
  ].map((user) => user.id);

  const fillMembers = (baseMemberIds: string[], target: number): string[] => {
    const members = dedupe(baseMemberIds);
    for (const audience of input.audiences) {
      if (members.length >= target) break;
      members.push(audience.id);
    }
    return members.slice(0, target);
  };

  return DEMO_GROUP_BLUEPRINTS.map((blueprint, index) => {
    const owner = input.authorsByCluster[blueprint.ownerCluster][0];
    let memberIds: string[] = [];

    if (blueprint.slug === 'perf_arena') {
      memberIds = fillMembers(
        [owner.id, input.viewer.id, ...input.bridges.map((user) => user.id), ...allRustAndGoAuthors],
        blueprint.targetMemberCount,
      );
    } else if (blueprint.slug === 'recsys_lab') {
      memberIds = fillMembers(
        [owner.id, input.viewer.id, ...allRecsysAuthors],
        blueprint.targetMemberCount,
      );
    } else {
      memberIds = fillMembers(
        [owner.id, input.viewer.id, ...allProductAuthors],
        blueprint.targetMemberCount,
      );
    }

    return {
      ...blueprint,
      id: uuidv4(),
      ownerId: owner.id,
      ownerUsername: owner.username,
      avatarUrl: input.groupAvatarUrls[blueprint.slug],
      memberIds,
    };
  });
};

const buildPostContent = (
  cluster: DemoClusterKey,
  author: DemoUserSeed,
  authorIndex: number,
  postIndex: number,
): string => {
  const config = DEMO_CLUSTER_CONFIGS[cluster];
  const hook = pick(config.contentHooks, authorIndex + postIndex);
  const angle = pick(config.contentAngles, authorIndex * 2 + postIndex);
  const outcome = pick(config.contentOutcomes, authorIndex + postIndex * 3);
  return `${hook}: tightened ${angle}, and ${outcome}. Demo cohort note ${authorIndex + 1}-${postIndex + 1}.`;
};

const buildPostDrafts = (input: {
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  bridges: DemoUserSeed[];
}): PostSeedDraft[] => {
  const drafts: PostSeedDraft[] = [];

  for (const cluster of DEMO_CLUSTER_ORDER) {
    const config = DEMO_CLUSTER_CONFIGS[cluster];
    input.authorsByCluster[cluster].forEach((author, authorIndex) => {
      const recentPostCount = authorIndex >= 4 ? 3 : 2;
      const clusterBoost = ['ai', 'recsys', 'rust', 'go'].includes(cluster) ? 1.2 : 0.9;
      const discoveryBoost = authorIndex >= 4 ? 1.25 : 0.95;
      for (let postIndex = 0; postIndex < DEMO_AUTHOR_POST_COUNT; postIndex += 1) {
        const daysAgo = postIndex < recentPostCount
          ? (postIndex * 2) + (authorIndex % 2)
          : 8 + ((authorIndex + postIndex) % (DEMO_RECENT_WINDOW_DAYS - 7));
        const createdAt = buildCreatedAt(daysAgo, (authorIndex * 3 + postIndex * 7) % 18);
        const likeCount = Math.round((18 + authorIndex * 3 + (3 - postIndex) * 5) * clusterBoost * discoveryBoost);
        const commentCount = Math.round((4 + (authorIndex % 4) + postIndex) * clusterBoost);
        const repostCount = Math.round((3 + (authorIndex % 3) + Math.max(0, 2 - postIndex)) * discoveryBoost);
        const viewCount = Math.round((180 + authorIndex * 28 + postIndex * 24) * clusterBoost);
        drafts.push({
          cluster,
          authorId: author.id,
          authorUsername: author.username,
          content: buildPostContent(cluster, author, authorIndex, postIndex),
          keywords: dedupe([...config.keywords, pick(config.keywords, authorIndex + postIndex)]),
          stats: {
            likeCount,
            commentCount,
            repostCount,
            quoteCount: 0,
            viewCount,
          },
          engagementScore: likeCount + commentCount * 2 + repostCount * 3 + viewCount / 24,
          createdAt,
          updatedAt: createdAt,
          isPinned: authorIndex === 0 && postIndex === 0,
        });
      }
    });
  }

  input.bridges.slice(0, DEMO_BRIDGE_WITH_POST_COUNT).forEach((bridge, index) => {
    const primaryCluster = bridge.cluster || 'recsys';
    const secondaryCluster = bridge.secondaryClusters[0] || primaryCluster;
    for (let postIndex = 0; postIndex < DEMO_BRIDGE_POST_COUNT; postIndex += 1) {
      const cluster = postIndex % 2 === 0 ? primaryCluster : secondaryCluster;
      const config = DEMO_CLUSTER_CONFIGS[cluster];
      const createdAt = buildCreatedAt((index + postIndex) % 6, (index * 5 + postIndex * 3) % 16);
      const likeCount = 14 + index * 2 + postIndex * 4;
      const commentCount = 3 + (index % 5) + postIndex;
      const repostCount = 2 + (index % 3);
      const viewCount = 140 + index * 12;
      drafts.push({
        cluster,
        authorId: bridge.id,
        authorUsername: bridge.username,
        content: `Bridge note: ${pick(config.contentAngles, index + postIndex)} now links ${DEMO_CLUSTER_CONFIGS[primaryCluster].label} and ${DEMO_CLUSTER_CONFIGS[secondaryCluster].label} more cleanly.`,
        keywords: dedupe([...config.keywords, ...DEMO_CLUSTER_CONFIGS[secondaryCluster].keywords.slice(0, 2)]),
        stats: {
          likeCount,
          commentCount,
          repostCount,
          quoteCount: 0,
          viewCount,
        },
        engagementScore: likeCount + commentCount * 2 + repostCount * 3 + viewCount / 24,
        createdAt,
        updatedAt: createdAt,
        isPinned: false,
      });
    }
  });

  return drafts.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
};

const buildPostLookup = (posts: InsertedPostMeta[]) => {
  const byAuthor = new Map<string, InsertedPostMeta[]>();
  const byCluster = new Map<DemoClusterKey, InsertedPostMeta[]>();

  for (const post of posts) {
    const authorPosts = byAuthor.get(post.authorId) || [];
    authorPosts.push(post);
    byAuthor.set(post.authorId, authorPosts);

    const clusterPosts = byCluster.get(post.cluster) || [];
    clusterPosts.push(post);
    byCluster.set(post.cluster, clusterPosts);
  }

  for (const postsForAuthor of byAuthor.values()) {
    postsForAuthor.sort((a, b) => b.doc.createdAt.getTime() - a.doc.createdAt.getTime());
  }
  for (const postsForCluster of byCluster.values()) {
    postsForCluster.sort((a, b) => b.doc.createdAt.getTime() - a.doc.createdAt.getTime());
  }

  return { byAuthor, byCluster };
};

const pushLikeDoc = (ctx: InteractionContext, userId: string, post: InsertedPostMeta, timestamp: Date): void => {
  ctx.likeDocs.push({
    userId,
    postId: post.doc._id,
    authorId: post.authorId,
    createdAt: timestamp,
  });
};

const pushRepostDoc = (
  ctx: InteractionContext,
  userId: string,
  post: InsertedPostMeta,
  timestamp: Date,
): void => {
  ctx.repostDocs.push({
    userId,
    postId: post.doc._id,
    type: RepostType.REPOST,
    createdAt: timestamp,
  });
};

const pushReplyDoc = (
  ctx: InteractionContext,
  userId: string,
  post: InsertedPostMeta,
  content: string,
  timestamp: Date,
): void => {
  ctx.commentDocs.push({
    userId,
    postId: post.doc._id,
    content,
    likeCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

const buildInteractionState = (input: {
  viewer: DemoUserSeed;
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  bridges: DemoUserSeed[];
  posts: InsertedPostMeta[];
}): InteractionContext => {
  const ctx: InteractionContext = {
    actionDocs: [],
    likeDocs: [],
    repostDocs: [],
    commentDocs: [],
  };
  const lookup = buildPostLookup(input.posts);
  const viewerTargets: InsertedPostMeta[] = [];

  const pushTargetsFromAuthors = (authorIds: string[], perAuthor: number): void => {
    for (const authorId of authorIds) {
      const authorPosts = lookup.byAuthor.get(authorId) || [];
      viewerTargets.push(...authorPosts.slice(0, perAuthor));
    }
  };

  const followedAuthorIds = DEMO_CLUSTER_ORDER.flatMap((cluster) =>
    DEMO_VIEWER_FOLLOW_STRONG_INDEXES.map((index) => input.authorsByCluster[cluster][index].id)
      .concat(DEMO_VIEWER_FOLLOW_WEAK_INDEXES.map((index) => input.authorsByCluster[cluster][index].id)),
  );
  const discoveryAuthorIds = ['ai', 'recsys', 'rust', 'go']
    .flatMap((cluster) => input.authorsByCluster[cluster as DemoClusterKey].slice(4, 8).map((user) => user.id));
  const bridgeAuthorIds = input.bridges.slice(0, 10).map((bridge) => bridge.id);

  pushTargetsFromAuthors(followedAuthorIds, 1);
  pushTargetsFromAuthors(discoveryAuthorIds, 1);
  pushTargetsFromAuthors(bridgeAuthorIds, 1);

  const plans: Array<{
    action: ActionType;
    count: number;
    productSurface: string;
    withDoc?: 'like' | 'repost' | 'reply';
  }> = [
    { action: ActionType.IMPRESSION, count: 22, productSurface: 'feed' },
    { action: ActionType.CLICK, count: 12, productSurface: 'feed' },
    { action: ActionType.LIKE, count: 10, productSurface: 'feed', withDoc: 'like' },
    { action: ActionType.REPLY, count: 4, productSurface: 'detail', withDoc: 'reply' },
    { action: ActionType.REPOST, count: 4, productSurface: 'feed', withDoc: 'repost' },
  ];

  let actionCursor = 0;
  for (const plan of plans) {
    for (let count = 0; count < plan.count; count += 1) {
      const post = viewerTargets[(actionCursor + count) % viewerTargets.length];
      const timestamp = new Date(Date.now() - (actionCursor + count + 1) * 3 * HOUR_MS);
      const replyText = `Strong fit for the demo story: ${post.doc.keywords.slice(0, 2).join(', ')}.`;

      ctx.actionDocs.push({
        userId: input.viewer.id,
        action: plan.action,
        targetPostId: post.doc._id,
        targetAuthorId: post.authorId,
        timestamp,
        productSurface: plan.productSurface,
        rank: (actionCursor + count) % 20,
        inNetwork: followedAuthorIds.includes(post.authorId),
        recallSource: followedAuthorIds.includes(post.authorId) ? 'FollowingSource' : 'PopularSource',
        actionText: plan.action === ActionType.REPLY ? replyText : undefined,
      });

      if (plan.withDoc === 'like') {
        pushLikeDoc(ctx, input.viewer.id, post, timestamp);
      } else if (plan.withDoc === 'repost') {
        pushRepostDoc(ctx, input.viewer.id, post, timestamp);
      } else if (plan.withDoc === 'reply') {
        pushReplyDoc(ctx, input.viewer.id, post, replyText, timestamp);
      }
    }
    actionCursor += plan.count;
  }

  input.bridges.forEach((bridge, bridgeIndex) => {
    const primaryCluster = bridge.cluster || 'recsys';
    const secondaryCluster = bridge.secondaryClusters[0] || primaryCluster;
    const candidatePosts = dedupe([
      ...input.authorsByCluster[primaryCluster].slice(0, 5).map((user) => user.id),
      ...input.authorsByCluster[secondaryCluster].slice(2, 6).map((user) => user.id),
    ]).flatMap((authorId) => (lookup.byAuthor.get(authorId) || []).slice(0, 1));

    const bridgePlans = [
      ActionType.IMPRESSION,
      ActionType.CLICK,
      ActionType.LIKE,
      ActionType.LIKE,
      ActionType.REPLY,
      ActionType.CLICK,
    ];

    bridgePlans.forEach((action, actionIndex) => {
      const post = candidatePosts[(bridgeIndex + actionIndex) % candidatePosts.length];
      const timestamp = new Date(Date.now() - (bridgeIndex * 6 + actionIndex + 10) * 2 * HOUR_MS);
      const commentText = `Bridge signal: ${primaryCluster} overlaps with ${secondaryCluster} here.`;

      ctx.actionDocs.push({
        userId: bridge.id,
        action,
        targetPostId: post.doc._id,
        targetAuthorId: post.authorId,
        timestamp,
        productSurface: 'feed',
        rank: actionIndex,
        inNetwork: false,
        recallSource: 'GraphSource',
        actionText: action === ActionType.REPLY ? commentText : undefined,
      });

      if (action === ActionType.LIKE && actionIndex < 2) {
        pushLikeDoc(ctx, bridge.id, post, timestamp);
      }
      if (action === ActionType.REPLY && bridgeIndex < 8) {
        pushReplyDoc(ctx, bridge.id, post, commentText, timestamp);
      }
    });
  });

  return ctx;
};

const buildRealGraphEdges = (input: {
  contacts: any[];
  actions: any[];
}): any[] => {
  const edgeMap = new Map<string, any>();
  const ensureEdge = (sourceUserId: string, targetUserId: string) => {
    const key = `${sourceUserId}:${targetUserId}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        sourceUserId,
        targetUserId,
        dailyCounts: {
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
        },
        rollupCounts: {
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
        },
        firstInteractionAt: new Date(Date.now() - 9 * DAY_MS),
        lastInteractionAt: new Date(),
        lastDecayAppliedAt: new Date(),
        interactionProbability: 0.2,
        decayedSum: 0,
      });
    }
    return edgeMap.get(key);
  };

  input.contacts.forEach((contact) => {
    const edge = ensureEdge(contact.userId, contact.contactId);
    edge.dailyCounts.followCount = 1;
    edge.rollupCounts.followCount = 1;
    edge.interactionProbability = Math.max(edge.interactionProbability, 0.55);
  });

  input.actions.forEach((action) => {
    if (!action.targetAuthorId) return;
    const edge = ensureEdge(action.userId, action.targetAuthorId);
    edge.lastInteractionAt = action.timestamp;
    if (action.action === ActionType.LIKE) {
      edge.rollupCounts.likeCount += 1;
    } else if (action.action === ActionType.REPLY) {
      edge.rollupCounts.replyCount += 1;
    } else if (action.action === ActionType.REPOST) {
      edge.rollupCounts.retweetCount += 1;
    } else if (action.action === ActionType.CLICK) {
      edge.rollupCounts.tweetClickCount += 1;
    } else if (action.action === ActionType.IMPRESSION) {
      edge.rollupCounts.contentAffinityCount += 1;
    }
  });

  return Array.from(edgeMap.values()).map((edge) => {
    const rollup = edge.rollupCounts;
    const decayedSum =
      rollup.followCount * 10 +
      rollup.likeCount * 1.4 +
      rollup.replyCount * 3.2 +
      rollup.retweetCount * 2.6 +
      rollup.tweetClickCount * 0.5 +
      rollup.contentAffinityCount * 0.7;

    return {
      ...edge,
      decayedSum,
      interactionProbability: Math.min(0.95, 0.12 + decayedSum / 25),
    };
  });
};

const buildDenseEmbedding = (clusterIds: number[], seed: number, dimensions: number = 16): number[] =>
  Array.from({ length: dimensions }, (_, index) => {
    const base = clusterIds.reduce((sum, clusterId, clusterIndex) => sum + ((clusterId % 100) / 100) * (clusterIndex + 1), 0);
    const value = (base + seed * 0.017 + index * 0.031) % 1;
    return Number(value.toFixed(6));
  });

const buildUserFeatureDocuments = (input: {
  viewer: DemoUserSeed;
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  bridges: DemoUserSeed[];
}): any[] => {
  const docs: any[] = [];
  const expiresAt = new Date(Date.now() + 90 * DAY_MS);

  for (const cluster of DEMO_CLUSTER_ORDER) {
    const config = DEMO_CLUSTER_CONFIGS[cluster];
    input.authorsByCluster[cluster].forEach((author, index) => {
      const adjacent = DEMO_CLUSTER_CONFIGS[cluster].adjacentClusters[0];
      docs.push({
        userId: author.id,
        interestedInClusters: [
          { clusterId: config.clusterId, score: Number((0.72 - index * 0.02).toFixed(3)) },
          { clusterId: DEMO_CLUSTER_CONFIGS[adjacent].clusterId, score: 0.24 },
        ],
        knownForCluster: config.clusterId,
        knownForScore: Number((0.94 - index * 0.03).toFixed(3)),
        producerEmbedding: [
          { clusterId: config.clusterId, score: 0.88 },
          { clusterId: DEMO_CLUSTER_CONFIGS[adjacent].clusterId, score: 0.22 },
        ],
        twoTowerEmbedding: buildDenseEmbedding([config.clusterId, DEMO_CLUSTER_CONFIGS[adjacent].clusterId], index),
        phoenixEmbedding: buildDenseEmbedding([config.clusterId], index + 10, 24),
        version: 1,
        modelVersion: 'demo-cohort-v1',
        computedAt: new Date(),
        expiresAt,
        qualityScore: 0.92,
      });
    });
  }

  docs.push({
    userId: input.viewer.id,
    interestedInClusters: [
      { clusterId: DEMO_CLUSTER_CONFIGS.recsys.clusterId, score: 0.32 },
      { clusterId: DEMO_CLUSTER_CONFIGS.ai.clusterId, score: 0.26 },
      { clusterId: DEMO_CLUSTER_CONFIGS.rust.clusterId, score: 0.21 },
      { clusterId: DEMO_CLUSTER_CONFIGS.go.clusterId, score: 0.15 },
      { clusterId: DEMO_CLUSTER_CONFIGS.frontend.clusterId, score: 0.06 },
    ],
    producerEmbedding: [
      { clusterId: DEMO_CLUSTER_CONFIGS.recsys.clusterId, score: 0.3 },
      { clusterId: DEMO_CLUSTER_CONFIGS.ai.clusterId, score: 0.24 },
    ],
    twoTowerEmbedding: buildDenseEmbedding(DEMO_CLUSTER_IDS, 101),
    phoenixEmbedding: buildDenseEmbedding([DEMO_CLUSTER_CONFIGS.recsys.clusterId, DEMO_CLUSTER_CONFIGS.ai.clusterId], 111, 24),
    version: 1,
    modelVersion: 'demo-cohort-v1',
    computedAt: new Date(),
    expiresAt,
    qualityScore: 0.97,
  });

  input.bridges.forEach((bridge, index) => {
    const cluster = bridge.cluster || 'recsys';
    const secondary = bridge.secondaryClusters[0] || cluster;
    docs.push({
      userId: bridge.id,
      interestedInClusters: [
        { clusterId: DEMO_CLUSTER_CONFIGS[cluster].clusterId, score: 0.48 },
        { clusterId: DEMO_CLUSTER_CONFIGS[secondary].clusterId, score: 0.41 },
      ],
      producerEmbedding: [
        { clusterId: DEMO_CLUSTER_CONFIGS[cluster].clusterId, score: 0.35 },
        { clusterId: DEMO_CLUSTER_CONFIGS[secondary].clusterId, score: 0.31 },
      ],
      twoTowerEmbedding: buildDenseEmbedding(
        [DEMO_CLUSTER_CONFIGS[cluster].clusterId, DEMO_CLUSTER_CONFIGS[secondary].clusterId],
        index + 200,
      ),
      phoenixEmbedding: buildDenseEmbedding(
        [DEMO_CLUSTER_CONFIGS[cluster].clusterId, DEMO_CLUSTER_CONFIGS[secondary].clusterId],
        index + 220,
        24,
      ),
      version: 1,
      modelVersion: 'demo-cohort-v1',
      computedAt: new Date(),
      expiresAt,
      qualityScore: 0.88,
    });
  });

  return docs;
};

const buildClusterDefinitionDocs = (input: {
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  posts: InsertedPostMeta[];
  bridges: DemoUserSeed[];
  viewer: DemoUserSeed;
}): any[] => {
  const docs: any[] = [];
  const lookup = buildPostLookup(input.posts);
  const visibleUsers = [input.viewer, ...input.bridges];

  for (const cluster of DEMO_CLUSTER_ORDER) {
    const config = DEMO_CLUSTER_CONFIGS[cluster];
    const posts = (lookup.byCluster.get(cluster) || []).slice().sort((left, right) => right.doc.engagementScore - left.doc.engagementScore);
    const interestedInCount = visibleUsers.filter((user) =>
      user.cluster === cluster || user.secondaryClusters.includes(cluster),
    ).length;
    const avgEngagementRate = posts.length > 0
      ? posts.reduce((sum, post) => sum + (post.doc.engagementScore || 0), 0) / posts.length / 100
      : 0;

    docs.push({
      clusterId: config.clusterId,
      clusterType: 'topic_cluster',
      name: config.label,
      description: `Demo cluster for ${config.label.toLowerCase()} content and author cohorts.`,
      tags: config.keywords,
      topProducers: input.authorsByCluster[cluster].map((author, index) => ({
        userId: author.id,
        score: Number((0.94 - index * 0.03).toFixed(3)),
        rank: index + 1,
        joinedAt: buildCreatedAt(18 - Math.min(index, 14), index),
      })),
      representativePostIds: posts.slice(0, 6).map((post) => String(post.doc._id)),
      centroidEmbedding: buildDenseEmbedding([config.clusterId], 300 + config.clusterId, 16),
      relatedClusters: config.adjacentClusters.map((adjacent, index) => ({
        clusterId: DEMO_CLUSTER_CONFIGS[adjacent].clusterId,
        similarity: Number((0.68 - index * 0.09).toFixed(3)),
      })),
      stats: {
        totalMembers: input.authorsByCluster[cluster].length,
        activeMembers: input.authorsByCluster[cluster].length,
        avgMemberScore: 0.84,
        interestedInCount,
        avgDailyPosts: Number((posts.length / DEMO_RECENT_WINDOW_DAYS).toFixed(2)),
        avgEngagementRate: Number(avgEngagementRate.toFixed(3)),
        memberGrowthRate: 0.18,
        engagementGrowthRate: 0.27,
      },
      level: 0,
      version: 1,
      isActive: true,
      lastRecomputedAt: new Date(),
    });
  }

  return docs;
};

const buildVisibleProfiles = (users: DemoUserSeed[]): any[] =>
  users.map((user) => ({
    userId: user.id,
    displayName: user.displayName,
    bio: user.bio,
    location: user.location,
    website: user.website,
    coverUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

const buildUserSettingsDocs = (users: DemoUserSeed[]): any[] =>
  users.map((user) => ({
    userId: user.id,
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
      preferInNetwork: user.role !== 'audience',
      sensitiveContentFilter: true,
    },
    privacySettings: {
      allowDirectMessages: 'everyone',
      showOnlineStatus: true,
      showReadReceipts: true,
    },
  }));

const seedHistoricalMessages = async (groups: DemoGroupSeed[], usersById: Map<string, DemoUserSeed>): Promise<void> => {
  for (const group of groups) {
    const memberSeeds = group.memberIds
      .map((memberId) => usersById.get(memberId))
      .filter((user): user is DemoUserSeed => Boolean(user));
    const talkers = memberSeeds.filter((user) => user.role !== 'audience');
    const senderPool = talkers.length > 0 ? talkers : memberSeeds.slice(0, 12);

    for (let index = 0; index < group.historyMessages; index += 1) {
      const sender = senderPool[index % senderPool.length];
      const baseMessage = pick(DEMO_GROUP_MESSAGE_THEMES[group.slug], index);
      const content = `${baseMessage} [history ${index + 1}]`;
      const targetDate = new Date(Date.now() - (group.historyMessages - index) * 22 * 60 * 1000);

      const result = await createAndFanoutMessage({
        senderId: sender.id,
        groupId: group.id,
        chatType: 'group',
        content,
      });

      await Message.collection.updateOne(
        { _id: result.message._id as any },
        { $set: { createdAt: targetDate, updatedAt: targetDate, timestamp: targetDate } },
      );
    }
  }
};

const verifyState = async (input: {
  allUsers: DemoUserSeed[];
  viewer: DemoUserSeed;
  viewerPassword: string;
  groups: DemoGroupSeed[];
  authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
  bridges: DemoUserSeed[];
}): Promise<void> => {
  const viewer = await User.findByPk(input.viewer.id);
  const loginOk = viewer ? await viewer.validatePassword(input.viewerPassword) : false;
  const demoUserIds = input.allUsers.map((user) => user.id);
  const contentUserIds = [
    input.viewer.id,
    ...DEMO_CLUSTER_ORDER.flatMap((cluster) => input.authorsByCluster[cluster].map((author) => author.id)),
    ...input.bridges.map((bridge) => bridge.id),
  ];
  const groupIds = input.groups.map((group) => group.id);
  const groupChatIds = input.groups.map((group) => getGroupChatId(group.id));
  const normalGroups = input.groups.filter((group) => group.memberIds.length <= 500);
  const normalGroupIds = normalGroups.map((group) => group.id);
  const normalGroupChatIds = normalGroups.map((group) => getGroupChatId(group.id));
  const largeGroups = input.groups.filter((group) => group.memberIds.length > 500);
  const largeGroupIds = largeGroups.map((group) => group.id);
  const expectedLargeGroupCount = largeGroups.length;
  const expectedFeatureVectorCount = 1 + (DEMO_CLUSTER_ORDER.length * 8) + input.bridges.length;

  const demoUserCount = await User.count({ where: { id: { [Op.in]: demoUserIds } } });
  const demoGroupCount = await Group.count({ where: { id: { [Op.in]: groupIds } } });
  const demoContactCount = await Contact.count({
    where: {
      [Op.or]: [
        { userId: { [Op.in]: demoUserIds } },
        { contactId: { [Op.in]: demoUserIds } },
      ],
    },
  });
  const demoGroupMemberCount = await GroupMember.count({
    where: {
      groupId: { [Op.in]: groupIds },
      userId: { [Op.in]: demoUserIds },
      isActive: true,
    },
  });
  const maxMemberCount = Math.max(...input.groups.map((group) => group.memberIds.length));
  const postsCount = await Post.countDocuments({
    authorId: { $in: contentUserIds },
  });
  const actionCount = await UserAction.countDocuments({
    $or: [
      { userId: { $in: demoUserIds } },
      { targetAuthorId: { $in: demoUserIds } },
    ],
  });
  const edgeCount = await RealGraphEdge.countDocuments({
    $or: [
      { sourceUserId: { $in: demoUserIds } },
      { targetUserId: { $in: demoUserIds } },
    ],
  });
  const featureVectorCount = await UserFeatureVector.countDocuments({
    userId: { $in: contentUserIds },
  });
  const messageCount = await Message.countDocuments({
    $or: [
      { groupId: { $in: groupIds } },
      { receiver: { $in: groupIds } },
      { chatId: { $in: groupChatIds } },
    ],
  });
  const chatCounterCount = await ChatCounter.countDocuments({ _id: { $in: groupChatIds } });
  const groupStateCount = await GroupState.countDocuments({ _id: { $in: largeGroupIds } });
  const chatMemberStateCount = await ChatMemberState.countDocuments({
    chatId: { $in: normalGroupChatIds },
  });
  const updateCounterCount = await UpdateCounter.countDocuments({ _id: { $in: demoUserIds } });
  const updateLogCount = await UpdateLog.countDocuments({
    userId: { $in: demoUserIds },
    chatId: { $in: normalGroupChatIds },
  });
  const outboxCount = await ChatDeliveryOutbox.countDocuments({
    chatId: { $in: normalGroupChatIds },
    senderId: { $in: demoUserIds },
  });

  const timelineChecks = await Promise.all(
    DEMO_CLUSTER_ORDER.slice(0, 4).map(async (cluster) => {
      const key = InNetworkTimelineService.timelineKey(input.authorsByCluster[cluster][0].id);
      const size = await require('../../config/redis').redis.zcard(key);
      return { cluster, size };
    }),
  );
  const failedChecks: string[] = [];

  if (!loginOk) failedChecks.push('viewer password validation failed');
  if (demoUserCount !== input.allUsers.length) failedChecks.push(`expected ${input.allUsers.length} demo users, got ${demoUserCount}`);
  if (demoGroupCount !== input.groups.length) failedChecks.push(`expected ${input.groups.length} demo groups, got ${demoGroupCount}`);
  if (demoContactCount === 0) failedChecks.push('demo contacts were not created');
  if (demoGroupMemberCount !== input.groups.reduce((sum, group) => sum + group.memberIds.length, 0)) {
    failedChecks.push(`expected ${input.groups.reduce((sum, group) => sum + group.memberIds.length, 0)} group members, got ${demoGroupMemberCount}`);
  }
  if (maxMemberCount <= 500) failedChecks.push('no demo group crossed the large-group threshold');
  if (postsCount < 220) failedChecks.push(`expected at least 220 demo posts, got ${postsCount}`);
  if (actionCount < 60) failedChecks.push(`expected at least 60 demo user actions, got ${actionCount}`);
  if (edgeCount < demoContactCount) failedChecks.push(`graph edges ${edgeCount} are below contact count ${demoContactCount}`);
  if (featureVectorCount !== expectedFeatureVectorCount) {
    failedChecks.push(`expected ${expectedFeatureVectorCount} feature vectors, got ${featureVectorCount}`);
  }
  if (messageCount < input.groups.reduce((sum, group) => sum + group.historyMessages, 0)) {
    failedChecks.push(`expected at least ${input.groups.reduce((sum, group) => sum + group.historyMessages, 0)} demo messages, got ${messageCount}`);
  }
  if (chatCounterCount !== input.groups.length) {
    failedChecks.push(`expected ${input.groups.length} chat counters, got ${chatCounterCount}`);
  }
  if (groupStateCount !== expectedLargeGroupCount) {
    failedChecks.push(`expected ${expectedLargeGroupCount} large-group GroupState docs, got ${groupStateCount}`);
  }
  if (normalGroupIds.length > 0 && chatMemberStateCount === 0) failedChecks.push('normal-group ChatMemberState docs were not created');
  if (normalGroupIds.length > 0 && updateCounterCount === 0) failedChecks.push('demo UpdateCounter docs were not created');
  if (normalGroupIds.length > 0 && updateLogCount === 0) failedChecks.push('normal-group UpdateLog docs were not created');
  if (normalGroupIds.length > 0 && outboxCount === 0) failedChecks.push('normal-group ChatDeliveryOutbox docs were not created');
  for (const check of timelineChecks) {
    if (check.size === 0) {
      failedChecks.push(`timeline ${check.cluster} is empty`);
    }
  }

  console.log('[demo:prepare] verification');
  console.log(`  login: ${loginOk ? 'ok' : 'failed'}`);
  console.log(`  demo users: ${demoUserCount}`);
  console.log(`  demo groups: ${demoGroupCount}`);
  console.log(`  demo contacts: ${demoContactCount}`);
  console.log(`  demo group members: ${demoGroupMemberCount}`);
  console.log(`  max member count: ${maxMemberCount}`);
  console.log(`  demo posts: ${postsCount}`);
  console.log(`  user actions: ${actionCount}`);
  console.log(`  graph edges: ${edgeCount}`);
  console.log(`  feature vectors: ${featureVectorCount}`);
  console.log(`  demo messages: ${messageCount}`);
  console.log(`  chat counters: ${chatCounterCount}`);
  console.log(`  group states: ${groupStateCount}`);
  console.log(`  chat member states: ${chatMemberStateCount}`);
  console.log(`  update counters: ${updateCounterCount}`);
  console.log(`  update logs: ${updateLogCount}`);
  console.log(`  delivery outbox docs: ${outboxCount}`);
  console.log(`  timelines: ${timelineChecks.map((item) => `${item.cluster}:${item.size}`).join(', ')}`);

  if (failedChecks.length > 0) {
    throw new Error(`demo verification failed: ${failedChecks.join('; ')}`);
  }
}

async function main(): Promise<void> {
  const viewerPassword = requiredViewerPassword();
  await connectDemoStores();

  try {
    const publicApiBaseUrl = resolvePublicApiBaseUrl();
    const warnings = buildFrontendTargetWarnings(publicApiBaseUrl);
    warnings.forEach((warning) => console.warn(`[demo:prepare] warning: ${warning}`));

    const existing = await collectExistingDemoState();
    if (existing.demoUserIds.length || existing.demoGroupIds.length || existing.demoPostIds.length) {
      console.log('[demo:prepare] cleaning previous demo cohort');
      await cleanupDemoCohort(existing);
    }

    const viewerPasswordHash = await bcrypt.hash(viewerPassword, 12);
    const defaultPasswordHash = await bcrypt.hash(DEMO_DEFAULT_PASSWORD, 12);
    const portraitPool = await preparePortraitPool(DEMO_AVATAR_POOL_SIZE, publicApiBaseUrl);
    const groupAvatarUrls = await prepareGroupAvatarUrls(publicApiBaseUrl);

    const { allUsers, viewer, authorsByCluster, bridges, audiences } = await buildDemoUsers({
      viewerPasswordHash,
      defaultPasswordHash,
      portraitPool,
    });
    const usersById = new Map(allUsers.map((user) => [user.id, user]));

    await User.bulkCreate(
      allUsers.map((user) => ({
        id: user.id,
        username: user.username,
        password: user.passwordHash,
        avatarUrl: user.avatarUrl,
        lastSeen: user.lastSeen,
        isOnline: user.isOnline,
        createdAt: buildCreatedAt(15, 2),
        updatedAt: new Date(),
      })),
      { validate: true, hooks: false },
    );

    await Promise.all([
      SpaceProfile.insertMany(buildVisibleProfiles([viewer, ...DEMO_CLUSTER_ORDER.flatMap((cluster) => authorsByCluster[cluster]), ...bridges]), { ordered: false }),
      UserSettings.insertMany(buildUserSettingsDocs(allUsers), { ordered: false }),
    ]);

    const contacts = buildContacts({ viewer, authorsByCluster, bridges });
    await Contact.bulkCreate(contacts, { validate: true });

    const groups = buildDemoGroups({
      viewer,
      authorsByCluster,
      bridges,
      audiences,
      groupAvatarUrls,
    });

    await Group.bulkCreate(
      groups.map((group, index) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        ownerId: group.ownerId,
        type: GroupType.PUBLIC,
        avatarUrl: group.avatarUrl,
        maxMembers: group.maxMembers,
        memberCount: group.memberIds.length,
        isActive: true,
        createdAt: buildCreatedAt(12 - index * 2, 1),
        updatedAt: new Date(),
      })),
      { validate: true },
    );

    await GroupMember.bulkCreate(
      groups.flatMap((group) =>
        group.memberIds.map((memberId, index) => ({
          groupId: group.id,
          userId: memberId,
          role: memberId === group.ownerId
            ? MemberRole.OWNER
            : index < 4 && usersById.get(memberId)?.role === 'bridge'
              ? MemberRole.ADMIN
              : MemberRole.MEMBER,
          status: MemberStatus.ACTIVE,
          isActive: true,
          joinedAt: buildCreatedAt(10 - Math.min(index % 6, 5), index % 12),
          invitedBy: group.ownerId,
          createdAt: buildCreatedAt(10 - Math.min(index % 6, 5), index % 12),
          updatedAt: new Date(),
        })),
      ),
      { validate: true },
    );

    await persistDemoCohortManifest({
      demoUserIds: allUsers.map((user) => user.id),
      demoGroupIds: groups.map((group) => group.id),
    });

    const postDrafts = buildPostDrafts({ authorsByCluster, bridges });
    const insertedPosts = await Post.insertMany(
      postDrafts.map((draft) => ({
        authorId: draft.authorId,
        content: draft.content,
        media: [],
        stats: draft.stats,
        isRepost: false,
        isReply: false,
        keywords: draft.keywords,
        isNsfw: false,
        isPinned: draft.isPinned,
        engagementScore: draft.engagementScore,
        isNews: false,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      })),
      { ordered: true },
    );

    const insertedMeta: InsertedPostMeta[] = insertedPosts.map((doc, index) => ({
      cluster: postDrafts[index].cluster,
      authorId: postDrafts[index].authorId,
      authorUsername: postDrafts[index].authorUsername,
      doc,
    }));

    for (const post of insertedMeta) {
      await InNetworkTimelineService.addPost(post.authorId, String(post.doc._id), post.doc.createdAt);
    }

    const interactionState = buildInteractionState({
      viewer,
      authorsByCluster,
      bridges,
      posts: insertedMeta,
    });

    if (interactionState.commentDocs.length > 0) {
      await Comment.insertMany(interactionState.commentDocs, { ordered: false });
    }
    if (interactionState.likeDocs.length > 0) {
      await Like.insertMany(interactionState.likeDocs, { ordered: false });
    }
    if (interactionState.repostDocs.length > 0) {
      await Repost.insertMany(interactionState.repostDocs, { ordered: false });
    }
    await UserAction.insertMany(interactionState.actionDocs, { ordered: false });

    const edgeDocs = buildRealGraphEdges({
      contacts,
      actions: interactionState.actionDocs,
    });
    if (edgeDocs.length > 0) {
      await RealGraphEdge.insertMany(edgeDocs, { ordered: false });
    }

    const userFeatureDocs = buildUserFeatureDocuments({
      viewer,
      authorsByCluster,
      bridges,
    });
    if (userFeatureDocs.length > 0) {
      await UserFeatureVector.insertMany(userFeatureDocs, { ordered: false });
    }

    const clusterDefinitionDocs = buildClusterDefinitionDocs({
      authorsByCluster,
      posts: insertedMeta,
      bridges,
      viewer,
    });
    for (const doc of clusterDefinitionDocs) {
      await ClusterDefinition.findOneAndUpdate(
        { clusterId: doc.clusterId },
        { $set: doc },
        { upsert: true, new: true },
      );
    }

    await seedHistoricalMessages(groups, usersById);

    await verifyState({
      allUsers,
      viewer,
      viewerPassword,
      groups,
      authorsByCluster,
      bridges,
    });

    console.log('[demo:prepare] completed');
    console.log(`  viewer username: ${viewer.username}`);
    console.log(`  default password for non-viewer demo users: ${DEMO_DEFAULT_PASSWORD}`);
    console.log(`  groups: ${groups.map((group) => `${group.name} (${group.memberIds.length})`).join(' | ')}`);
  } finally {
    await disconnectDemoStores();
  }
}

main().catch(async (error) => {
  console.error('[demo:prepare] failed:', error);
  await disconnectDemoStores();
  process.exit(1);
});
