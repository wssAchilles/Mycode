import fs from 'node:fs/promises';
import path from 'node:path';

import mongoose, { Schema } from 'mongoose';
import { Op } from 'sequelize';

import Comment from '../../models/Comment';
import Contact from '../../models/Contact';
import Group from '../../models/Group';
import GroupMember from '../../models/GroupMember';
import Like from '../../models/Like';
import Message from '../../models/Message';
import Post from '../../models/Post';
import RealGraphEdge from '../../models/RealGraphEdge';
import Repost from '../../models/Repost';
import SpaceProfile from '../../models/SpaceProfile';
import User from '../../models/User';
import UserAction from '../../models/UserAction';
import UserFeatureVector from '../../models/UserFeatureVector';
import UserSettings from '../../models/UserSettings';
import GroupState from '../../models/GroupState';
import ChatCounter from '../../models/ChatCounter';
import ChatMemberState from '../../models/ChatMemberState';
import UpdateCounter from '../../models/UpdateCounter';
import UpdateLog from '../../models/UpdateLog';
import ChatDeliveryOutbox from '../../models/ChatDeliveryOutbox';
import ClusterDefinition from '../../models/ClusterDefinition';
import UserSignal from '../../models/UserSignal';
import SpaceUpload from '../../models/SpaceUpload';
import { redis } from '../../config/redis';
import { getGroupChatId } from '../../services/messageWriteService';
import {
  buildAudienceUsername,
  buildAuthorUsername,
  buildBridgeUsername,
  DEMO_CLUSTER_IDS,
  DEMO_CLUSTER_ORDER,
  DEMO_GROUP_BLUEPRINTS,
  DEMO_TOTAL_AUDIENCE_COUNT,
  DEMO_VIEWER_USERNAME,
} from './config';

export interface ExistingDemoState {
  demoUsers: Array<{ id: string; username: string }>;
  demoUserIds: string[];
  demoGroups: Array<{ id: string; name: string }>;
  demoGroupIds: string[];
  demoGroupChatIds: string[];
  demoPostIds: string[];
}

const DEMO_GROUP_NAMES = DEMO_GROUP_BLUEPRINTS.map((group) => group.name);
const DEMO_UPLOAD_FILE_RE = /^demo-(avatar|group)-/;
const DEMO_COHORT_MANIFEST_ID = 'interview_demo_v1';
const EXPECTED_DEMO_USERNAMES = [
  DEMO_VIEWER_USERNAME,
  ...DEMO_CLUSTER_ORDER.flatMap((cluster) =>
    Array.from({ length: 8 }, (_, index) => buildAuthorUsername(cluster, index)),
  ),
  ...Array.from({ length: 24 }, (_, index) => buildBridgeUsername(index)),
  ...Array.from({ length: DEMO_TOTAL_AUDIENCE_COUNT }, (_, index) => buildAudienceUsername(index)),
];

type DemoCohortManifestDocument = {
  _id: string;
  userIds: string[];
  groupIds: string[];
  updatedAt: Date;
};

const DemoCohortManifestSchema = new Schema<DemoCohortManifestDocument>(
  {
    _id: { type: String, required: true },
    userIds: { type: [String], default: [] },
    groupIds: { type: [String], default: [] },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
  },
);

const DemoCohortManifest =
  (mongoose.models.DemoCohortManifest as mongoose.Model<DemoCohortManifestDocument>) ||
  mongoose.model<DemoCohortManifestDocument>('DemoCohortManifest', DemoCohortManifestSchema);

const deleteDemoUploadFiles = async (): Promise<void> => {
  const candidateDirs = [
    path.resolve(__dirname, '../../../uploads/space'),
    path.resolve(__dirname, '../../../uploads/space/thumbnails'),
  ];

  for (const dir of candidateDirs) {
    try {
      const files = await fs.readdir(dir);
      await Promise.all(
        files
          .filter((file) => DEMO_UPLOAD_FILE_RE.test(file))
          .map((file) => fs.rm(path.join(dir, file), { force: true })),
      );
    } catch {
      // best effort
    }
  }
};

export const collectExistingDemoState = async (): Promise<ExistingDemoState> => {
  const manifest = await DemoCohortManifest.findById(DEMO_COHORT_MANIFEST_ID).lean();
  const demoUsers = (await User.findAll({
    where: {
      ...(manifest?.userIds?.length
        ? { id: { [Op.in]: manifest.userIds } }
        : { username: { [Op.in]: EXPECTED_DEMO_USERNAMES } }),
    },
    attributes: ['id', 'username'],
    raw: true,
  })) as Array<{ id: string; username: string }>;

  const demoUserIds = demoUsers.map((user) => user.id);

  const demoGroups = (await Group.findAll({
    where: {
      ...(manifest?.groupIds?.length
        ? { id: { [Op.in]: manifest.groupIds } }
        : {
            [Op.or]: [
              ...(demoUserIds.length > 0 ? [{ ownerId: { [Op.in]: demoUserIds } }] : []),
              ...DEMO_GROUP_BLUEPRINTS.map((group) => ({
                name: group.name,
                description: group.description,
                maxMembers: group.maxMembers,
              })),
            ],
          }),
    },
    attributes: ['id', 'name'],
    raw: true,
  })) as Array<{ id: string; name: string }>;

  const demoGroupIds = demoGroups.map((group) => group.id);
  const demoGroupChatIds = demoGroupIds.map((groupId) => getGroupChatId(groupId));

  const demoPostDocs = await Post.find({
    authorId: { $in: demoUserIds },
  }).select('_id');

  return {
    demoUsers,
    demoUserIds,
    demoGroups,
    demoGroupIds,
    demoGroupChatIds,
    demoPostIds: demoPostDocs.map((post) => String(post._id)),
  };
};

export const persistDemoCohortManifest = async (input: {
  demoUserIds: string[];
  demoGroupIds: string[];
}): Promise<void> => {
  await DemoCohortManifest.findByIdAndUpdate(
    DEMO_COHORT_MANIFEST_ID,
    {
      $set: {
        userIds: input.demoUserIds,
        groupIds: input.demoGroupIds,
      },
    },
    { upsert: true, new: true },
  );
};

export const cleanupDemoCohort = async (state?: ExistingDemoState): Promise<ExistingDemoState> => {
  const currentState = state ?? (await collectExistingDemoState());
  const { demoUserIds, demoGroupIds, demoGroupChatIds, demoPostIds } = currentState;

  if (demoUserIds.length > 0) {
    await Promise.all([
      Contact.destroy({
        where: {
          [Op.or]: [
            { userId: { [Op.in]: demoUserIds } },
            { contactId: { [Op.in]: demoUserIds } },
          ],
        },
      }),
      GroupMember.destroy({
        where: {
          [Op.or]: [
            { userId: { [Op.in]: demoUserIds } },
            ...(demoGroupIds.length > 0 ? [{ groupId: { [Op.in]: demoGroupIds } }] : []),
          ],
        },
      }),
      Group.destroy({
        where: {
          id: { [Op.in]: demoGroupIds },
        },
      }),
      User.destroy({
        where: {
          id: { [Op.in]: demoUserIds },
        },
      }),
    ]);
  } else if (demoGroupIds.length > 0) {
    await Promise.all([
      GroupMember.destroy({ where: { groupId: { [Op.in]: demoGroupIds } } }),
      Group.destroy({ where: { id: { [Op.in]: demoGroupIds } } }),
    ]);
  }

  if (demoPostIds.length > 0) {
    await Promise.all([
      Comment.deleteMany({
        $or: [
          { userId: { $in: demoUserIds } },
          { postId: { $in: demoPostIds } },
        ],
      }),
      Like.deleteMany({
        $or: [
          { userId: { $in: demoUserIds } },
          { postId: { $in: demoPostIds } },
          { authorId: { $in: demoUserIds } },
        ],
      }),
      Repost.deleteMany({
        $or: [
          { userId: { $in: demoUserIds } },
          { postId: { $in: demoPostIds } },
          { quotePostId: { $in: demoPostIds } },
        ],
      }),
      Post.deleteMany({
        _id: { $in: demoPostIds },
      }),
    ]);
  }

  await Promise.all([
    UserAction.deleteMany({
      $or: [
        { userId: { $in: demoUserIds } },
        { targetAuthorId: { $in: demoUserIds } },
        ...(demoPostIds.length > 0 ? [{ targetPostId: { $in: demoPostIds } }] : []),
      ],
    }),
    RealGraphEdge.deleteMany({
      $or: [
        { sourceUserId: { $in: demoUserIds } },
        { targetUserId: { $in: demoUserIds } },
      ],
    }),
    UserFeatureVector.deleteMany({ userId: { $in: demoUserIds } }),
    UserSettings.deleteMany({ userId: { $in: demoUserIds } }),
    UserSignal.deleteMany({ userId: { $in: demoUserIds } }),
    SpaceProfile.deleteMany({ userId: { $in: demoUserIds } }),
    ClusterDefinition.deleteMany({ clusterId: { $in: DEMO_CLUSTER_IDS } }),
    SpaceUpload.deleteMany({ filename: /^demo-(avatar|group)-/ }),
  ]);

  await Promise.all([
    Message.deleteMany({
      $or: [
        { sender: { $in: demoUserIds } },
        { receiver: { $in: demoGroupIds } },
        { groupId: { $in: demoGroupIds } },
      ],
    }),
    ChatCounter.deleteMany({ _id: { $in: demoGroupChatIds } }),
    ChatMemberState.deleteMany({
      $or: [
        { userId: { $in: demoUserIds } },
        { chatId: { $in: demoGroupChatIds } },
      ],
    }),
    GroupState.deleteMany({ _id: { $in: demoGroupIds } }),
    UpdateCounter.deleteMany({ _id: { $in: demoUserIds } }),
    UpdateLog.deleteMany({
      $or: [
        { userId: { $in: demoUserIds } },
        { chatId: { $in: demoGroupChatIds } },
      ],
    }),
    ChatDeliveryOutbox.deleteMany({
      $or: [
        { senderId: { $in: demoUserIds } },
        { chatId: { $in: demoGroupChatIds } },
      ],
    }),
  ]);

  await deleteDemoUploadFiles();
  await DemoCohortManifest.deleteOne({ _id: DEMO_COHORT_MANIFEST_ID });

  if ((redis as any).status === 'ready') {
    const pipeline = redis.pipeline();
    for (const userId of demoUserIds) {
      pipeline.del(`refresh_token:${userId}`);
      pipeline.del(`tl:author:${userId}`);
    }
    await pipeline.exec();
  }

  return currentState;
};

export const loadPreparedDemoGroups = async (): Promise<Array<{
  id: string;
  name: string;
  ownerId: string;
  memberCount: number;
}>> => {
  return (await Group.findAll({
    where: { name: { [Op.in]: DEMO_GROUP_NAMES } },
    attributes: ['id', 'name', 'ownerId', 'memberCount'],
    order: [['name', 'ASC']],
    raw: true,
  })) as Array<{ id: string; name: string; ownerId: string; memberCount: number }>;
};

export const loadGroupMemberIds = async (groupId: string): Promise<string[]> => {
  const members = await GroupMember.findAll({
    where: { groupId, isActive: true },
    attributes: ['userId'],
    raw: true,
  });
  return members.map((member: any) => member.userId);
};
