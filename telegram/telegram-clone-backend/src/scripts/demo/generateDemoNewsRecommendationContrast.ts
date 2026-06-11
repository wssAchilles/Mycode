import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Op } from 'sequelize';

import NewsArticle from '../../models/NewsArticle';
import NewsUserEvent, { NewsEventType } from '../../models/NewsUserEvent';
import NewsUserVector from '../../models/NewsUserVector';
import Post, { MediaType } from '../../models/Post';
import SpaceProfile from '../../models/SpaceProfile';
import User from '../../models/User';
import UserAction, { ActionType } from '../../models/UserAction';
import UserSignal, { ProductSurface, SignalType, TargetType } from '../../models/UserSignal';
import { sequelize } from '../../config/sequelize';
import { DEMO_DEFAULT_PASSWORD, DEMO_VIEWER_USERNAME } from './config';

type Options = {
  primaryUser: string;
  contrastUser: string;
  password: string;
  dryRun: boolean;
};

type SegmentKey = 'primary' | 'contrast';

type NewsDraft = {
  title: string;
  summary: string;
  source: string;
  category: string;
  keywords: string[];
  imageUrl: string;
};

type DemoUser = {
  id: string;
  username: string;
};

const SCRIPT_ID = 'demo_news_recommendation_contrast_v1';
const HASH_PREFIX = 'demo_news_contrast_v1';
const NEWS_AUTHOR_ID = 'news_bot_official';
const DAY_MS = 24 * 60 * 60 * 1000;

const parseBooleanFlag = (flag: string): boolean => process.argv.includes(flag);

const parseStringArg = (flag: string, fallback: string): string => {
  const direct = process.argv.find((value) => value.startsWith(`${flag}=`));
  const flagIndex = process.argv.indexOf(flag);
  const raw = direct ? direct.slice(flag.length + 1) : flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
  if (!raw || raw.startsWith('--')) return fallback;
  return raw;
};

const parseOptions = (): Options => ({
  primaryUser: parseStringArg('--primary-user', DEMO_VIEWER_USERNAME),
  contrastUser: parseStringArg('--contrast-user', 'demo_world_news_viewer'),
  password: parseStringArg('--password', DEMO_DEFAULT_PASSWORD),
  dryRun: parseBooleanFlag('--dry-run'),
});

const primaryNews: NewsDraft[] = [
  {
    title: 'Recommendation systems teams tighten retrieval quality before ranking changes',
    summary: 'Home Mixer style candidate selection improves recall quality for AI product feeds without changing the final scorer.',
    source: 'demo_recsys_daily',
    category: 'technology',
    keywords: ['recsys', 'recommendation', 'ranking', 'retrieval', 'home', 'mixer', 'candidate', 'quality'],
    imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'AI systems benchmark highlights feature freshness and served-history proof',
    summary: 'A new production report argues that fresh user vectors and served-history evidence matter more than heavier models in early feed gains.',
    source: 'demo_ai_systems',
    category: 'technology',
    keywords: ['ai', 'systems', 'features', 'freshness', 'served', 'history', 'vectors', 'ranking'],
    imageUrl: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Social graph expansion lifts personalized feeds for low-activity users',
    summary: 'Graph edge smoothing and author-affinity features helped a recommendation service improve cold-start quality.',
    source: 'demo_graph_report',
    category: 'technology',
    keywords: ['social', 'graph', 'realgraph', 'affinity', 'cold', 'start', 'personalized', 'feed'],
    imageUrl: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Phoenix-style ranking contract standardizes dense vectors across content towers',
    summary: 'Teams aligned user and content embeddings with strict artifact versions to avoid mixed-vector recall regressions.',
    source: 'demo_phoenix_lab',
    category: 'technology',
    keywords: ['phoenix', 'embedding', 'dense', 'vectors', 'artifact', 'contract', 'content', 'tower'],
    imageUrl: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Candidate pipeline side effects make feed recommendations easier to audit',
    summary: 'Query hydration and side-effect logging give operators clearer traces for why candidates reached the homepage.',
    source: 'demo_pipeline_ops',
    category: 'technology',
    keywords: ['candidate', 'pipeline', 'hydrator', 'side', 'effects', 'trace', 'feed', 'audit'],
    imageUrl: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Realtime post stores reduce recommendation latency during burst traffic',
    summary: 'A Thunder-like in-memory timeline keeps author candidates fresh while preserving long-term training logs elsewhere.',
    source: 'demo_thunder_runtime',
    category: 'technology',
    keywords: ['thunder', 'realtime', 'timeline', 'latency', 'author', 'candidates', 'redis', 'runtime'],
    imageUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80',
  },
];

const contrastNews: NewsDraft[] = [
  {
    title: 'Ebola quarantine dispute in Kenya raises public health concerns',
    summary: 'Officials face pressure after protests around a proposed quarantine facility and questions over regional health readiness.',
    source: 'demo_world_health',
    category: 'world',
    keywords: ['ebola', 'kenya', 'quarantine', 'health', 'africa', 'protest', 'public', 'facility'],
    imageUrl: 'https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'South Africa immigration backlash puts migrant communities under strain',
    summary: 'Community groups say fear is spreading as immigration tensions and local economic pressure intensify.',
    source: 'demo_africa_watch',
    category: 'world',
    keywords: ['south', 'africa', 'immigrants', 'migrants', 'backlash', 'community', 'fear', 'policy'],
    imageUrl: 'https://images.unsplash.com/photo-1484318571209-661cf29a69b3?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Nigeria villagers abducted after peace talks invitation',
    summary: 'Security officials say armed groups used a meeting invitation to target villagers in north-west Nigeria.',
    source: 'demo_security_wire',
    category: 'world',
    keywords: ['nigeria', 'villagers', 'abduct', 'peace', 'talks', 'security', 'bandits', 'conflict'],
    imageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Iran strikes drive renewed oil and shipping risk in Gulf routes',
    summary: 'Regional tensions increased after new strikes, with analysts watching shipping routes and energy markets.',
    source: 'demo_global_risk',
    category: 'world',
    keywords: ['iran', 'strikes', 'gulf', 'oman', 'oil', 'shipping', 'risk', 'regional'],
    imageUrl: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Climate shocks reshape migration debate across vulnerable countries',
    summary: 'Policy researchers warn that countries hit hardest by climate shocks are becoming central to immigration disputes.',
    source: 'demo_climate_policy',
    category: 'world',
    keywords: ['climate', 'migration', 'immigrants', 'countries', 'shocks', 'policy', 'trump', 'debate'],
    imageUrl: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80',
  },
  {
    title: 'Air India crash investigation focuses on aviation safety questions',
    summary: 'Investigators are reviewing flight data and safety procedures after the dispute over what caused the crash.',
    source: 'demo_aviation_news',
    category: 'world',
    keywords: ['air', 'india', 'flight', 'crash', 'aviation', 'safety', 'investigation', 'questions'],
    imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80',
  },
];

const segmentConfig: Record<SegmentKey, { label: string; news: NewsDraft[]; vectorBoost: number }> = {
  primary: {
    label: 'recsys_ai_news',
    news: primaryNews,
    vectorBoost: 22,
  },
  contrast: {
    label: 'world_health_news',
    news: contrastNews,
    vectorBoost: 22,
  },
};

const sharedSegmentKeywords: Record<SegmentKey, string[]> = {
  primary: ['recsys', 'recommendation', 'ranking', 'retrieval', 'feed', 'ai', 'features', 'personalized'],
  contrast: ['world', 'health', 'africa', 'migration', 'conflict', 'public', 'policy', 'global'],
};

const dedupe = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const keywordsFor = (segment: SegmentKey, draft: NewsDraft): string[] =>
  dedupe([...sharedSegmentKeywords[segment], ...draft.keywords]);

const hashUrl = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const buildVector = (segment: SegmentKey, drafts: NewsDraft[], boost: number): Record<string, number> => {
  const vector: Record<string, number> = {};
  drafts.forEach((draft, draftIndex) => {
    const base = boost - draftIndex * 1.5;
    keywordsFor(segment, draft).forEach((keyword, keywordIndex) => {
      vector[keyword] = (vector[keyword] || 0) + Math.max(4, base - keywordIndex * 0.6);
    });
  });
  return vector;
};

const topTerms = (vector: Record<string, number>, limit = 10): string[] =>
  Object.entries(vector)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value.toFixed(1)}`);

async function ensureUser(username: string, password: string): Promise<DemoUser> {
  const existing = await User.findOne({ where: { username }, attributes: ['id', 'username'] });
  if (existing) {
    const plain = existing.get({ plain: true }) as DemoUser;
    return { id: String(plain.id), username: plain.username };
  }

  const created = await User.create({
    username,
    password,
    email: `${username}@demo.local`,
    avatarUrl: `https://api.dicebear.com/8.x/personas/svg?seed=${encodeURIComponent(username)}`,
    region: 'US',
    language: 'en',
    isOnline: true,
    lastSeen: new Date(),
  });

  await SpaceProfile.findOneAndUpdate(
    { userId: created.id },
    {
      $set: {
        displayName: 'World News Demo Viewer',
        bio: 'Contrast account for world, public-health, migration, and conflict news recommendations.',
        location: 'Global Desk',
        website: 'https://demo.local/news-contrast',
      },
    },
    { upsert: true, new: true },
  );

  return { id: created.id, username: created.username };
}

async function refreshExistingPassword(username: string, password: string): Promise<void> {
  const hashed = await bcrypt.hash(password, 12);
  await User.update({ password: hashed }, { where: { username } });
}

async function clearPreviousRun(userIds: string[]): Promise<{ postsDeleted: number; actionsDeleted: number; signalsDeleted: number; eventsDeleted: number; articlesDeleted: number }> {
  const previousArticles = await NewsArticle.findAll({
    where: { hashUrl: { [Op.like]: `${HASH_PREFIX}:%` } },
    attributes: ['id'],
    paranoid: false,
  });
  const previousArticleIds = previousArticles.map((article) => article.id);

  const [postDelete, actionDelete, signalDelete, eventDelete, articleDelete] = await Promise.all([
    Post.deleteMany({ 'newsMetadata.externalId': { $regex: `^${SCRIPT_ID}:` } }),
    UserAction.deleteMany({ userId: { $in: userIds }, experimentKeys: SCRIPT_ID }),
    UserSignal.deleteMany({ userId: { $in: userIds }, 'metadata.generatedBy': SCRIPT_ID }),
    previousArticleIds.length > 0
      ? NewsUserEvent.destroy({ where: { newsId: previousArticleIds }, force: true })
      : Promise.resolve(0),
    NewsArticle.destroy({ where: { hashUrl: { [Op.like]: `${HASH_PREFIX}:%` } }, force: true }),
  ]);

  return {
    postsDeleted: postDelete.deletedCount || 0,
    actionsDeleted: actionDelete.deletedCount || 0,
    signalsDeleted: signalDelete.deletedCount || 0,
    eventsDeleted: Number(eventDelete) || 0,
    articlesDeleted: Number(articleDelete) || 0,
  };
}

async function createNewsSegment(segment: SegmentKey, viewer: DemoUser): Promise<{ postIds: string[]; articleIds: string[]; vector: Record<string, number> }> {
  const config = segmentConfig[segment];
  const now = Date.now();
  const vector = buildVector(segment, config.news, config.vectorBoost);
  const postIds: string[] = [];
  const articleIds: string[] = [];

  for (let index = 0; index < config.news.length; index += 1) {
    const draft = config.news[index];
    const createdAt = new Date(now - index * 6 * 60 * 1000 - (segment === 'contrast' ? 90_000 : 0));
    const externalId = `${SCRIPT_ID}:${segment}:${index + 1}`;
    const url = `https://demo.local/news/${externalId}`;
    const article = await NewsArticle.create({
      title: draft.title,
      summary: draft.summary,
      lead: draft.summary,
      source: draft.source,
      sourceUrl: url,
      canonicalUrl: url,
      publishedAt: createdAt,
      fetchedAt: createdAt,
      language: 'en',
      country: segment === 'contrast' ? 'global' : 'us',
      category: draft.category,
      coverImageUrl: draft.imageUrl,
      hashUrl: `${HASH_PREFIX}:${segment}:${hashUrl(draft.title).slice(0, 16)}`,
      clusterId: segment === 'contrast' ? 9602 : 9601,
      isActive: true,
          keywords: keywordsFor(segment, draft),
      engagementScore: 7 + index * 0.2,
      viewCount: 100 + index * 8,
      clickCount: 18 + index,
      shareCount: 4 + index,
      dwellCount: 12 + index,
    });
    articleIds.push(article.id);

    const post = await Post.create({
      authorId: NEWS_AUTHOR_ID,
      content: `${draft.title}\n\n${draft.summary}`,
      media: [{ type: MediaType.IMAGE, url: draft.imageUrl }],
      stats: {
        likeCount: 40 - index,
        repostCount: 10 + index,
        quoteCount: 2,
        commentCount: 8 + index,
        viewCount: 900 - index * 20,
      },
      isRepost: false,
      isReply: false,
      keywords: keywordsFor(segment, draft),
      language: 'en',
      isNsfw: false,
      isPinned: false,
      engagementScore: 8 - index * 0.2,
      phoenixScores: {
        clickScore: 0.72,
        dwellTimeScore: 0.84,
      },
      isNews: true,
      newsMetadata: {
        title: draft.title,
        source: draft.source,
        url,
        sourceUrl: url,
        externalId,
        clusterId: segment === 'contrast' ? 9602 : 9601,
        summary: draft.summary,
        language: 'en',
        category: draft.category,
      },
      createdAt,
      updatedAt: createdAt,
    });
    postIds.push(String(post._id));

    const timestamp = new Date(createdAt.getTime() + 30_000);
    await Promise.all([
      NewsUserEvent.bulkCreate([
        { userId: viewer.id, newsId: article.id, eventType: 'impression' as NewsEventType, createdAt: timestamp, updatedAt: timestamp },
        { userId: viewer.id, newsId: article.id, eventType: 'click' as NewsEventType, createdAt: timestamp, updatedAt: timestamp },
        { userId: viewer.id, newsId: article.id, eventType: 'dwell' as NewsEventType, dwellMs: 24_000 + index * 2500, createdAt: timestamp, updatedAt: timestamp },
      ]),
      UserAction.insertMany([
        {
          userId: viewer.id,
          action: ActionType.CLICK,
          targetPostId: post._id,
          targetAuthorId: NEWS_AUTHOR_ID,
          requestId: `${SCRIPT_ID}:${viewer.username}:${segment}:${index}:click`,
          rank: index + 1,
          score: 0.9,
          weightedScore: 0.9,
          isNews: true,
          recallSource: 'demo_news_personalized',
          modelPostId: externalId,
          targetKeywords: keywordsFor(segment, draft),
          productSurface: 'space_feed',
          experimentKeys: [SCRIPT_ID, config.label],
          timestamp,
        },
        {
          userId: viewer.id,
          action: ActionType.DWELL,
          targetPostId: post._id,
          targetAuthorId: NEWS_AUTHOR_ID,
          requestId: `${SCRIPT_ID}:${viewer.username}:${segment}:${index}:dwell`,
          dwellTimeMs: 24_000 + index * 2500,
          rank: index + 1,
          score: 0.95,
          weightedScore: 0.95,
          isNews: true,
          recallSource: 'demo_news_personalized',
          modelPostId: externalId,
          targetKeywords: keywordsFor(segment, draft),
          productSurface: 'space_feed',
          experimentKeys: [SCRIPT_ID, config.label],
          timestamp,
        },
        {
          userId: viewer.id,
          action: ActionType.LIKE,
          targetPostId: post._id,
          targetAuthorId: NEWS_AUTHOR_ID,
          requestId: `${SCRIPT_ID}:${viewer.username}:${segment}:${index}:like`,
          rank: index + 1,
          score: 1,
          weightedScore: 1,
          isNews: true,
          recallSource: 'demo_news_personalized',
          modelPostId: externalId,
          targetKeywords: keywordsFor(segment, draft),
          productSurface: 'space_feed',
          experimentKeys: [SCRIPT_ID, config.label],
          timestamp,
        },
      ]),
      UserSignal.insertMany([
        {
          userId: viewer.id,
          signalType: SignalType.TWEET_CLICK,
          targetId: String(post._id),
          targetType: TargetType.POST,
          targetAuthorId: NEWS_AUTHOR_ID,
          productSurface: ProductSurface.SPACE_FEED,
          requestId: `${SCRIPT_ID}:${viewer.username}:${segment}:${index}:signal-click`,
          metadata: {
            generatedBy: SCRIPT_ID,
            segment: config.label,
            targetKeywords: keywordsFor(segment, draft),
            recommendationSource: 'demo_news_personalized',
          },
          timestamp,
          expiresAt: new Date(timestamp.getTime() + 30 * DAY_MS),
        },
        {
          userId: viewer.id,
          signalType: SignalType.DWELL,
          targetId: String(post._id),
          targetType: TargetType.POST,
          targetAuthorId: NEWS_AUTHOR_ID,
          productSurface: ProductSurface.SPACE_FEED,
          requestId: `${SCRIPT_ID}:${viewer.username}:${segment}:${index}:signal-dwell`,
          metadata: {
            generatedBy: SCRIPT_ID,
            segment: config.label,
            dwellTimeMs: 24_000 + index * 2500,
            targetKeywords: keywordsFor(segment, draft),
            recommendationSource: 'demo_news_personalized',
          },
          timestamp,
          expiresAt: new Date(timestamp.getTime() + 30 * DAY_MS),
        },
      ]),
    ]);
  }

  await NewsUserVector.upsert({
    userId: viewer.id,
    shortTermVector: vector,
    longTermVector: vector,
  });

  return { postIds, articleIds, vector };
}

async function loadBriefComparison(primary: DemoUser, contrast: DemoUser) {
  const { spaceService } = await import('../../services/spaceService');
  const [primaryBrief, contrastBrief] = await Promise.all([
    spaceService.getNewsBrief(primary.id, 5, 24),
    spaceService.getNewsBrief(contrast.id, 5, 24),
  ]);

  return {
    primary: primaryBrief.map((item: any) => ({
      title: item.title,
      source: item.source,
      clusterId: item.clusterId,
    })),
    contrast: contrastBrief.map((item: any) => ({
      title: item.title,
      source: item.source,
      clusterId: item.clusterId,
    })),
  };
}

async function main() {
  const options = parseOptions();
  await sequelize.authenticate();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required');
  }
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 20_000,
    connectTimeoutMS: 15_000,
    maxPoolSize: 4,
    minPoolSize: 0,
    bufferCommands: false,
  });

  try {
    const primary = await ensureUser(options.primaryUser, options.password);
    const contrast = await ensureUser(options.contrastUser, options.password);
    await refreshExistingPassword(options.contrastUser, options.password);

    if (options.dryRun) {
      const existingArticles = await NewsArticle.count({ where: { isActive: true, deletedAt: null } });
      const existingNewsPosts = await Post.countDocuments({ isNews: true, deletedAt: null });
      console.log(JSON.stringify({
        dryRun: true,
        scriptId: SCRIPT_ID,
        primary,
        contrast,
        existingArticles,
        existingNewsPosts,
        planned: {
          primaryNews: primaryNews.length,
          contrastNews: contrastNews.length,
    primaryVectorTerms: topTerms(buildVector('primary', primaryNews, segmentConfig.primary.vectorBoost)),
    contrastVectorTerms: topTerms(buildVector('contrast', contrastNews, segmentConfig.contrast.vectorBoost)),
        },
      }, null, 2));
      return;
    }

    const cleared = await clearPreviousRun([primary.id, contrast.id]);
    const [primaryResult, contrastResult] = await Promise.all([
      createNewsSegment('primary', primary),
      createNewsSegment('contrast', contrast),
    ]);
    const comparison = await loadBriefComparison(primary, contrast);

    console.log(JSON.stringify({
      scriptId: SCRIPT_ID,
      primaryAccount: {
        username: primary.username,
        id: primary.id,
        topVectorTerms: topTerms(primaryResult.vector),
        createdNewsPosts: primaryResult.postIds.length,
        createdNewsArticles: primaryResult.articleIds.length,
      },
      contrastAccount: {
        username: contrast.username,
        id: contrast.id,
        passwordHint: 'uses DEMO_DEFAULT_PASSWORD unless --password is provided',
        topVectorTerms: topTerms(contrastResult.vector),
        createdNewsPosts: contrastResult.postIds.length,
        createdNewsArticles: contrastResult.articleIds.length,
      },
      cleared,
      spaceNewsBriefPreview: comparison,
    }, null, 2));
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await sequelize.close();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('[demo:news-recommendation-contrast] failed:', error);
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    } catch {
      // best effort
    }
    try {
      await sequelize.close();
    } catch {
      // best effort
    }
    process.exit(1);
  });
