import crypto from 'crypto';
import { Op } from 'sequelize';
import NewsArticle from '../models/NewsArticle';
import NewsSource from '../models/NewsSource';
import NewsUserEvent, { NewsEventType } from '../models/NewsUserEvent';
import NewsUserVector from '../models/NewsUserVector';
import { newsStorageService } from './newsStorageService';

type NewsWindow = 'today' | '72h';
type NewsRankMode = 'time' | 'personalized';

export interface NewsIngestItem {
  title: string;
  content?: string;
  summary?: string;
  url: string;
  source?: string;
  source_url?: string;
  canonical_url?: string;
  published?: string;
  language?: string;
  country?: string;
  category?: string;
  top_image?: string;
  images?: string[];
  cluster_id?: number;
  embedding?: number[];
}

const normalizeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((k) =>
      parsed.searchParams.delete(k)
    );
    return parsed.toString();
  } catch {
    return url;
  }
};

const hashUrl = (url: string) => crypto.createHash('sha256').update(url).digest('hex');

const NEWS_TIMEZONE = process.env.NEWS_TIMEZONE || 'Asia/Shanghai';

const getTimeZoneParts = (date: Date, timeZone: string) => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
};

// Returns the offset, in minutes, between UTC and the given time zone at `date`.
// Positive values mean the time zone is ahead of UTC.
const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 60000;
};

const zonedTimeToUtcMs = (parts: { year: number; month: number; day: number; hour: number; minute: number; second: number }, timeZone: string) => {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Two-pass adjustment for DST boundaries.
  let offset = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  let utcMs = utcGuess - offset * 60000;
  offset = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
  utcMs = utcGuess - offset * 60000;
  return utcMs;
};

const getZonedTodayRange = (now: Date, timeZone: string) => {
  const parts = getTimeZoneParts(now, timeZone);
  const startMs = zonedTimeToUtcMs(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 },
    timeZone
  );

  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  next.setUTCDate(next.getUTCDate() + 1);
  const endMs = zonedTimeToUtcMs(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0 },
    timeZone
  );

  const key = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return { start: new Date(startMs), end: new Date(endMs), key };
};

const extractKeywords = (text: string) => {
  const cleaned = (text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .toLowerCase();
  const tokens = cleaned.match(/[a-zA-Z]{3,}|[\u4e00-\u9fff]{2,}/g) || [];
  return Array.from(new Set(tokens)).slice(0, 40);
};

const buildLead = (text: string) => {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.slice(0, 200);
};

const buildEnhancedSummary = (text: string) => {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= 800) return cleaned;
  return `${cleaned.slice(0, 1000)}...`;
};

const buildReadableContent = (title: string, summary: string, content: string, sourceUrl?: string | null) => {
  const paragraphs = (content || '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const selected = paragraphs.slice(0, 6).join('\n\n');
  const sourceLine = sourceUrl ? `\n\n> 来源: ${sourceUrl}` : '';
  return `# ${title}\n\n${summary}\n\n${selected}${sourceLine}`.trim();
};

const computeRecencyScore = (date?: Date | null) => {
  if (!date) return 0.3;
  const hours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  return Math.exp(-hours / 12);
};

const computeSimilarity = (vector: Record<string, number> | null | undefined, keywords: string[]) => {
  if (!vector) return 0;
  const values = Object.values(vector);
  const norm = values.reduce((sum, v) => sum + v, 0) || 1;
  let score = 0;
  for (const kw of keywords) {
    if (vector[kw]) score += vector[kw];
  }
  return score / norm;
};

export const newsService = {
  async ingestArticles(items: NewsIngestItem[]): Promise<number> {
    let createdOrUpdated = 0;

    const baseMs = Date.now();
    for (const [idx, item] of items.entries()) {
      if (!item?.url || !item?.title) continue;

      const normalizedUrl = normalizeUrl(item.url);
      const hash = hashUrl(normalizedUrl);
      const publishedAt = item.published ? new Date(item.published) : null;
      const contentText = item.content || item.summary || '';
      const summary = buildEnhancedSummary(item.summary || contentText);
      const lead = buildLead(summary || contentText);
      const keywords = extractKeywords(`${item.title}\n${summary}`);

      const safePublishedAt = publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null;
      const fetchedAt = new Date(baseMs + idx);

      const existing = await NewsArticle.findOne({ where: { hashUrl: hash } });
      const article =
        existing
          ? existing
          : await NewsArticle.create({
              title: item.title,
              summary,
              lead,
              source: item.source || 'news',
              sourceUrl: item.source_url || normalizedUrl,
              canonicalUrl: item.canonical_url || normalizedUrl,
              publishedAt: safePublishedAt,
              fetchedAt,
              language: item.language || null,
              country: item.country || null,
              category: item.category || null,
              hashUrl: hash,
              clusterId: item.cluster_id || null,
              keywords,
              embedding: Array.isArray(item.embedding) ? item.embedding : undefined,
            });

      // Save readable markdown and image. Content is stored with a hash in the key, so we delete the old blob on update.
      const readableContent = buildReadableContent(item.title, summary, contentText, item.source_url || normalizedUrl);
      const contentResult = contentText ? await newsStorageService.saveContent(article.id, readableContent) : { path: article.contentPath || null, url: article.contentPath || null };
      const imageUrl = item.top_image || item.images?.[0] || null;
      const imageResult = await newsStorageService.saveImageFromUrl(article.id, imageUrl);

      const oldContentPath = article.contentPath || null;
      const oldCover = article.coverImageUrl || null;

      await article.update({
        title: item.title,
        summary,
        lead,
        source: item.source || article.source || 'news',
        sourceUrl: item.source_url || normalizedUrl,
        canonicalUrl: item.canonical_url || normalizedUrl,
        publishedAt: safePublishedAt,
        fetchedAt,
        language: item.language || null,
        country: item.country || null,
        category: item.category || null,
        clusterId: item.cluster_id || null,
        keywords,
        embedding: Array.isArray(item.embedding) ? item.embedding : undefined,
        contentPath: contentResult.path || oldContentPath,
        coverImageUrl: imageResult.url || oldCover,
        isActive: true,
      });

      if (oldContentPath && contentResult.path && oldContentPath !== contentResult.path) {
        await newsStorageService.deleteContent(oldContentPath);
      }
      if (oldCover && imageResult.url && oldCover !== imageResult.url) {
        await newsStorageService.deleteImage(oldCover);
      }

      createdOrUpdated += 1;
    }

    return createdOrUpdated;
  },

  async getFeed(
    userId?: string,
    limit: number = 10,
    cursor?: Date,
    options?: { window?: NewsWindow; rank?: NewsRankMode }
  ) {
    const windowMode: NewsWindow = options?.window === '72h' ? '72h' : 'today';
    const rankMode: NewsRankMode = options?.rank === 'personalized' ? 'personalized' : 'time';

    const andFilters: any[] = [{ isActive: true, deletedAt: null }];
    let windowStart: Date | undefined;
    let windowEnd: Date | undefined;
    let windowKey: string | undefined;

    if (windowMode === 'today') {
      const range = getZonedTodayRange(new Date(), NEWS_TIMEZONE);
      windowStart = range.start;
      windowEnd = range.end;
      windowKey = range.key;
      // Space's news module is "today-only": show what we crawled today (hourly refresh),
      // regardless of the original publisher timestamp.
      andFilters.push({ fetchedAt: { [Op.gte]: windowStart, [Op.lt]: windowEnd } });
    } else {
      const since = new Date(Date.now() - 72 * 60 * 60 * 1000);
      andFilters.push({ fetchedAt: { [Op.gte]: since } });
    }

    if (cursor) {
      andFilters.push({ fetchedAt: { [Op.lt]: cursor } });
    }

    const where: any = { [Op.and]: andFilters };

    const order: any = [
      ['fetchedAt', 'DESC'],
      ['publishedAt', 'DESC'],
    ];

    const poolSize = rankMode === 'personalized' ? Math.max(limit * 6, 30) : limit + 1;
    const articles = await NewsArticle.findAll({ where, order, limit: poolSize });

    const longTerm =
      rankMode === 'personalized' && userId
        ? (await NewsUserVector.findOne({ where: { userId } }))?.longTermVector || {}
        : {};

    const rankedArticles =
      rankMode === 'personalized'
        ? articles
            .map((article) => {
              const keywords = article.keywords || extractKeywords(`${article.title}\n${article.summary}`);
              const similarity = computeSimilarity(longTerm, keywords);
              const recency = computeRecencyScore(article.publishedAt || article.fetchedAt || null);
              const engagement = Math.min((article.engagementScore || 0) / 10, 1);
              const score = similarity * 0.5 + recency * 0.35 + engagement * 0.15;
              return { article, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((x) => x.article)
        : articles.slice(0, limit);

    const items = rankedArticles.map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary,
      lead: article.lead,
      source: article.source,
      sourceUrl: article.sourceUrl,
      canonicalUrl: article.canonicalUrl,
      publishedAt: article.publishedAt,
      fetchedAt: article.fetchedAt,
      coverImageUrl: article.coverImageUrl,
      category: article.category,
    }));

    const lastArticle = rankedArticles[rankedArticles.length - 1];
    const cursorDate = lastArticle?.fetchedAt || null;
    const nextCursor = cursorDate ? cursorDate.toISOString() : undefined;

    const hasMore = rankMode === 'personalized'
      ? items.length >= limit
      : articles.length > limit;

    return {
      items,
      nextCursor,
      hasMore,
      window: windowMode,
      windowStart: windowStart ? windowStart.toISOString() : undefined,
      windowEnd: windowEnd ? windowEnd.toISOString() : undefined,
      windowKey,
    };
  },

  async getArticle(articleId: string) {
    const article = await NewsArticle.findByPk(articleId);
    if (!article) return null;
    const content = await newsStorageService.getContent(article.contentPath);

    return {
      id: article.id,
      title: article.title,
      summary: article.summary,
      lead: article.lead,
      source: article.source,
      sourceUrl: article.sourceUrl,
      canonicalUrl: article.canonicalUrl,
      publishedAt: article.publishedAt,
      fetchedAt: article.fetchedAt,
      coverImageUrl: article.coverImageUrl,
      category: article.category,
      content,
    };
  },

  async getTopics(limit: number = 6) {
    const range = getZonedTodayRange(new Date(), NEWS_TIMEZONE);
    const articles = await NewsArticle.findAll({
      where: {
        fetchedAt: { [Op.gte]: range.start, [Op.lt]: range.end },
        clusterId: { [Op.ne]: null },
        deletedAt: null,
        isActive: true,
      },
      order: [['fetchedAt', 'DESC']],
      limit: 200,
    });

    const clusters = new Map<number, { count: number; article: any }>();
    for (const article of articles) {
      if (article.clusterId === null || article.clusterId === undefined) continue;
      const existing = clusters.get(article.clusterId);
      if (!existing) {
        clusters.set(article.clusterId, { count: 1, article });
      } else {
        existing.count += 1;
      }
    }

    const topics = Array.from(clusters.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([clusterId, data]) => ({
        clusterId,
        count: data.count,
        title: data.article.title,
        summary: data.article.summary,
        coverImageUrl: data.article.coverImageUrl,
        latestAt: data.article.publishedAt || data.article.fetchedAt,
      }));

    return topics;
  },

  async logEvent(userId: string, newsId: string, eventType: NewsEventType, dwellMs?: number) {
    await NewsUserEvent.create({ userId, newsId, eventType, dwellMs: dwellMs || null });

    const increments: Record<string, number> = {};
    if (eventType === 'impression') increments.viewCount = 1;
    if (eventType === 'click') increments.clickCount = 1;
    if (eventType === 'share') increments.shareCount = 1;
    if (eventType === 'dwell') increments.dwellCount = 1;

    if (Object.keys(increments).length > 0) {
      await NewsArticle.increment(increments, { where: { id: newsId } });
    }
  },

  async updateUserVectors(): Promise<number> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const events = await NewsUserEvent.findAll({
      where: { createdAt: { [Op.gte]: since } },
      order: [['createdAt', 'DESC']],
      limit: 5000,
    });

    const newsIds = Array.from(new Set(events.map((e) => e.newsId)));
    const articles = await NewsArticle.findAll({
      where: { id: newsIds },
      attributes: ['id', 'keywords', 'title', 'summary'],
    });

    const articleMap = new Map(articles.map((a) => [a.id, a]));
    const userVectors = new Map<string, Record<string, number>>();

    const weightFor = (eventType: NewsEventType, dwell?: number) => {
      if (eventType === 'share') return 3.0;
      if (eventType === 'click') return 1.8;
      if (eventType === 'dwell') return 1 + Math.min((dwell || 0) / 8000, 1.2);
      return 0.3;
    };

    for (const event of events) {
      const article = articleMap.get(event.newsId);
      if (!article) continue;
      const keywords = article.keywords || extractKeywords(`${article.title}\n${article.summary}`);
      if (!keywords.length) continue;
      const weight = weightFor(event.eventType, event.dwellMs || undefined);
      const current = userVectors.get(event.userId) || {};
      for (const kw of keywords) {
        current[kw] = (current[kw] || 0) + weight;
      }
      userVectors.set(event.userId, current);
    }

    let updated = 0;
    for (const [userId, shortTerm] of userVectors.entries()) {
      const existing = await NewsUserVector.findOne({ where: { userId } });
      const longTerm = existing?.longTermVector || {};
      const merged: Record<string, number> = { ...longTerm };
      const alpha = 0.2;
      for (const [kw, score] of Object.entries(shortTerm)) {
        merged[kw] = (merged[kw] || 0) * (1 - alpha) + score * alpha;
      }

      await NewsUserVector.upsert({
        userId,
        shortTermVector: shortTerm,
        longTermVector: merged,
      });
      updated += 1;
    }

    return updated;
  },

  async cleanup(contentDays: number = 30, metadataDays: number = 90) {
    const now = Date.now();
    const contentCutoff = new Date(now - contentDays * 24 * 60 * 60 * 1000);
    const metadataCutoff = new Date(now - metadataDays * 24 * 60 * 60 * 1000);

    const toStrip = await NewsArticle.findAll({
      where: {
        contentPath: { [Op.ne]: null },
        [Op.or]: [
          { publishedAt: { [Op.lt]: contentCutoff } },
          { publishedAt: null, fetchedAt: { [Op.lt]: contentCutoff } },
        ],
      },
      limit: 200,
    });

    for (const article of toStrip) {
      await newsStorageService.deleteContent(article.contentPath);
      await newsStorageService.deleteImage(article.coverImageUrl || null);
      await article.update({ contentPath: null, coverImageUrl: null });
    }

    const toDelete = await NewsArticle.findAll({
      where: {
        [Op.or]: [
          { publishedAt: { [Op.lt]: metadataCutoff } },
          { publishedAt: null, fetchedAt: { [Op.lt]: metadataCutoff } },
        ],
      },
      limit: 200,
    });

    for (const article of toDelete) {
      await newsStorageService.deleteContent(article.contentPath);
      await newsStorageService.deleteImage(article.coverImageUrl || null);
      await article.destroy({ force: true });
    }

    return { stripped: toStrip.length, deleted: toDelete.length };
  },

  async ensureSource(name: string, baseUrl?: string) {
    const [source] = await NewsSource.findOrCreate({
      where: { name },
      defaults: {
        name,
        baseUrl: baseUrl || null,
        trustLevel: 5,
        isActive: true,
      },
    });
    return source;
  },
};
