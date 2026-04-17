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
  done: boolean;
  snapshotVersion: string;
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
