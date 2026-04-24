import { randomUUID } from 'crypto';
import NewsArticle from '../../models/NewsArticle';
import {
  RustNewsTrendClient,
  getDefaultRustNewsTrendBaseUrl,
} from './RustNewsTrendClient';
import type {
  NewsTrendItemPayload,
  NewsTrendMode,
  NewsTrendRequestPayload,
  NewsTrendTopicResult,
  SpaceTrendResult,
  TrendDocumentPayload,
} from './contracts';

export type NewsTrendsRustMode = 'off' | 'shadow' | 'primary';

export interface SpaceTrendPostInput {
  _id: unknown;
  content?: string;
  keywords?: string[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  isNews?: boolean;
  newsMetadata?: {
    title?: string;
    summary?: string;
    source?: string;
    url?: string;
    sourceUrl?: string;
    clusterId?: number;
  };
  stats?: {
    likeCount?: number;
    commentCount?: number;
    repostCount?: number;
    viewCount?: number;
  };
  engagementScore?: number;
}

class NewsTrendService {
  private readonly client: RustNewsTrendClient;

  constructor() {
    const timeoutMs = parsePositiveInt(
      process.env.NEWS_TRENDS_RUST_TIMEOUT_MS || process.env.RUST_RECOMMENDATION_TIMEOUT_MS,
      1500,
    );
    this.client = new RustNewsTrendClient(getDefaultRustNewsTrendBaseUrl(), timeoutMs);
  }

  getMode(): NewsTrendsRustMode {
    const mode = String(process.env.NEWS_TRENDS_RUST_MODE || 'off').trim().toLowerCase();
    if (mode === 'shadow' || mode === 'primary') return mode;
    return 'off';
  }

  async computeNewsTopics(params: {
    articles: NewsArticle[];
    limit: number;
    windowHours: number;
  }): Promise<NewsTrendTopicResult[]> {
    const response = await this.client.getTrends(
      buildRequest({
        mode: 'news_topics',
        limit: params.limit,
        windowHours: params.windowHours,
        documents: params.articles.map(articleToDocument),
      }),
    );
    return response.trends.map(trendToNewsTopic);
  }

  async computeSpaceTrends(params: {
    posts: SpaceTrendPostInput[];
    limit: number;
    windowHours: number;
  }): Promise<SpaceTrendResult[]> {
    const response = await this.client.getTrends(
      buildRequest({
        mode: 'space_trends',
        limit: params.limit,
        windowHours: params.windowHours,
        documents: params.posts.map(postToDocument),
      }),
    );
    return response.trends.map((trend) => trendToSpaceTrend(trend, params.posts));
  }
}

export const newsTrendService = new NewsTrendService();

export function getNewsTrendsRustMode(): NewsTrendsRustMode {
  return newsTrendService.getMode();
}

export function trendToNewsTopic(trend: NewsTrendItemPayload): NewsTrendTopicResult {
  return {
    clusterId: trend.numericClusterId,
    count: trend.count,
    title: trend.displayName || `#${trend.tag}`,
    summary: trend.summary || '',
    coverImageUrl: trend.coverImageUrl ?? null,
    latestAt: trend.latestAt,
    tag: trend.tag,
    displayName: trend.displayName,
    kind: trend.kind,
    heat: trend.heat,
    score: trend.score,
    canonicalKeywords: trend.canonicalKeywords,
  };
}

export function trendToSpaceTrend(
  trend: NewsTrendItemPayload,
  posts: SpaceTrendPostInput[] = [],
): SpaceTrendResult {
  const supportCount = posts.length > 0 ? countSpaceTrendSupport(trend, posts) : 0;
  return {
    tag: trend.tag,
    count: Math.max(trend.count, supportCount),
    heat: trend.heat,
    displayName: trend.displayName,
    kind: trend.kind,
    score: trend.score,
    canonicalKeywords: trend.canonicalKeywords,
  };
}

function buildRequest(params: {
  mode: NewsTrendMode;
  limit: number;
  windowHours: number;
  documents: TrendDocumentPayload[];
}): NewsTrendRequestPayload {
  return {
    requestId: `news_trends_${randomUUID()}`,
    mode: params.mode,
    limit: Math.max(1, Math.min(params.limit, 50)),
    windowHours: Math.max(1, params.windowHours),
    nowMs: Date.now(),
    documents: params.documents,
  };
}

function articleToDocument(article: NewsArticle): TrendDocumentPayload {
  return {
    id: article.id,
    sourceType: 'news_article',
    title: article.title || undefined,
    summary: article.summary || undefined,
    source: article.source || undefined,
    sourceUrl: article.sourceUrl || undefined,
    canonicalUrl: article.canonicalUrl || undefined,
    coverImageUrl: article.coverImageUrl || undefined,
    publishedAt: toIso(article.publishedAt),
    fetchedAt: toIso(article.fetchedAt),
    createdAt: toIso(article.createdAt),
    clusterId: article.clusterId ?? undefined,
    keywords: normalizeKeywords(article.keywords || []),
    metrics: {
      impressions: safeNumber(article.viewCount),
      clicks: safeNumber(article.clickCount),
      shares: safeNumber(article.shareCount),
      dwellCount: safeNumber(article.dwellCount),
    },
    embedding: Array.isArray(article.embedding) ? article.embedding : undefined,
  };
}

function postToDocument(post: SpaceTrendPostInput): TrendDocumentPayload {
  const stats = post.stats || {};
  return {
    id: String(post._id),
    sourceType: 'space_post',
    title: post.newsMetadata?.title,
    summary: post.newsMetadata?.summary,
    body: post.content,
    source: post.newsMetadata?.source || 'space',
    sourceUrl: post.newsMetadata?.sourceUrl || post.newsMetadata?.url,
    canonicalUrl: post.newsMetadata?.url,
    createdAt: toIso(post.createdAt),
    fetchedAt: toIso(post.updatedAt),
    clusterId: post.newsMetadata?.clusterId,
    keywords: normalizeKeywords(post.keywords || []),
    metrics: {
      impressions: safeNumber(stats.viewCount),
      clicks: safeNumber(post.engagementScore),
      shares: safeNumber(stats.repostCount),
      likes: safeNumber(stats.likeCount),
      comments: safeNumber(stats.commentCount),
      reposts: safeNumber(stats.repostCount),
    },
  };
}

function normalizeKeywords(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 24);
}

function countSpaceTrendSupport(
  trend: NewsTrendItemPayload,
  posts: SpaceTrendPostInput[],
): number {
  const tag = normalizeTrendToken(trend.tag);
  if (!tag) return 0;

  return posts.reduce((count, post) => {
    return postSupportsTrendTag(post, tag) ? count + 1 : count;
  }, 0);
}

function postSupportsTrendTag(post: SpaceTrendPostInput, tag: string): boolean {
  const explicitKeywords = new Set(
    (post.keywords || [])
      .map(normalizeTrendToken)
      .filter((keyword): keyword is string => Boolean(keyword)),
  );
  if (explicitKeywords.has(tag)) return true;

  const phrase = tag.replace(/_/g, ' ');
  return trendTextContainsToken(
    [
      post.content || '',
      post.newsMetadata?.title || '',
      post.newsMetadata?.summary || '',
    ].join('\n'),
    phrase,
  );
}

function normalizeTrendToken(value: string): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/#/g, '')
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  if (!normalized) return null;
  if (['trump', 'donald trump', 'president trump', 'us president'].includes(normalized)) {
    return 'donald_trump';
  }
  if (['mr beast', 'mrbeast'].includes(normalized)) return 'mrbeast';
  if (['recommendation systems', 'recommendation system', 'recommender systems'].includes(normalized)) {
    return 'recsys';
  }
  return normalized.replace(/\s+/g, '_');
}

function trendTextContainsToken(text: string, phrase: string): boolean {
  const normalizedText = String(text || '').toLowerCase().replace(/_/g, ' ');
  const normalizedPhrase = phrase.trim().toLowerCase();
  if (!normalizedText || !normalizedPhrase) return false;
  if (/[\u4e00-\u9fff]/.test(normalizedPhrase)) {
    return normalizedText.includes(normalizedPhrase);
  }

  const escaped = normalizedPhrase
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalizedText);
}

function safeNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
