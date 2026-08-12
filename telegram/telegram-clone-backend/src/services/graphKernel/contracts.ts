export interface GraphKernelSignalCounts {
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
}

export interface GraphKernelSnapshotEdge {
  sourceUserId: string;
  targetUserId: string;
  decayedSum: number;
  interactionProbability: number;
  dailySignalCounts: GraphKernelSignalCounts;
  rollupSignalCounts: GraphKernelSignalCounts;
  edgeKinds: string[];
  lastInteractionAtMs?: number;
  updatedAtMs?: number;
}

export interface GraphKernelSnapshotPage {
  edges: GraphKernelSnapshotEdge[];
  offset: number;
  limit: number;
  nextOffset: number | null;
  nextCursor?: GraphKernelSnapshotCursor | null;
  done: boolean;
  snapshotVersion: string;
}

export interface GraphKernelSnapshotCursor {
  afterSourceUserId: string;
  afterTargetUserId: string;
  afterId: string;
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
  engagementScore?: number;
  recentnessScore?: number;
  relationKinds?: string[];
}

export interface GraphKernelOverlapCandidate {
  userId: string;
  combinedScore: number;
  userAScore: number;
  userBScore: number;
}

export interface GraphKernelBridgeCandidate {
  userId: string;
  score: number;
  depth: number;
  pathCount: number;
  viaUserIds: string[];
  bridgeStrength?: number;
  viaUserCount?: number;
}

export interface GraphKernelDiagnostics {
  kernel?: string;
  queryDurationMs?: number;
  candidateCount?: number;
  requestedLimit?: number;
  availableCount?: number;
  truncatedCount?: number;
  scannedCount?: number;
  visitedCount?: number;
  snapshotVersion?: string;
  snapshotLoadedAtMs?: number;
  prunedCount?: number;
  frontierMaxSize?: number;
  budgetExhausted?: boolean;
  empty?: boolean;
  emptyReason?: string | null;
  relationKinds?: string[];
}

export interface GraphKernelCandidateResponse<TCandidate> {
  candidates: TCandidate[];
  diagnostics?: GraphKernelDiagnostics;
}

export interface GraphKernelBatchQueryDiagnostics {
  kernel: string;
  queryDurationMs: number;
  candidateCount: number;
  requestedLimit: number;
  availableCount: number;
  truncatedCount: number;
  scannedCount: number;
  visitedCount: number;
  snapshotVersion: string;
  snapshotLoadedAtMs: number;
  prunedCount: number;
  frontierMaxSize: number;
  budgetExhausted: boolean;
  empty: boolean;
  emptyReason: string | null;
  relationKinds: string[];
}

export interface GraphKernelBatchQueryResult<TCandidate> {
  candidates: TCandidate[];
  diagnostics: GraphKernelBatchQueryDiagnostics;
}

export interface GraphKernelBatchResponse {
  userId: string;
  snapshotVersion: string;
  snapshotLoadedAtMs: number;
  socialNeighbors: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>;
  recentEngagers: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>;
  bridgeUsers: GraphKernelBatchQueryResult<GraphKernelBridgeCandidate>;
  coEngagers: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>;
  contentAffinityNeighbors: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>;
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
