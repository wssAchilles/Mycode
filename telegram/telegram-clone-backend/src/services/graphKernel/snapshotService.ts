import RealGraphEdge from '../../models/RealGraphEdge';
import type {
  GraphKernelSignalCounts,
  GraphKernelSnapshotEdge,
  GraphKernelSnapshotPage,
} from './contracts';

export interface GraphKernelSnapshotRequest {
  offset?: number;
  limit?: number;
  minScore?: number;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

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
    muteCount: Number(source.muteCount ?? 0),
    blockCount: Number(source.blockCount ?? 0),
    reportCount: Number(source.reportCount ?? 0),
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

    const edges = (await RealGraphEdge.find({
      decayedSum: { $gte: minScore },
    })
      .select({
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
      .skip(offset)
      .limit(limit)
      .lean()) as Array<{
      sourceUserId: string;
      targetUserId: string;
      decayedSum?: number;
      interactionProbability?: number;
      dailyCounts?: Partial<GraphKernelSignalCounts>;
      rollupCounts?: Partial<GraphKernelSignalCounts>;
      lastInteractionAt?: Date;
      updatedAt?: Date;
    }>;

    const normalized: GraphKernelSnapshotEdge[] = edges.map((edge) => ({
      sourceUserId: String(edge.sourceUserId),
      targetUserId: String(edge.targetUserId),
      decayedSum: Number(edge.decayedSum ?? 0),
      interactionProbability: Number(edge.interactionProbability ?? 0),
      dailySignalCounts: normalizeSignalCounts(edge.dailyCounts ?? EMPTY_SIGNAL_COUNTS),
      rollupSignalCounts: normalizeSignalCounts(edge.rollupCounts ?? EMPTY_SIGNAL_COUNTS),
      lastInteractionAtMs: edge.lastInteractionAt?.getTime(),
      updatedAtMs: edge.updatedAt?.getTime(),
    }));

    return {
      edges: normalized,
      offset,
      limit,
      nextOffset: normalized.length < limit ? null : offset + normalized.length,
      done: normalized.length < limit,
    };
  }
}

export const graphKernelSnapshotService = new GraphKernelSnapshotService();
