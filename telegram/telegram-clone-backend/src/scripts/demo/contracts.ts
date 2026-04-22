export type DemoClusterKey = 'ai' | 'recsys' | 'rust' | 'go' | 'frontend' | 'growth';

export type DemoUserRole = 'viewer' | 'author' | 'bridge' | 'audience';

export interface DemoClusterConfig {
  key: DemoClusterKey;
  clusterId: number;
  label: string;
  usernameStem: string;
  keywords: string[];
  adjacentClusters: DemoClusterKey[];
  authorDisplayNames: string[];
  bioFragments: string[];
  contentHooks: string[];
  contentAngles: string[];
  contentOutcomes: string[];
}

export interface DemoUserSeed {
  id: string;
  username: string;
  displayName: string;
  role: DemoUserRole;
  passwordHash: string;
  avatarUrl: string;
  cluster?: DemoClusterKey;
  secondaryClusters: DemoClusterKey[];
  bio: string;
  location: string;
  website: string;
  isOnline: boolean;
  lastSeen: Date;
}

export interface DemoGroupBlueprint {
  slug: 'perf_arena' | 'recsys_lab' | 'product_review';
  name: string;
  description: string;
  ownerCluster: DemoClusterKey;
  maxMembers: number;
  targetMemberCount: number;
  historyMessages: number;
  liveWeight: number;
  keywords: string[];
}

export interface DemoGroupSeed extends DemoGroupBlueprint {
  id: string;
  ownerId: string;
  ownerUsername: string;
  avatarUrl: string;
  memberIds: string[];
}

export interface FrontendTargetInfo {
  file: string;
  apiBaseUrl: string | null;
  socketUrl: string | null;
}
