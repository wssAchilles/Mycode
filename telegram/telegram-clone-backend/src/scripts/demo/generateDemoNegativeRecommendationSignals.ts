import mongoose from 'mongoose';
import { Op } from 'sequelize';

import Contact, { ContactStatus } from '../../models/Contact';
import Like from '../../models/Like';
import Post from '../../models/Post';
import RealGraphEdge, {
  DECAY_CONFIG,
  InteractionCounts,
  InteractionType,
  REALGRAPH_FEATURE_VERSION,
  REALGRAPH_MODEL_VERSION,
  REALGRAPH_PREDICTION_MODE,
} from '../../models/RealGraphEdge';
import Repost, { RepostType } from '../../models/Repost';
import User from '../../models/User';
import UserAction, { ActionType } from '../../models/UserAction';
import UserSettings from '../../models/UserSettings';
import UserSignal, { ProductSurface, SignalType, TargetType } from '../../models/UserSignal';
import { sequelize } from '../../config/sequelize';
import { DEMO_VIEWER_USERNAME } from './config';

type Options = {
  user: string;
  dryRun: boolean;
  limit: number;
};

type DemoUser = {
  id: string;
  username: string;
};

type DemoPost = {
  _id: mongoose.Types.ObjectId;
  authorId: string;
  content?: string;
  keywords?: string[];
};

const SCRIPT_ID = 'demo_negative_recommendation_signals_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 16;

const NEGATIVE_SIGNAL_PLAN = [
  SignalType.UNFAVORITE,
  SignalType.UNRETWEET,
  SignalType.UNFOLLOW,
  SignalType.BLOCK,
  SignalType.MUTE,
  SignalType.REPORT,
  SignalType.DISMISS_POST,
  SignalType.HIDE_POST,
  SignalType.UNBOOKMARK,
  SignalType.NOTIFICATION_DISMISS,
] as const;

const parseBooleanFlag = (flag: string): boolean => process.argv.includes(flag);

const parseStringArg = (flag: string, fallback: string): string => {
  const direct = process.argv.find((value) => value.startsWith(`${flag}=`));
  const flagIndex = process.argv.indexOf(flag);
  const raw = direct ? direct.slice(flag.length + 1) : flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
  if (!raw || raw.startsWith('--')) return fallback;
  return raw;
};

const parseNumberArg = (flag: string, fallback: number): number => {
  const raw = parseStringArg(flag, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseOptions = (): Options => ({
  user: parseStringArg('--user', DEMO_VIEWER_USERNAME),
  dryRun: parseBooleanFlag('--dry-run'),
  limit: parseNumberArg('--limit', DEFAULT_LIMIT),
});

const pick = <T>(items: T[], index: number): T => {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty list');
  }
  return items[index % items.length];
};

const targetPostSignals = new Set<SignalType>([
  SignalType.UNFAVORITE,
  SignalType.UNRETWEET,
  SignalType.REPORT,
  SignalType.DISMISS_POST,
  SignalType.HIDE_POST,
  SignalType.UNBOOKMARK,
]);

const targetUserSignals = new Set<SignalType>([
  SignalType.UNFOLLOW,
  SignalType.BLOCK,
  SignalType.MUTE,
]);

const extractKeywords = (post: DemoPost | undefined): string[] => {
  if (!post) return [];
  const keywords = Array.isArray(post.keywords) ? post.keywords.filter(Boolean) : [];
  return Array.from(new Set([...keywords, 'demo_negative_feedback', 'recommendation']));
};

const signalWeight = (signalType: SignalType): number | null => {
  switch (signalType) {
    case SignalType.UNFAVORITE:
      return -0.5;
    case SignalType.UNRETWEET:
      return -1.0;
    case SignalType.UNFOLLOW:
      return -3.0;
    case SignalType.BLOCK:
      return -10.0;
    case SignalType.MUTE:
      return -5.0;
    case SignalType.REPORT:
      return -8.0;
    case SignalType.DISMISS_POST:
      return -2.0;
    case SignalType.HIDE_POST:
      return -4.0;
    case SignalType.UNBOOKMARK:
      return -0.5;
    case SignalType.NOTIFICATION_DISMISS:
      return -0.1;
    default:
      return null;
  }
};

const actionForSignal = (signalType: SignalType): ActionType | null => {
  switch (signalType) {
    case SignalType.DISMISS_POST:
      return ActionType.DISMISS;
    case SignalType.HIDE_POST:
      return ActionType.HIDE;
    case SignalType.REPORT:
      return ActionType.REPORT;
    case SignalType.BLOCK:
      return ActionType.BLOCK_AUTHOR;
    default:
      return null;
  }
};

const graphInteractionForSignal = (signalType: SignalType): InteractionType | null => {
  switch (signalType) {
    case SignalType.UNFOLLOW:
      return InteractionType.UNFOLLOW;
    case SignalType.BLOCK:
      return InteractionType.BLOCK;
    case SignalType.MUTE:
      return InteractionType.MUTE;
    case SignalType.REPORT:
      return InteractionType.REPORT;
    default:
      return null;
  }
};

const zeroCounts = (): InteractionCounts => ({
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

const mergeCounts = (value?: Partial<InteractionCounts>): InteractionCounts => ({
  ...zeroCounts(),
  ...(value || {}),
});

const computeDecayedSum = (counts: InteractionCounts): number => {
  const weights = DECAY_CONFIG.weights;
  return (
    counts.followCount * weights.follow +
    counts.likeCount * weights.like +
    counts.replyCount * weights.reply +
    counts.retweetCount * weights.retweet +
    counts.quoteCount * weights.quote +
    counts.mentionCount * weights.mention +
    counts.profileViewCount * weights.profileView +
    counts.tweetClickCount * weights.tweetClick +
    counts.dwellTimeMs * weights.dwell +
    counts.addressBookCount * weights.addressBook +
    counts.directMessageCount * weights.directMessage +
    counts.coEngagementCount * weights.coEngagement +
    counts.contentAffinityCount * weights.contentAffinity +
    counts.muteCount * weights.mute +
    counts.blockCount * weights.block +
    counts.reportCount * weights.report
  );
};

const sigmoid = (value: number, scale = 0.1): number => 1 / (1 + Math.exp(-value * scale));

const countsToSet = (prefix: 'dailyCounts' | 'rollupCounts', counts: InteractionCounts): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    out[`${prefix}.${key}`] = Number(value) || 0;
  }
  return out;
};

async function loadViewer(username: string): Promise<DemoUser> {
  const row = await User.findOne({
    where: { username },
    attributes: ['id', 'username'],
  });
  if (!row) {
    throw new Error(`User not found: ${username}`);
  }
  const plain = row.get({ plain: true }) as DemoUser;
  return { id: String(plain.id), username: plain.username };
}

async function loadCandidateUsers(viewerId: string, limit: number): Promise<DemoUser[]> {
  const rows = await User.findAll({
    where: {
      id: { [Op.ne]: viewerId },
      username: { [Op.like]: 'demo_%' },
    },
    attributes: ['id', 'username'],
    order: [['username', 'ASC']],
    limit: Math.max(limit, NEGATIVE_SIGNAL_PLAN.length) * 3,
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as DemoUser;
    return { id: String(plain.id), username: plain.username };
  });
}

async function loadCandidatePosts(viewerId: string, limit: number): Promise<DemoPost[]> {
  return Post.find({
    authorId: { $ne: viewerId },
    deletedAt: null,
    isNews: { $ne: true },
  })
    .select('_id authorId content keywords')
    .sort({ createdAt: -1 })
    .limit(Math.max(limit, NEGATIVE_SIGNAL_PLAN.length) * 4)
    .lean<DemoPost[]>();
}

async function clearPreviousRun(viewerId: string): Promise<{ actionsDeleted: number; signalsDeleted: number }> {
  const [actions, signals] = await Promise.all([
    UserAction.deleteMany({ userId: viewerId, experimentKeys: SCRIPT_ID }),
    UserSignal.deleteMany({ userId: viewerId, 'metadata.generatedBy': SCRIPT_ID }),
  ]);
  return {
    actionsDeleted: actions.deletedCount || 0,
    signalsDeleted: signals.deletedCount || 0,
  };
}

async function upsertNegativeGraphEdge(sourceUserId: string, targetUserId: string, signalType: SignalType, timestamp: Date) {
  const interaction = graphInteractionForSignal(signalType);
  if (!interaction) return;

  const existing = await RealGraphEdge.findOne({ sourceUserId, targetUserId });
  const dailyCounts = mergeCounts(existing?.dailyCounts);
  const rollupCounts = mergeCounts(existing?.rollupCounts);

  if (interaction === InteractionType.UNFOLLOW) {
    dailyCounts.followCount = Math.min(dailyCounts.followCount, 0);
    rollupCounts.followCount = Math.min(rollupCounts.followCount, 0);
  } else if (interaction === InteractionType.BLOCK) {
    dailyCounts.blockCount = Math.max(dailyCounts.blockCount, 1);
    rollupCounts.blockCount = Math.max(rollupCounts.blockCount, 1);
  } else if (interaction === InteractionType.MUTE) {
    dailyCounts.muteCount = Math.max(dailyCounts.muteCount, 1);
    rollupCounts.muteCount = Math.max(rollupCounts.muteCount, 1);
  } else if (interaction === InteractionType.REPORT) {
    dailyCounts.reportCount = Math.max(dailyCounts.reportCount, 1);
    rollupCounts.reportCount = Math.max(rollupCounts.reportCount, 1);
  }

  const decayedSum = computeDecayedSum(rollupCounts);
  const interactionProbability = rollupCounts.blockCount > 0
    ? 0
    : sigmoid(decayedSum);

  await RealGraphEdge.findOneAndUpdate(
    { sourceUserId, targetUserId },
    {
      $set: {
        ...countsToSet('dailyCounts', dailyCounts),
        ...countsToSet('rollupCounts', rollupCounts),
        decayedSum,
        interactionProbability,
        predictionMode: REALGRAPH_PREDICTION_MODE,
        modelVersion: REALGRAPH_MODEL_VERSION,
        featureVersion: REALGRAPH_FEATURE_VERSION,
        lastPredictionAt: timestamp,
        lastInteractionAt: timestamp,
      },
      $setOnInsert: {
        firstInteractionAt: timestamp,
        lastDecayAppliedAt: timestamp,
      },
    },
    { upsert: true, new: true },
  );
}

async function ensureStateForNegativeSignals(viewerId: string, signals: any[]): Promise<void> {
  const block = signals.find((signal) => signal.signalType === SignalType.BLOCK);
  if (block?.targetId) {
    const [contact] = await Contact.findOrCreate({
      where: { userId: viewerId, contactId: block.targetId },
      defaults: { userId: viewerId, contactId: block.targetId, status: ContactStatus.BLOCKED },
    });
    if (contact.status !== ContactStatus.BLOCKED) {
      contact.status = ContactStatus.BLOCKED;
      await contact.save();
    }
  }

  const mute = signals.find((signal) => signal.signalType === SignalType.MUTE);
  if (mute?.targetId) {
    await UserSettings.addMutedUser(viewerId, mute.targetId);
  }

  const unfollow = signals.find((signal) => signal.signalType === SignalType.UNFOLLOW);
  if (unfollow?.targetId) {
    await Contact.destroy({ where: { userId: viewerId, contactId: unfollow.targetId } });
  }

  const unfavorite = signals.find((signal) => signal.signalType === SignalType.UNFAVORITE);
  if (unfavorite?.targetId && mongoose.Types.ObjectId.isValid(unfavorite.targetId)) {
    await Like.deleteMany({ userId: viewerId, postId: new mongoose.Types.ObjectId(unfavorite.targetId) });
  }

  const unretweet = signals.find((signal) => signal.signalType === SignalType.UNRETWEET);
  if (unretweet?.targetId && mongoose.Types.ObjectId.isValid(unretweet.targetId)) {
    await Repost.deleteMany({
      userId: viewerId,
      postId: new mongoose.Types.ObjectId(unretweet.targetId),
      type: RepostType.REPOST,
    });
  }
}

function buildRecords(viewer: DemoUser, users: DemoUser[], posts: DemoPost[], limit: number) {
  const now = Date.now();
  const signals: any[] = [];
  const actions: any[] = [];

  const plan = NEGATIVE_SIGNAL_PLAN.slice(0, Math.max(NEGATIVE_SIGNAL_PLAN.length, limit));
  for (let index = 0; index < plan.length; index += 1) {
    const signalType = plan[index];
    const timestamp = new Date(now - index * 90_000);
    const weight = signalWeight(signalType);
    const post = targetPostSignals.has(signalType) ? pick(posts, index) : undefined;
    const user = targetUserSignals.has(signalType)
      ? pick(users, index + 3)
      : post
        ? users.find((candidate) => candidate.id === post.authorId) || pick(users, index)
        : pick(users, index);

    const targetId = signalType === SignalType.NOTIFICATION_DISMISS
      ? `demo-notification-${viewer.username}-${index}`
      : post
        ? String(post._id)
        : user.id;
    const targetType = signalType === SignalType.NOTIFICATION_DISMISS
      ? TargetType.NOTIFICATION
      : post
        ? TargetType.POST
        : TargetType.USER;
    const targetAuthorId = post?.authorId;
    const targetKeywords = extractKeywords(post);
    const reason = signalType === SignalType.REPORT
      ? 'spam'
      : signalType === SignalType.DISMISS_POST
        ? 'not_interested'
        : signalType === SignalType.HIDE_POST
          ? 'hide_post'
          : undefined;

    signals.push({
      userId: viewer.id,
      signalType,
      targetId,
      targetType,
      targetAuthorId,
      productSurface: signalType === SignalType.NOTIFICATION_DISMISS
        ? ProductSurface.NOTIFICATIONS
        : ProductSurface.SPACE_FEED,
      requestId: `${SCRIPT_ID}:${index}`,
      metadata: {
        generatedBy: SCRIPT_ID,
        demoViewer: viewer.username,
        targetUsername: user.username,
        targetKeywords,
        reason,
        negativeWeight: weight,
      },
      timestamp,
      expiresAt: new Date(timestamp.getTime() + 30 * DAY_MS),
    });

    const action = actionForSignal(signalType);
    if (action) {
      actions.push({
        userId: viewer.id,
        action,
        targetPostId: post ? post._id : undefined,
        targetAuthorId: targetAuthorId || user.id,
        requestId: `${SCRIPT_ID}:${index}`,
        productSurface: ProductSurface.SPACE_FEED,
        targetKeywords,
        actionText: reason || signalType,
        experimentKeys: [SCRIPT_ID],
        timestamp,
      });
    }
  }

  return { signals, actions };
}

async function summarize(viewerId: string) {
  const signalCounts = await UserSignal.aggregate([
    { $match: { userId: viewerId, 'metadata.generatedBy': SCRIPT_ID } },
    { $group: { _id: '$signalType', count: { $sum: 1 }, latest: { $max: '$timestamp' } } },
    { $sort: { _id: 1 } },
  ]);
  const actionCounts = await UserAction.aggregate([
    { $match: { userId: viewerId, experimentKeys: SCRIPT_ID } },
    { $group: { _id: '$action', count: { $sum: 1 }, latest: { $max: '$timestamp' } } },
    { $sort: { _id: 1 } },
  ]);
  const graph = await RealGraphEdge.aggregate([
    { $match: { sourceUserId: viewerId } },
    {
      $group: {
        _id: null,
        edgesWithMute: { $sum: { $cond: [{ $gt: ['$rollupCounts.muteCount', 0] }, 1, 0] } },
        edgesWithBlock: { $sum: { $cond: [{ $gt: ['$rollupCounts.blockCount', 0] }, 1, 0] } },
        edgesWithReport: { $sum: { $cond: [{ $gt: ['$rollupCounts.reportCount', 0] }, 1, 0] } },
        totalMute: { $sum: '$rollupCounts.muteCount' },
        totalBlock: { $sum: '$rollupCounts.blockCount' },
        totalReport: { $sum: '$rollupCounts.reportCount' },
      },
    },
  ]);

  return {
    signalCounts,
    actionCounts,
    graph: graph[0] || {},
  };
}

async function main() {
  const options = parseOptions();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  console.log(`[${SCRIPT_ID}] connecting stores`);
  await sequelize.authenticate();
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 20_000,
    connectTimeoutMS: 10_000,
    maxPoolSize: 4,
    minPoolSize: 0,
    maxIdleTimeMS: 10_000,
    bufferCommands: false,
  });

  console.log(`[${SCRIPT_ID}] loading current demo data`);
  const viewer = await loadViewer(options.user);
  const [users, posts] = await Promise.all([
    loadCandidateUsers(viewer.id, options.limit),
    loadCandidatePosts(viewer.id, options.limit),
  ]);
  if (users.length < 4) {
    throw new Error(`Not enough candidate users for ${viewer.username}: ${users.length}`);
  }
  if (posts.length < 6) {
    throw new Error(`Not enough candidate posts for ${viewer.username}: ${posts.length}`);
  }

  const { signals, actions } = buildRecords(viewer, users, posts, options.limit);
  console.log(`[${SCRIPT_ID}] built records signals=${signals.length} actions=${actions.length}`);
  const plan = {
    viewer,
    dryRun: options.dryRun,
    signals: signals.map((signal) => ({
      signalType: signal.signalType,
      targetType: signal.targetType,
      targetId: signal.targetId,
      targetAuthorId: signal.targetAuthorId,
      negativeWeight: signal.metadata.negativeWeight,
    })),
    actions: actions.map((action) => ({
      action: action.action,
      targetPostId: action.targetPostId ? String(action.targetPostId) : undefined,
      targetAuthorId: action.targetAuthorId,
    })),
  };

  if (options.dryRun) {
    console.log(JSON.stringify({ plan }, null, 2));
    return;
  }

  const deleted = await clearPreviousRun(viewer.id);
  await ensureStateForNegativeSignals(viewer.id, signals);
  if (signals.length > 0) await UserSignal.insertMany(signals);
  if (actions.length > 0) await UserAction.insertMany(actions);

  for (const signal of signals) {
    const targetUserId = signal.targetAuthorId || (signal.targetType === TargetType.USER ? signal.targetId : undefined);
    if (!targetUserId) continue;
    await upsertNegativeGraphEdge(viewer.id, targetUserId, signal.signalType, signal.timestamp);
  }

  const after = await summarize(viewer.id);
  console.log(JSON.stringify({
    ok: true,
    viewer,
    deletedPreviousRun: deleted,
    inserted: {
      signals: signals.length,
      actions: actions.length,
    },
    after,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await sequelize.close();
  });
