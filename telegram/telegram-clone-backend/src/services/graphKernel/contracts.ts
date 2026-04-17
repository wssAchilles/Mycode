export interface GraphKernelSnapshotEdge {
  sourceUserId: string;
  targetUserId: string;
  decayedSum: number;
  interactionProbability: number;
  lastInteractionAt?: string;
  updatedAt?: string;
}

export interface GraphKernelSnapshotPage {
  edges: GraphKernelSnapshotEdge[];
  offset: number;
  limit: number;
  nextOffset: number | null;
  done: boolean;
}

export interface GraphKernelAuthorCandidate {
  userId: string;
  score: number;
  depth: number;
  pathCount: number;
  viaUserIds: string[];
}

export interface GraphKernelNeighborCandidate {
  userId: string;
  score: number;
  interactionProbability?: number;
}

export interface GraphKernelOverlapCandidate {
  userId: string;
  combinedScore: number;
  userAScore: number;
  userBScore: number;
}

export interface GraphKernelOpsSnapshot {
  available: boolean;
  url: string;
  summary?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  requests?: Record<string, unknown>;
  refresh?: Record<string, unknown>;
  error?: string;
}
