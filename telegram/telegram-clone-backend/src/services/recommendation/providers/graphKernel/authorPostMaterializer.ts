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

const DEFAULT_LIMIT_PER_AUTHOR = 2;
const DEFAULT_LOOKBACK_DAYS = 7;

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

export async function materializeGraphAuthorPosts(
  options: GraphAuthorPostMaterializerOptions,
): Promise<FeedCandidate[]> {
  const authorIds = uniqueAuthorIds(options.authorIds);
  if (authorIds.length === 0) {
    return [];
  }

  const limitPerAuthor = Math.max(
    1,
    Math.min(8, options.limitPerAuthor ?? DEFAULT_LIMIT_PER_AUTHOR),
  );
  const lookbackDays = Math.max(
    1,
    Math.min(180, options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS),
  );
  const createdAfter = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const posts = await Post.aggregate([
    {
      $match: {
        authorId: { $in: authorIds },
        isNews: { $ne: true },
        deletedAt: null,
        createdAt: { $gte: createdAfter },
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

  return (posts as Array<Parameters<typeof createFeedCandidate>[0]>).map((post) =>
    createFeedCandidate(post),
  );
}
