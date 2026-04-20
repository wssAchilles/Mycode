import Post from '../../../../models/Post';
import {
  createFeedCandidate,
  type FeedCandidate,
} from '../../types/FeedCandidate';

export interface GraphAuthorPostMaterializerOptions {
  authorIds: string[];
  limitPerAuthor?: number;
  lookbackDays?: number;
}

export interface GraphAuthorPostMaterializerDiagnostics {
  requestedAuthorCount: number;
  uniqueAuthorCount: number;
  returnedPostCount: number;
  queryDurationMs: number;
  cacheHit: boolean;
}

export interface GraphAuthorPostMaterializerResult {
  candidates: FeedCandidate[];
  diagnostics: GraphAuthorPostMaterializerDiagnostics;
}

const DEFAULT_LIMIT_PER_AUTHOR = 2;
const DEFAULT_LOOKBACK_DAYS = 7;
const MATERIALIZER_CACHE_TTL_MS = 15_000;
const MATERIALIZER_CACHE_MAX_ENTRIES = 128;

const materializerCache = new Map<
  string,
  {
    expiresAt: number;
    candidates: FeedCandidate[];
  }
>();

function uniqueAuthorIds(authorIds: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const authorId of authorIds) {
    const normalized = String(authorId || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function buildCacheKey(authorIds: string[], limitPerAuthor: number, lookbackDays: number): string {
  return `${limitPerAuthor}:${lookbackDays}:${authorIds.join(',')}`;
}

function cloneCandidates(candidates: FeedCandidate[]): FeedCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    media: candidate.media?.map((media) => ({ ...media })),
    newsMetadata: candidate.newsMetadata ? { ...candidate.newsMetadata } : undefined,
    phoenixScores: candidate.phoenixScores ? { ...candidate.phoenixScores } : undefined,
    vfResult: candidate.vfResult
      ? {
          ...candidate.vfResult,
          violations: candidate.vfResult.violations?.slice(),
        }
      : undefined,
    _scoreBreakdown: candidate._scoreBreakdown ? { ...candidate._scoreBreakdown } : undefined,
  }));
}

function readCachedCandidates(cacheKey: string): FeedCandidate[] | null {
  const cached = materializerCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    materializerCache.delete(cacheKey);
    return null;
  }
  materializerCache.delete(cacheKey);
  materializerCache.set(cacheKey, cached);
  return cloneCandidates(cached.candidates);
}

function writeCachedCandidates(cacheKey: string, candidates: FeedCandidate[]): void {
  materializerCache.set(cacheKey, {
    expiresAt: Date.now() + MATERIALIZER_CACHE_TTL_MS,
    candidates: cloneCandidates(candidates),
  });

  while (materializerCache.size > MATERIALIZER_CACHE_MAX_ENTRIES) {
    const oldestKey = materializerCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    materializerCache.delete(oldestKey);
  }
}

export async function materializeGraphAuthorPostsWithDiagnostics(
  options: GraphAuthorPostMaterializerOptions,
): Promise<GraphAuthorPostMaterializerResult> {
  const requestedAuthorCount = Array.isArray(options.authorIds) ? options.authorIds.length : 0;
  const authorIds = uniqueAuthorIds(options.authorIds);

  const limitPerAuthor = Math.max(
    1,
    Math.min(8, options.limitPerAuthor ?? DEFAULT_LIMIT_PER_AUTHOR),
  );
  const lookbackDays = Math.max(
    1,
    Math.min(180, options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS),
  );
  if (authorIds.length === 0) {
    return {
      candidates: [],
      diagnostics: {
        requestedAuthorCount,
        uniqueAuthorCount: 0,
        returnedPostCount: 0,
        queryDurationMs: 0,
        cacheHit: false,
      },
    };
  }

  const cacheKey = buildCacheKey(authorIds, limitPerAuthor, lookbackDays);
  const cachedCandidates = readCachedCandidates(cacheKey);
  if (cachedCandidates) {
    return {
      candidates: cachedCandidates,
      diagnostics: {
        requestedAuthorCount,
        uniqueAuthorCount: authorIds.length,
        returnedPostCount: cachedCandidates.length,
        queryDurationMs: 0,
        cacheHit: true,
      },
    };
  }

  const createdAfter = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const queryStartedAt = Date.now();

  const posts = await Post.aggregate([
    {
      $match: {
        authorId: { $in: authorIds },
        isNews: { $ne: true },
        deletedAt: null,
        createdAt: { $gte: createdAfter },
      },
    },
    {
      $project: {
        authorId: 1,
        content: 1,
        createdAt: 1,
        isPinned: 1,
        isReply: 1,
        replyToPostId: 1,
        isRepost: 1,
        originalPostId: 1,
        conversationId: 1,
        media: 1,
        stats: 1,
        isNsfw: 1,
        isNews: 1,
        newsMetadata: 1,
        engagementScore: { $ifNull: ['$engagementScore', 0] },
      },
    },
    { $sort: { createdAt: -1, engagementScore: -1, _id: -1 } },
    {
      $group: {
        _id: '$authorId',
        posts: { $push: '$$ROOT' },
      },
    },
    {
      $project: {
        posts: { $slice: ['$posts', limitPerAuthor] },
      },
    },
    { $unwind: '$posts' },
    { $replaceRoot: { newRoot: '$posts' } },
  ]);
  const queryDurationMs = Math.max(0, Date.now() - queryStartedAt);
  const candidates = (posts as Array<Parameters<typeof createFeedCandidate>[0]>).map((post) =>
    createFeedCandidate(post),
  );
  writeCachedCandidates(cacheKey, candidates);

  return {
    candidates,
    diagnostics: {
      requestedAuthorCount,
      uniqueAuthorCount: authorIds.length,
      returnedPostCount: candidates.length,
      queryDurationMs,
      cacheHit: false,
    },
  };
}

export async function materializeGraphAuthorPosts(
  options: GraphAuthorPostMaterializerOptions,
): Promise<FeedCandidate[]> {
  const result = await materializeGraphAuthorPostsWithDiagnostics(options);
  return result.candidates;
}
