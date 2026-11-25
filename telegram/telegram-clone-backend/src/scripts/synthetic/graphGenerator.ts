import { v4 as uuidv4 } from 'uuid';

import {
  type CommunityKey,
  type DirectedFollowEdge,
  type ScaleProfile,
  SYNTH_USERNAME_PREFIX,
  type SyntheticUserRecord,
  type SyntheticUserTier,
} from './contracts';
import { SeededRng } from './prng';
import {
  COMMUNITY_CONFIGS,
  COMMUNITY_ORDER,
  EXTRA_USER_FIRST_NAMES,
  EXTRA_USER_LAST_NAMES,
} from './taxonomy';

const AVATAR_PORTRAIT_LIMIT = 70;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const DEMOGRAPHICS_POOL = [
  { region: 'CN', language: 'zh', birthYearMin: 1990, birthYearMax: 2001 },
  { region: 'US', language: 'en', birthYearMin: 1986, birthYearMax: 1999 },
  { region: 'SG', language: 'zh', birthYearMin: 1991, birthYearMax: 2000 },
  { region: 'JP', language: 'ja', birthYearMin: 1988, birthYearMax: 2000 },
  { region: 'UK', language: 'en', birthYearMin: 1987, birthYearMax: 1998 },
  { region: 'DE', language: 'de', birthYearMin: 1989, birthYearMax: 1999 },
];

export type ExistingRealUserSeedInput = {
  id: string;
  username: string;
  region?: string | null;
  language?: string | null;
  createdAt?: Date;
};

function buildAvatarUrl(rng: SeededRng, index: number): string {
  const gender = (index + rng.int(0, 1)) % 2 === 0 ? 'men' : 'women';
  const portraitId = (index % AVATAR_PORTRAIT_LIMIT) + 1;
  return `https://randomuser.me/api/portraits/${gender}/${portraitId}.jpg`;
}

function buildAffinityWeights(
  primary: CommunityKey,
  secondary: CommunityKey[],
  rng: SeededRng,
): Record<CommunityKey, number> {
  const weights = {} as Record<CommunityKey, number>;
  const adjacentSet = new Set(COMMUNITY_CONFIGS[primary].adjacentClusters);
  const secondarySet = new Set(secondary);

  let sum = 0;
  for (const key of COMMUNITY_ORDER) {
    let val = rng.float(0.01, 0.04);
    if (key === primary) {
      val = rng.float(0.46, 0.64);
    } else if (secondarySet.has(key)) {
      val = rng.float(0.16, 0.28);
    } else if (adjacentSet.has(key)) {
      val = rng.float(0.05, 0.12);
    }
    weights[key] = val;
    sum += val;
  }

  for (const key of COMMUNITY_ORDER) {
    weights[key] = Number((weights[key] / sum).toFixed(4));
  }
  return weights;
}

/**
 * 生成分层的合成用户人群（KOL / Bridge / Creator / Reader）
 */
export function generateSyntheticUsers(
  profile: ScaleProfile,
  rng: SeededRng,
): SyntheticUserRecord[] {
  const users: SyntheticUserRecord[] = [];
  const tierPlan: Array<{ tier: SyntheticUserTier; count: number }> = [
    { tier: 'kol', count: profile.kolCount },
    { tier: 'bridge', count: profile.bridgeCount },
    { tier: 'creator', count: profile.creatorCount },
    { tier: 'reader', count: profile.readerCount },
  ];

  let globalIndex = 0;
  for (const { tier, count } of tierPlan) {
    for (let i = 0; i < count; i += 1) {
      const id = uuidv4();
      // 让不同社区分布呈轻微自然的流行度倾斜，而不是完全均匀死板
      const communityIndex =
        tier === 'reader' && rng.chance(0.35)
          ? rng.zipfIndex(COMMUNITY_ORDER.length, 1.08)
          : i % COMMUNITY_ORDER.length;
      const primaryCluster = COMMUNITY_ORDER[communityIndex];
      const config = COMMUNITY_CONFIGS[primaryCluster];

      const secondaryPool = tier === 'bridge' ? COMMUNITY_ORDER.filter((c) => c !== primaryCluster) : config.adjacentClusters;
      const secondaryCount = tier === 'bridge' ? 2 : tier === 'kol' ? 2 : rng.int(1, 2);
      const secondaryClusters = rng.sampleWithoutReplacement(secondaryPool, secondaryCount);

      const firstName = EXTRA_USER_FIRST_NAMES[(globalIndex * 7 + i * 3) % EXTRA_USER_FIRST_NAMES.length];
      const lastName = EXTRA_USER_LAST_NAMES[(globalIndex * 5 + i * 11) % EXTRA_USER_LAST_NAMES.length];
      const numTag = String(i + 1).padStart(tier === 'reader' ? 4 : 3, '0');
      const username = `${SYNTH_USERNAME_PREFIX}${tier}_${primaryCluster}_${numTag}`;

      const tierTag =
        tier === 'kol'
          ? `${firstName} ${lastName}`
          : tier === 'bridge'
            ? `${firstName} · 跨界观察`
            : `${firstName} ${lastName}`;

      const demo = DEMOGRAPHICS_POOL[(globalIndex + (rng.chance(0.45) ? 0 : 1)) % DEMOGRAPHICS_POOL.length];
      const birthYear = rng.int(demo.birthYearMin, demo.birthYearMax);
      const birthMonth = String(rng.int(1, 12)).padStart(2, '0');
      const birthDay = String(rng.int(1, 28)).padStart(2, '0');

      const influenceScore =
        tier === 'kol'
          ? Number(rng.float(0.75, 1.0).toFixed(3))
          : tier === 'bridge'
            ? Number(rng.float(0.55, 0.85).toFixed(3))
            : tier === 'creator'
              ? Number(rng.float(0.3, 0.65).toFixed(3))
              : Number(rng.float(0.05, 0.28).toFixed(3));

      const activityScore =
        tier === 'kol'
          ? Number(rng.float(0.7, 0.96).toFixed(3))
          : tier === 'bridge'
            ? Number(rng.float(0.65, 0.95).toFixed(3))
            : tier === 'creator'
              ? Number(rng.float(0.5, 0.9).toFixed(3))
              : Number(rng.float(0.15, 0.85).toFixed(3));

      const createdDaysAgo = rng.int(18, 95);
      const createdAt = new Date(Date.now() - createdDaysAgo * DAY_MS - rng.int(0, 20) * HOUR_MS);
      const lastSeen = new Date(Date.now() - rng.int(0, tier === 'reader' ? 72 : 12) * HOUR_MS);

      const bio =
        tier === 'kol'
          ? `专注 ${config.zhLabel} 与 ${COMMUNITY_CONFIGS[secondaryClusters[0]].zhLabel} 一线实践 | ${config.label}`
          : tier === 'bridge'
            ? `连接 ${config.zhLabel} × ${COMMUNITY_CONFIGS[secondaryClusters[0]].zhLabel}，关注多领域交叉信号`
            : tier === 'creator'
              ? `日常记录 ${config.zhLabel} 思考与真实工程笔记`
              : `关注 ${config.zhLabel}、${COMMUNITY_CONFIGS[secondaryClusters[0]].zhLabel} 的探索者`;

      users.push({
        id,
        username,
        displayName: tierTag.slice(0, 48),
        tier,
        primaryCluster,
        secondaryClusters,
        affinityWeights: buildAffinityWeights(primaryCluster, secondaryClusters, rng),
        activityScore,
        influenceScore,
        language: demo.language,
        region: demo.region,
        location: rng.pick(config.locations),
        bio: bio.slice(0, 190),
        website: `https://space.example.dev/@${username}`,
        avatarUrl: buildAvatarUrl(rng, globalIndex),
        birthDate: new Date(`${birthYear}-${birthMonth}-${birthDay}`),
        isOnline: tier === 'kol' ? rng.chance(0.65) : tier === 'bridge' ? rng.chance(0.55) : rng.chance(0.2),
        lastSeen,
        createdAt,
      });

      globalIndex += 1;
    }
  }

  return users;
}

/**
 * 构建基于 LDBC SNB 同质性（Homophily）、三元闭包（Triadic Closure）、
 * 偏好依附（Preferential Attachment）和桥梁跨区的有向社交网络
 */
export function generateCorrelatedFollowGraph(input: {
  syntheticUsers: SyntheticUserRecord[];
  realUsersToAttach: ExistingRealUserSeedInput[];
  rng: SeededRng;
}): {
  edges: DirectedFollowEdge[];
  inDegreeMap: Map<string, number>;
  outNeighborsMap: Map<string, Set<string>>;
  attachedUsers: SyntheticUserRecord[];
} {
  const { syntheticUsers, realUsersToAttach, rng } = input;
  const nowMs = Date.now();
  const edgeMap = new Map<string, DirectedFollowEdge>();
  const outNeighborsMap = new Map<string, Set<string>>();
  const inDegreeMap = new Map<string, number>();

  const usersByCluster = new Map<CommunityKey, SyntheticUserRecord[]>();
  const kolsByCluster = new Map<CommunityKey, SyntheticUserRecord[]>();
  const bridges: SyntheticUserRecord[] = [];
  const kols: SyntheticUserRecord[] = [];
  const creatorsByCluster = new Map<CommunityKey, SyntheticUserRecord[]>();

  for (const key of COMMUNITY_ORDER) {
    usersByCluster.set(key, []);
    kolsByCluster.set(key, []);
    creatorsByCluster.set(key, []);
  }

  for (const user of syntheticUsers) {
    usersByCluster.get(user.primaryCluster)!.push(user);
    if (user.tier === 'kol') {
      kols.push(user);
      kolsByCluster.get(user.primaryCluster)!.push(user);
    } else if (user.tier === 'bridge') {
      bridges.push(user);
    } else if (user.tier === 'creator') {
      creatorsByCluster.get(user.primaryCluster)!.push(user);
    }
  }

  // 对每个社区 KOL 按影响力降序排列，便于做 Zipf 幂律偏好依附
  for (const clusterKols of kolsByCluster.values()) {
    clusterKols.sort((a, b) => b.influenceScore - a.influenceScore);
  }
  kols.sort((a, b) => b.influenceScore - a.influenceScore);

  const addEdge = (
    userId: string,
    contactId: string,
    reason: DirectedFollowEdge['reason'],
    strength: number,
  ): void => {
    if (!userId || !contactId || userId === contactId) return;
    const key = `${userId}:${contactId}`;
    if (edgeMap.has(key)) return;

    const daysAgo = rng.int(1, 45);
    const addedAt = new Date(nowMs - daysAgo * DAY_MS - rng.int(0, 23) * HOUR_MS);
    edgeMap.set(key, {
      userId,
      contactId,
      addedAt,
      strength,
      isMutual: false,
      reason,
    });

    let out = outNeighborsMap.get(userId);
    if (!out) {
      out = new Set<string>();
      outNeighborsMap.set(userId, out);
    }
    out.add(contactId);
    inDegreeMap.set(contactId, (inDegreeMap.get(contactId) || 0) + 1);
  };

  // 第一阶段：KOL 内部协作连边 + Bridge 跨区枢纽连边
  for (const kol of kols) {
    const peerKols = (kolsByCluster.get(kol.primaryCluster) || []).filter((k) => k.id !== kol.id);
    for (const peer of rng.sampleWithoutReplacement(peerKols, rng.int(2, 4))) {
      addEdge(kol.id, peer.id, 'homophily', 0.85);
      if (rng.chance(0.75)) {
        addEdge(peer.id, kol.id, 'homophily', 0.85);
      }
    }
    // 跨社区 KOL 互相关注一部分邻近集群大V
    for (const sec of kol.secondaryClusters) {
      const secKols = kolsByCluster.get(sec) || [];
      if (secKols.length > 0) {
        const target = rng.pick(secKols);
        addEdge(kol.id, target.id, 'bridge', 0.7);
      }
    }
  }

  for (const bridge of bridges) {
    const targetClusters = [bridge.primaryCluster, ...bridge.secondaryClusters];
    for (const cluster of targetClusters) {
      const clusterKols = kolsByCluster.get(cluster) || [];
      for (const targetKol of rng.sampleWithoutReplacement(clusterKols, rng.int(2, 3))) {
        addEdge(bridge.id, targetKol.id, 'bridge', 0.82);
        if (rng.chance(0.4)) {
          addEdge(targetKol.id, bridge.id, 'bridge', 0.72);
        }
      }
      const clusterCreators = creatorsByCluster.get(cluster) || [];
      for (const creator of rng.sampleWithoutReplacement(clusterCreators, rng.int(3, 5))) {
        addEdge(bridge.id, creator.id, 'bridge', 0.75);
        if (rng.chance(0.55)) {
          addEdge(creator.id, bridge.id, 'bridge', 0.75);
        }
      }
    }
    // Bridge 之间互相形成骨架网
    for (const peerBridge of rng.sampleWithoutReplacement(bridges, rng.int(3, 5))) {
      if (peerBridge.id !== bridge.id) {
        addEdge(bridge.id, peerBridge.id, 'bridge', 0.78);
      }
    }
  }

  // 第二阶段：Creator 与 Reader 按同质性 + Zipf 幂律偏好关注（避免图过密同时保证高连通度）
  for (const user of syntheticUsers) {
    if (user.tier === 'kol' || user.tier === 'bridge') continue;

    // 1) 同社区 & 邻接社区 KOL 关注（Zipf 分布偏向头部）
    const primaryKols = kolsByCluster.get(user.primaryCluster) || [];
    const primaryKolCount = user.tier === 'creator' ? rng.int(2, 4) : rng.int(2, 5);
    for (let k = 0; k < primaryKolCount && primaryKols.length > 0; k += 1) {
      const idx = rng.zipfIndex(primaryKols.length, 1.25);
      addEdge(user.id, primaryKols[idx].id, 'kol_follow', 0.9);
    }

    for (const sec of user.secondaryClusters) {
      const secKols = kolsByCluster.get(sec) || [];
      if (secKols.length > 0 && rng.chance(0.78)) {
        const idx = rng.zipfIndex(secKols.length, 1.2);
        addEdge(user.id, secKols[idx].id, 'kol_follow', 0.75);
      }
    }

    // 2) 同社区 Creators & Bridges 关注（建立社区局部稠密团簇）
    const sameClusterCreators = creatorsByCluster.get(user.primaryCluster) || [];
    const creatorFollowCount = user.tier === 'creator' ? rng.int(5, 9) : rng.int(3, 6);
    for (const target of rng.sampleWithoutReplacement(sameClusterCreators, creatorFollowCount)) {
      addEdge(user.id, target.id, 'homophily', 0.76);
      if (user.tier === 'creator' && rng.chance(0.55)) {
        addEdge(target.id, user.id, 'homophily', 0.76);
      }
    }

    const clusterBridges = bridges.filter(
      (b) => b.primaryCluster === user.primaryCluster || b.secondaryClusters.includes(user.primaryCluster),
    );
    for (const b of rng.sampleWithoutReplacement(clusterBridges, user.tier === 'creator' ? 2 : 1)) {
      addEdge(user.id, b.id, 'bridge', 0.68);
    }

    // 3) 少量长尾跨界发现 & Reader 之间互关
    if (user.tier === 'reader' && rng.chance(0.45)) {
      const sameClusterUsers = usersByCluster.get(user.primaryCluster) || [];
      for (const peer of rng.sampleWithoutReplacement(sameClusterUsers, rng.int(1, 3))) {
        addEdge(user.id, peer.id, 'homophily', 0.55);
      }
    }
  }

  // 第三阶段：LDBC SNB 核心特性 —— 三元闭包（Triadic Closure：朋友的朋友）
  // 为 Creator 和活跃 Reader 引入 2-hop 闭包边，抬高真实聚集系数，赋能 Co-Engagement / Bridge 路径
  const nonKolUsers = syntheticUsers.filter((u) => u.tier !== 'kol');
  for (const user of nonKolUsers) {
    const directSet = outNeighborsMap.get(user.id);
    if (!directSet || directSet.size === 0) continue;

    const hop1List = Array.from(directSet);
    const hop1Pick = hop1List[rng.int(0, hop1List.length - 1)];
    const hop2Set = outNeighborsMap.get(hop1Pick);
    if (!hop2Set || hop2Set.size === 0) continue;

    const closureTargets = rng.sampleWithoutReplacement(
      Array.from(hop2Set).filter((candidateId) => candidateId !== user.id && !directSet.has(candidateId)),
      user.tier === 'creator' ? 2 : 1,
    );
    for (const targetId of closureTargets) {
      addEdge(user.id, targetId, 'triadic_closure', 0.65);
    }
  }

  // 第四阶段：将存量真实注册用户（如 666, demo_interviewer 等）无损接入合成图谱中心与多层邻域
  const attachedUsers: SyntheticUserRecord[] = [];
  for (const [idx, realUser] of realUsersToAttach.entries()) {
    const primary = COMMUNITY_ORDER[idx % COMMUNITY_ORDER.length];
    const sec = COMMUNITY_CONFIGS[primary].adjacentClusters.slice(0, 2);
    const synthUserView: SyntheticUserRecord = {
      id: realUser.id,
      username: realUser.username,
      displayName: realUser.username,
      tier: 'bridge',
      isRealUser: true,
      primaryCluster: primary,
      secondaryClusters: sec,
      affinityWeights: buildAffinityWeights(primary, sec, rng),
      activityScore: 0.9,
      influenceScore: 0.72,
      language: realUser.language || 'zh',
      region: realUser.region || 'CN',
      location: 'Shanghai, CN',
      bio: '',
      website: '',
      avatarUrl: '',
      birthDate: new Date('1995-01-01'),
      isOnline: true,
      lastSeen: new Date(),
      createdAt: realUser.createdAt || new Date(),
    };
    attachedUsers.push(synthUserView);

    // 让真实用户关注跨 12 个社区的精选 KOL 与 Bridge，同时让多位 Bridge & Creator 反向关注该真实用户
    // （注意：只保留部分未关注作者，留出足够丰富的 Out-of-Network 二跳作者池供 GraphKernel / TwoTower / EmbeddingAuthor 召回！）
    const focusClusters = COMMUNITY_ORDER.filter((_, cIdx) => cIdx % 2 === idx % 2);
    for (const cluster of focusClusters) {
      const cKols = kolsByCluster.get(cluster) || [];
      if (cKols[0]) {
        addEdge(realUser.id, cKols[0].id, 'real_user_attach', 0.92);
      }
      const cBridges = bridges.filter((b) => b.primaryCluster === cluster);
      if (cBridges[0]) {
        addEdge(realUser.id, cBridges[0].id, 'real_user_attach', 0.85);
        addEdge(cBridges[0].id, realUser.id, 'real_user_attach', 0.85);
      }
      const cCreators = creatorsByCluster.get(cluster) || [];
      for (const follower of rng.sampleWithoutReplacement(cCreators, 2)) {
        addEdge(follower.id, realUser.id, 'real_user_attach', 0.74);
      }
    }
  }

  // 标注双向互关状态
  for (const edge of edgeMap.values()) {
    const reverseKey = `${edge.contactId}:${edge.userId}`;
    if (edgeMap.has(reverseKey)) {
      edge.isMutual = true;
    }
  }

  return {
    edges: Array.from(edgeMap.values()),
    inDegreeMap,
    outNeighborsMap,
    attachedUsers,
  };
}
