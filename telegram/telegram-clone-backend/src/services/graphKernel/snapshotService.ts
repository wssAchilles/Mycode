import RealGraphEdge from '../../models/RealGraphEdge';
import { Types } from 'mongoose';
import type {
  GraphKernelSignalCounts,
  GraphKernelSnapshotCursor,
  GraphKernelSnapshotEdge,
  GraphKernelSnapshotPage,
} from './contracts';

export interface GraphKernelSnapshotRequest {
  offset?: number;
  limit?: number;
  minScore?: number;
  afterSourceUserId?: string;
  afterTargetUserId?: string;
  afterId?: string;
  snapshotVersion?: string;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

export class GraphKernelSnapshotVersionMismatchError extends Error {
  constructor(
    readonly expectedSnapshotVersion: string,
    readonly actualSnapshotVersion: string,
  ) {
    super('graph kernel snapshot version mismatch');
  }
}

const EMPTY_SIGNAL_COUNTS: GraphKernelSignalCounts = {
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
};

function normalizeSignalCounts(value: unknown): GraphKernelSignalCounts {
  const source = (value || {}) as Partial<GraphKernelSignalCounts>;
  return {
    followCount: Number(source.followCount ?? 0),
    likeCount: Number(source.likeCount ?? 0),
    replyCount: Number(source.replyCount ?? 0),
    retweetCount: Number(source.retweetCount ?? 0),
    quoteCount: Number(source.quoteCount ?? 0),
    mentionCount: Number(source.mentionCount ?? 0),
    profileViewCount: Number(source.profileViewCount ?? 0),
    tweetClickCount: Number(source.tweetClickCount ?? 0),
    dwellTimeMs: Number(source.dwellTimeMs ?? 0),
    addressBookCount: Number(source.addressBookCount ?? 0),
    directMessageCount: Number(source.directMessageCount ?? 0),
    coEngagementCount: Number(source.coEngagementCount ?? 0),
    contentAffinityCount: Number(source.contentAffinityCount ?? 0),
    muteCount: Number(source.muteCount ?? 0),
    blockCount: Number(source.blockCount ?? 0),
    reportCount: Number(source.reportCount ?? 0),
  };
}

function deriveEdgeKinds(
  rollup: GraphKernelSignalCounts,
  daily: GraphKernelSignalCounts,
): string[] {
  const kinds = new Set<string>();
  if (rollup.followCount > 0 || rollup.addressBookCount > 0) {
    kinds.add('follow');
  }
  if (rollup.addressBookCount > 0 || rollup.directMessageCount > 0) {
    kinds.add('chat_dm');
  }
  if (rollup.replyCount > 0 || rollup.mentionCount > 0) {
    kinds.add('reply_mention');
  }
  if (rollup.retweetCount > 0 || rollup.quoteCount > 0) {
    kinds.add('repost');
  }
  if (rollup.likeCount > 0) {
    kinds.add('like');
  }
  if (
    daily.likeCount > 0 ||
    daily.replyCount > 0 ||
    daily.retweetCount > 0 ||
    daily.quoteCount > 0 ||
    daily.mentionCount > 0 ||
    daily.directMessageCount > 0 ||
    daily.coEngagementCount > 0
  ) {
    kinds.add('recent_engagement');
  }
  if (
    rollup.coEngagementCount > 0 ||
    rollup.replyCount + rollup.likeCount + rollup.retweetCount + rollup.quoteCount >= 3
  ) {
    kinds.add('co_engagement');
  }
  if (
    rollup.contentAffinityCount > 0 ||
    rollup.profileViewCount > 0 ||
    rollup.tweetClickCount > 0 ||
    rollup.dwellTimeMs > 0
  ) {
    kinds.add('content_affinity');
  }
  return Array.from(kinds).sort();
}

function normalizeSnapshotVersion(
  latestEdge: { _id?: unknown; updatedAt?: Date } | null,
  totalEdgeCount: number,
): string {
  return latestEdge?.updatedAt
    ? `graph_snapshot_v2:${new Date(latestEdge.updatedAt).getTime()}:${String(latestEdge._id || 'unknown')}:${totalEdgeCount}`
    : 'graph_snapshot_v2:empty';
}

function readCursor(request: GraphKernelSnapshotRequest): GraphKernelSnapshotCursor | null {
  const afterSourceUserId = String(request.afterSourceUserId || '').trim();
  const afterTargetUserId = String(request.afterTargetUserId || '').trim();
  const afterId = String(request.afterId || '').trim();
  const hasPartialCursor = Boolean(afterSourceUserId || afterTargetUserId || afterId);

  if (!hasPartialCursor) {
    return null;
  }
  if (!afterSourceUserId || !afterTargetUserId || !afterId || !Types.ObjectId.isValid(afterId)) {
    throw new Error('invalid_graph_snapshot_cursor');
  }

  return {
    afterSourceUserId,
    afterTargetUserId,
    afterId,
  };
}

class GraphKernelSnapshotService {
  async getSnapshotPage(request: GraphKernelSnapshotRequest = {}): Promise<GraphKernelSnapshotPage> {
    const offset = Math.max(0, Number.parseInt(String(request.offset ?? 0), 10) || 0);
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number.parseInt(String(request.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    );
    const minScore = Number.isFinite(request.minScore) ? Number(request.minScore) : 0.05;
    const cursor = readCursor(request);

    const filter = {
      decayedSum: { $gte: minScore },
    } as {
      decayedSum: { $gte: number };
      $or?: Array<Record<string, unknown>>;
    };

    if (cursor) {
      filter.$or = [
        { sourceUserId: { $gt: cursor.afterSourceUserId } },
        {
          sourceUserId: cursor.afterSourceUserId,
          targetUserId: { $gt: cursor.afterTargetUserId },
        },
        {
          sourceUserId: cursor.afterSourceUserId,
          targetUserId: cursor.afterTargetUserId,
          _id: { $gt: new Types.ObjectId(cursor.afterId) },
        },
      ];
    }

    const versionFilter = { decayedSum: { $gte: minScore } };
    const [latestEdge, totalEdgeCount] = await Promise.all([
      RealGraphEdge.findOne(versionFilter)
        .select({ _id: 1, updatedAt: 1 })
        .sort({ updatedAt: -1, _id: -1 })
        .lean(),
      RealGraphEdge.countDocuments(versionFilter),
    ]);
    const snapshotVersion = normalizeSnapshotVersion(latestEdge, totalEdgeCount);
    const requestedSnapshotVersion = String(request.snapshotVersion || '').trim();
    if (requestedSnapshotVersion && requestedSnapshotVersion !== snapshotVersion) {
      throw new GraphKernelSnapshotVersionMismatchError(requestedSnapshotVersion, snapshotVersion);
    }

    const query = RealGraphEdge.find(filter)
      .select({
        _id: 1,
        sourceUserId: 1,
        targetUserId: 1,
        decayedSum: 1,
        interactionProbability: 1,
        dailyCounts: 1,
        rollupCounts: 1,
        lastInteractionAt: 1,
        updatedAt: 1,
      })
      .sort({ sourceUserId: 1, targetUserId: 1, _id: 1 })
      .limit(limit);
    if (!cursor && offset > 0) {
      query.skip(offset);
    }
    const edges = await query.lean();

    const typedEdges = edges as unknown as Array<{
      _id: Types.ObjectId;
      sourceUserId: string;
      targetUserId: string;
      decayedSum?: number;
      interactionProbability?: number;
      dailyCounts?: Partial<GraphKernelSignalCounts>;
      rollupCounts?: Partial<GraphKernelSignalCounts>;
      lastInteractionAt?: Date;
      updatedAt?: Date;
    }>;

    const normalized: GraphKernelSnapshotEdge[] = typedEdges.map((edge) => {
      const dailySignalCounts = normalizeSignalCounts(edge.dailyCounts ?? EMPTY_SIGNAL_COUNTS);
      const rollupSignalCounts = normalizeSignalCounts(edge.rollupCounts ?? EMPTY_SIGNAL_COUNTS);
      return {
        sourceUserId: String(edge.sourceUserId),
        targetUserId: String(edge.targetUserId),
        decayedSum: Number(edge.decayedSum ?? 0),
        interactionProbability: Number(edge.interactionProbability ?? 0),
        dailySignalCounts,
        rollupSignalCounts,
        edgeKinds: deriveEdgeKinds(rollupSignalCounts, dailySignalCounts),
        lastInteractionAtMs: edge.lastInteractionAt?.getTime(),
        updatedAtMs: edge.updatedAt?.getTime(),
      };
    });
    const lastEdge = typedEdges[typedEdges.length - 1];
    const nextCursor = normalized.length < limit || !lastEdge
      ? null
      : {
          afterSourceUserId: String(lastEdge.sourceUserId),
          afterTargetUserId: String(lastEdge.targetUserId),
          afterId: String(lastEdge._id),
        };

    return {
      edges: normalized,
      offset,
      limit,
      nextOffset: normalized.length < limit ? null : offset + normalized.length,
      nextCursor,
      done: normalized.length < limit,
      snapshotVersion,
    };
  }
}

export const graphKernelSnapshotService = new GraphKernelSnapshotService();
