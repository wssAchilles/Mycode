import type { DemoClusterConfig, DemoClusterKey, DemoGroupBlueprint } from './contracts';

export const DEMO_VIEWER_USERNAME = 'demo_interviewer';
export const DEMO_DEFAULT_PASSWORD = 'DemoPass2026!';
export const DEMO_AVATAR_POOL_SIZE = 72;
export const DEMO_VIEWER_FOLLOW_STRONG_INDEXES = [0, 1, 2];
export const DEMO_VIEWER_FOLLOW_WEAK_INDEXES = [3];
export const DEMO_RECENT_WINDOW_DAYS = 14;
export const DEMO_AUTHOR_POST_COUNT = 4;
export const DEMO_BRIDGE_WITH_POST_COUNT = 14;
export const DEMO_BRIDGE_POST_COUNT = 2;
export const DEMO_LIVE_DEFAULT_DURATION_SEC = 240;
export const DEMO_LIVE_DEFAULT_MESSAGES_PER_MINUTE = 120;
export const DEMO_USERNAME_PREFIX = 'demo_';
export const DEMO_CLUSTER_IDS = [9101, 9102, 9103, 9104, 9105, 9106];
export const DEMO_VISIBLE_USER_COUNT = 1 + 48 + 24;
export const DEMO_TOTAL_AUDIENCE_COUNT = 560;

export const DEMO_CLUSTER_ORDER: DemoClusterKey[] = [
  'ai',
  'recsys',
  'rust',
  'go',
  'frontend',
  'growth',
];

export const DEMO_CLUSTER_CONFIGS: Record<DemoClusterKey, DemoClusterConfig> = {
  ai: {
    key: 'ai',
    clusterId: 9101,
    label: 'AI Systems',
    usernameStem: 'ai',
    keywords: ['ai', 'agents', 'evals', 'tooling', 'multimodal', 'inference'],
    adjacentClusters: ['recsys', 'go'],
    authorDisplayNames: [
      'Mina Vector',
      'Theo Agent',
      'Iris Prompt',
      'Nolan Runtime',
      'Ada Signals',
      'Soren Bench',
      'Jade Vision',
      'Kian Memory',
    ],
    bioFragments: [
      'builds evaluation-heavy AI product loops',
      'focuses on production agent reliability',
      'turns model latency into observable product wins',
    ],
    contentHooks: [
      'Shipped an agent loop update today',
      'A simple AI product win from this week',
      'One thing that made our model UX feel faster',
    ],
    contentAngles: [
      'tool-call retry policy',
      'prompt routing for cold-start users',
      'multimodal moderation before fanout',
      'latency budgeting across model + cache',
    ],
    contentOutcomes: [
      'CTR climbed without making the feed noisier',
      'first-response latency stayed under the demo target',
      'fewer bad candidates leaked into the homepage',
    ],
  },
  recsys: {
    key: 'recsys',
    clusterId: 9102,
    label: 'Recommendation Systems',
    usernameStem: 'recsys',
    keywords: ['recsys', 'ranking', 'features', 'retrieval', 'graph', 'embedding'],
    adjacentClusters: ['ai', 'growth'],
    authorDisplayNames: [
      'Lena Mixer',
      'Arun Recall',
      'Maya Cluster',
      'Evan Signals',
      'Rhea Vector',
      'Cole Ranking',
      'Nina Graph',
      'Leo Phoenix',
    ],
    bioFragments: [
      'works on retrieval, ranking, and serving budgets',
      'likes sparse features more than vague magic',
      'cares about feed quality under tiny user graphs',
    ],
    contentHooks: [
      'A recommendation detail worth stealing',
      'The ranking pipeline looked better after one boring fix',
      'Sparse graphs still need a strong retrieval story',
    ],
    contentAngles: [
      'author-affinity weighting',
      'graph edge smoothing for low-activity users',
      'feature vector freshness windows',
      'in-network timeline backfill strategy',
    ],
    contentOutcomes: [
      'recall quality improved before any heavy model changes',
      'cold-start users got a noticeably less generic feed',
      'the reason badges finally matched the actual retrieval lane',
    ],
  },
  rust: {
    key: 'rust',
    clusterId: 9103,
    label: 'Rust Performance',
    usernameStem: 'rust',
    keywords: ['rust', 'latency', 'throughput', 'memory', 'tokio', 'perf'],
    adjacentClusters: ['go', 'ai'],
    authorDisplayNames: [
      'Vera Tokio',
      'Jonas ZeroCopy',
      'Milo Arena',
      'Tara Throughput',
      'Owen Borrow',
      'Cora Bench',
      'Nate Reactor',
      'Elia Packets',
    ],
    bioFragments: [
      'chases predictable tail latency in Rust services',
      'keeps hot paths boring and measurable',
      'treats memory pressure as a product problem',
    ],
    contentHooks: [
      'A Rust throughput note from the message path',
      'Today we removed one unnecessary copy in the hot path',
      'The fastest optimization was deleting contention',
    ],
    contentAngles: [
      'seq allocation under bursty group traffic',
      'zero-copy payload handoff',
      'bounded queue backpressure',
      'cache-aware batch projection',
    ],
    contentOutcomes: [
      'p95 stayed flat while burst traffic doubled',
      'message fanout stopped amplifying lock contention',
      'the large-group path kept refreshes feeling instant',
    ],
  },
  go: {
    key: 'go',
    clusterId: 9104,
    label: 'Go Delivery',
    usernameStem: 'go',
    keywords: ['go', 'delivery', 'fanout', 'worker', 'queue', 'ops'],
    adjacentClusters: ['rust', 'frontend'],
    authorDisplayNames: [
      'Ivy Dispatch',
      'Parker Queue',
      'Noah Fanout',
      'Ari Canary',
      'Skye Outbox',
      'Mason Worker',
      'Luca Replay',
      'Dina Rollout',
    ],
    bioFragments: [
      'operates queue-heavy delivery paths in Go',
      'prefers explicit rollout states over hope',
      'keeps delivery bookkeeping visible and recoverable',
    ],
    contentHooks: [
      'A delivery-plane improvement that paid off immediately',
      'One queueing choice that made rollback safer',
      'The outbox looked healthy after this change',
    ],
    contentAngles: [
      'chunk sizing for group fanout',
      'replay handling after stale outbox detection',
      'dispatch bookkeeping in mixed rollouts',
      'queue mode fallback semantics',
    ],
    contentOutcomes: [
      'operators got a cleaner story during burst traffic',
      'the delivery path stayed observable during fallback',
      'retries stopped feeling like silent data loss',
    ],
  },
  frontend: {
    key: 'frontend',
    clusterId: 9105,
    label: 'Frontend Reliability',
    usernameStem: 'frontend',
    keywords: ['frontend', 'react', 'worker', 'ux', 'socket', 'rendering'],
    adjacentClusters: ['go', 'growth'],
    authorDisplayNames: [
      'Nora Worker',
      'Eli Render',
      'Sia Realtime',
      'Ryan Motion',
      'Ava Cursor',
      'Hugo State',
      'Lila Virtual',
      'Kobe Layout',
    ],
    bioFragments: [
      'builds worker-first realtime interfaces',
      'cares about visible latency more than benchmark theater',
      'makes state transitions inspectable in the UI',
    ],
    contentHooks: [
      'A frontend reliability detail worth keeping',
      'Realtime UI felt smoother after one state fix',
      'A small rendering decision improved perceived speed',
    ],
    contentAngles: [
      'worker-first message store hydration',
      'socket reconnect recovery',
      'scroll stability during rapid inserts',
      'media URL normalization across spaces and chat',
    ],
    contentOutcomes: [
      'refreshes looked deterministic instead of lucky',
      'the chat timeline kept up during bursty fanout',
      'recommended content felt more intentional on reload',
    ],
  },
  growth: {
    key: 'growth',
    clusterId: 9106,
    label: 'Product Growth',
    usernameStem: 'growth',
    keywords: ['growth', 'activation', 'retention', 'experiments', 'product', 'ux'],
    adjacentClusters: ['recsys', 'frontend'],
    authorDisplayNames: [
      'Mira Cohort',
      'Ethan Activation',
      'Juno Insight',
      'Rene Product',
      'Veda Funnel',
      'Derek Review',
      'Pia Conversion',
      'Omar Ops',
    ],
    bioFragments: [
      'turns product instrumentation into sharper loops',
      'cares about the first ten minutes of user value',
      'ties engagement shifts back to concrete system behavior',
    ],
    contentHooks: [
      'A product signal that lined up with engineering reality',
      'One growth metric became more believable this week',
      'Activation improved after this systems-level change',
    ],
    contentAngles: [
      'feed relevance during first-session cold start',
      'group activity as a trust-building loop',
      'recommended-user ranking for sparse cohorts',
      'reason labels that explain why a post appeared',
    ],
    contentOutcomes: [
      'new users found the product story much faster',
      'the demo stopped looking like an empty shell',
      'engagement felt tied to relevance instead of noise',
    ],
  },
};

export const DEMO_GROUP_BLUEPRINTS: DemoGroupBlueprint[] = [
  {
    slug: 'perf_arena',
    name: 'Demo Rust & Go Perf Arena',
    description: 'High-volume systems chat focused on Rust hot paths, Go delivery, and realtime fanout behavior.',
    ownerCluster: 'rust',
    maxMembers: 1000,
    targetMemberCount: 560,
    historyMessages: 96,
    liveWeight: 0.68,
    keywords: ['rust', 'go', 'fanout', 'latency', 'throughput'],
  },
  {
    slug: 'recsys_lab',
    name: 'Demo Recsys Lab',
    description: 'A working room for retrieval, graph recall, feature vectors, and sparse-graph recommendation tactics.',
    ownerCluster: 'recsys',
    maxMembers: 240,
    targetMemberCount: 120,
    historyMessages: 36,
    liveWeight: 0.32,
    keywords: ['recsys', 'ranking', 'graph', 'features', 'feed'],
  },
  {
    slug: 'product_review',
    name: 'Demo Product Review',
    description: 'Cross-functional product review group covering UX, activation, realtime polish, and interview demo narrative.',
    ownerCluster: 'growth',
    maxMembers: 160,
    targetMemberCount: 80,
    historyMessages: 24,
    liveWeight: 0.12,
    keywords: ['product', 'growth', 'frontend', 'activation', 'review'],
  },
];

export const DEMO_GROUP_MESSAGE_THEMES: Record<DemoGroupBlueprint['slug'], string[]> = {
  perf_arena: [
    'Rust hot path stayed flat after another burst run.',
    'Go delivery chunks were clean through the latest replay drill.',
    'Large-group refresh still looks instant after the last seq bump.',
    'The new fanout slice removed one more source of lock pressure.',
    'Ops note: tail latency stayed steady while send rate spiked.',
  ],
  recsys_lab: [
    'The in-network timeline finally makes sparse cohorts look intentional.',
    'Graph recall is much clearer once bridge users have real actions.',
    'Feature vectors are now aligned with the actual content clusters.',
    'Reason badges feel honest when the retrieval lane is visible.',
    'Popular recall improved as soon as the recent activity gradient got sharper.',
  ],
  product_review: [
    'The demo story is stronger when the homepage explains itself.',
    'Recommended users should look active, not randomly new.',
    'The chat demo only works if refresh survives a full page reload.',
    'Synthetic demo data is useful only when every state path stays coherent.',
    'The product story lands faster when large groups already feel alive.',
  ],
};

export function buildAuthorUsername(cluster: DemoClusterKey, index: number): string {
  return `${DEMO_USERNAME_PREFIX}${DEMO_CLUSTER_CONFIGS[cluster].usernameStem}_author_${String(index + 1).padStart(2, '0')}`;
}

export function buildBridgeUsername(index: number): string {
  return `${DEMO_USERNAME_PREFIX}bridge_${String(index + 1).padStart(2, '0')}`;
}

export function buildAudienceUsername(index: number): string {
  return `${DEMO_USERNAME_PREFIX}audience_${String(index + 1).padStart(4, '0')}`;
}

export function buildClusterWebsite(username: string): string {
  return `https://demo.xuziqi.tech/${username}`;
}
