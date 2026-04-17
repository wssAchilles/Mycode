import RealGraphEdge from '../../models/RealGraphEdge';
import type { GraphKernelSnapshotEdge, GraphKernelSnapshotPage } from './contracts';

export interface GraphKernelSnapshotRequest {
  offset?: number;
  limit?: number;
  minScore?: number;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

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
      lastInteractionAt?: Date;
      updatedAt?: Date;
    }>;

    const normalized: GraphKernelSnapshotEdge[] = edges.map((edge) => ({
      sourceUserId: String(edge.sourceUserId),
      targetUserId: String(edge.targetUserId),
      decayedSum: Number(edge.decayedSum ?? 0),
      interactionProbability: Number(edge.interactionProbability ?? 0),
      lastInteractionAt: edge.lastInteractionAt?.toISOString(),
      updatedAt: edge.updatedAt?.toISOString(),
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
