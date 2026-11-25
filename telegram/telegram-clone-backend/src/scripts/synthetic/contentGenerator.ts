import mongoose from 'mongoose';

import {
  type CommunityKey,
  type ScaleProfile,
  SYNTH_SCRIPT_VERSION,
  type SyntheticPostRecord,
  type SyntheticUserRecord,
} from './contracts';
import { SeededRng } from './prng';
import { COMMUNITY_CONFIGS, COMMUNITY_ORDER } from './taxonomy';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const QUOTE_CONTENT_TEMPLATES = [
  '非常认同这段工程实践，尤其是在冷启动阶段对召回质量的直观改善。',
  '补充一个实际线上踩坑点：一定要同时观测缓存命中率与尾延迟回退比例。',
  '转发留存，这套拆解方法放到大群投递与信息流重排里同样适用。',
  'Strong takeaway here—aligning observability with ranking intuition pays off fast.',
  '值得团队内部评审时重点参考的一条实战笔记 👍',
];

function buildPostText(
  author: SyntheticUserRecord,
  cluster: CommunityKey,
  postIdx: number,
  rng: SeededRng,
): { content: string; language: string; keywords: string[] } {
  const config = COMMUNITY_CONFIGS[cluster];
  const hook = rng.pick(config.postHooks);
  const body = rng.pick(config.postBodies);
  const outcome = rng.pick(config.postOutcomes);

  const extraTag = rng.pick(config.keywords);
  const content = `${hook}\n\n${body}。${outcome} #${cluster} #${extraTag}`;
  const isEnglish = /^[A-Za-z0-9\s,'"’—.-]+/.test(hook) && !/[\u4e00-\u9fff]/.test(hook);
  const keywords = Array.from(
    new Set([
      ...config.keywords.slice(0, 5),
      extraTag,
      author.primaryCluster,
      ...(author.secondaryClusters[0] ? [COMMUNITY_CONFIGS[author.secondaryClusters[0]].keywords[0]] : []),
    ]),
  ).slice(0, 8);

  return {
    content: content.slice(0, 1800),
    language: isEnglish ? 'en' : 'zh',
    keywords,
  };
}

/**
 * 采样帖子发布时间：
 * 约 35% 分布在最近 48 小时，30% 在 2~7 天内（总计 ~65% 位于 Thunder/C++ 内网 7 天热窗），
 * 剩余 35% 分布在 8~30 天形成长尾特征库
 */
function samplePostCreatedAt(rng: SeededRng, nowMs: number, lookbackDays: number): Date {
  const bucket = rng.next();
  let ageMs: number;
  if (bucket < 0.35) {
    ageMs = rng.int(10, 48 * 60) * 60 * 1000;
  } else if (bucket < 0.65) {
    ageMs = rng.int(48 * 60, 7 * 24 * 60) * 60 * 1000;
  } else {
    ageMs = rng.int(7 * 24 * 60, lookbackDays * 24 * 60) * 60 * 1000;
  }
  return new Date(nowMs - ageMs - rng.int(0, 59) * 1000);
}

/**
 * 生成具备幂律发帖密度、Flashmob 脉冲热点及真实引用链路的合成帖子流
 */
export function generateSyntheticPosts(input: {
  users: SyntheticUserRecord[];
  attachedRealUsers: SyntheticUserRecord[];
  profile: ScaleProfile;
  rng: SeededRng;
}): SyntheticPostRecord[] {
  const { users, attachedRealUsers, profile, rng } = input;
  const nowMs = Date.now();
  const posts: SyntheticPostRecord[] = [];

  // 构建按作者层级加权的发帖分配器：KOL > Bridge > Creator > Reader
  const weightedAuthors: SyntheticUserRecord[] = [];
  const authorWeights: number[] = [];

  for (const user of users) {
    weightedAuthors.push(user);
    const tierBase =
      user.tier === 'kol'
        ? 11
        : user.tier === 'bridge'
          ? 6
          : user.tier === 'creator'
            ? 3.8
            : 0.45;
    authorWeights.push(tierBase * (0.65 + user.activityScore * 0.7));
  }

  // 保底确保每个 KOL 和 Bridge 至少有 3 篇近期帖子，Creator 至少 1 篇帖子，使图内核每次召回都能物化到候选贴
  const authorPostIndex = new Map<string, number>();
  const addPostForAuthor = (author: SyntheticUserRecord, forceRecent: boolean): void => {
    const idx = authorPostIndex.get(author.id) || 0;
    authorPostIndex.set(author.id, idx + 1);

    const cluster =
      author.secondaryClusters.length > 0 && rng.chance(0.28)
        ? rng.pick(author.secondaryClusters)
        : author.primaryCluster;
    const secondaryCluster =
      author.secondaryClusters[0] && author.secondaryClusters[0] !== cluster
        ? author.secondaryClusters[0]
        : COMMUNITY_CONFIGS[cluster].adjacentClusters[0];

    const built = buildPostText(author, cluster, idx, rng);
    const createdAt = forceRecent
      ? new Date(nowMs - rng.int(20, 6 * 24 * 60) * 60 * 1000)
      : samplePostCreatedAt(rng, nowMs, profile.lookbackDays);

    // 按 LDBC SNB Flashmob 模型：约 8% 的帖子触发热点事件，尤其头部 KOL/Bridge 触发率略高
    const flashmobProb =
      author.tier === 'kol'
        ? profile.flashmobPostRatio * 2.1
        : author.tier === 'bridge'
          ? profile.flashmobPostRatio * 1.3
          : profile.flashmobPostRatio * 0.65;
    const isFlashmob = rng.chance(flashmobProb);

    const viralityBase = rng.logNormal(0, 0.55);
    const tierBoost =
      author.tier === 'kol'
        ? 2.2
        : author.tier === 'bridge'
          ? 1.45
          : author.tier === 'creator'
            ? 1.05
            : 0.6;
    const viralityFactor = Number(
      Math.min(12, Math.max(0.25, viralityBase * tierBoost * (isFlashmob ? rng.float(2.4, 4.2) : 1))).toFixed(3),
    );

    posts.push({
      _id: new mongoose.Types.ObjectId(),
      authorId: author.id,
      authorTier: author.isRealUser ? 'real' : author.tier,
      cluster,
      secondaryCluster,
      content: built.content,
      keywords: Array.from(new Set([...built.keywords, SYNTH_SCRIPT_VERSION])),
      language: built.language,
      createdAt,
      isFlashmob,
      viralityFactor,
      isQuote: false,
    });
  };

  for (const user of users) {
    if (user.tier === 'kol') {
      for (let i = 0; i < 4; i += 1) addPostForAuthor(user, i < 3);
    } else if (user.tier === 'bridge') {
      for (let i = 0; i < 3; i += 1) addPostForAuthor(user, i < 2);
    } else if (user.tier === 'creator') {
      addPostForAuthor(user, true);
    }
  }

  // 给参与融入的真实账号也保留不强加发帖，避免污染真实用户的动态列表
  void attachedRealUsers;

  while (posts.length < profile.targetPosts) {
    const author = rng.weightedPick(weightedAuthors, authorWeights);
    addPostForAuthor(author, false);
  }

  // 为约 5% 的帖子赋予真实的 Quote 引用原帖结构（保证引用帖子创建时间严格晚于被引用原帖）
  posts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const quoteTargetCount = Math.floor(posts.length * 0.05);
  const eligibleCandidates = posts.filter((_, idx) => idx < posts.length - 20);
  if (eligibleCandidates.length > 0) {
    for (let i = 0; i < quoteTargetCount; i += 1) {
      const quoteIdx = rng.int(Math.floor(posts.length * 0.25), posts.length - 1);
      const quotePost = posts[quoteIdx];
      if (quotePost.isQuote) continue;

      const originalIdx = rng.int(0, Math.max(0, quoteIdx - 1));
      const originalPost = posts[originalIdx];
      if (originalPost.authorId === quotePost.authorId) continue;

      quotePost.isQuote = true;
      quotePost.originalPostId = originalPost._id;
      quotePost.quoteContent = quotePost.content;
      quotePost.content = `${rng.pick(QUOTE_CONTENT_TEMPLATES)} (${COMMUNITY_CONFIGS[originalPost.cluster].zhLabel})`;
      if (quotePost.createdAt.getTime() <= originalPost.createdAt.getTime()) {
        quotePost.createdAt = new Date(
          Math.min(nowMs - 60_000, originalPost.createdAt.getTime() + rng.int(5, 180) * 60 * 1000),
        );
      }
    }
  }

  // 保障同一作者贴文不完全撞时间戳
  const seenAuthorTimestamps = new Map<string, number>();
  for (const post of posts) {
    const key = `${post.authorId}:${post.createdAt.getTime()}`;
    if (seenAuthorTimestamps.has(key)) {
      post.createdAt = new Date(post.createdAt.getTime() + rng.int(1, 59) * 1000);
    }
    seenAuthorTimestamps.set(`${post.authorId}:${post.createdAt.getTime()}`, 1);
  }

  void DAY_MS;
  void HOUR_MS;
  void COMMUNITY_ORDER;
  return posts;
}
