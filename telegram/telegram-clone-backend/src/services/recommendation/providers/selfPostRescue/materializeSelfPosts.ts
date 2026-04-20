import Post from '../../../../models/Post';
import User from '../../../../models/User';
import {
  createFeedCandidate,
  type FeedCandidate,
} from '../../types/FeedCandidate';
import type { SelfPostRescueRequest } from './contracts';

const DEFAULT_LIMIT = 10;
const DEFAULT_LOOKBACK_DAYS = 180;

export async function materializeSelfPosts(
  request: SelfPostRescueRequest,
): Promise<FeedCandidate[]> {
  const limit = Math.max(1, Math.min(20, request.limit ?? DEFAULT_LIMIT));
  const lookbackDays = Math.max(
    1,
    Math.min(180, request.lookbackDays ?? DEFAULT_LOOKBACK_DAYS),
  );
  const createdAfter = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const posts = await Post.find({
    authorId: request.userId,
    deletedAt: null,
    createdAt: { $gte: createdAfter },
  })
    .sort({ isPinned: -1, createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  if (posts.length === 0) {
    return [];
  }

  const author = await User.findByPk(request.userId, {
    attributes: ['id', 'username', 'avatarUrl'],
  });

  return (posts as unknown as Array<Parameters<typeof createFeedCandidate>[0]>).map((post) => ({
    ...createFeedCandidate(post),
    recallSource: 'SelfPostRescueSource',
    inNetwork: true,
    authorUsername: author?.username,
    authorAvatarUrl: author?.avatarUrl,
    isLikedByUser: false,
    isRepostedByUser: false,
  }));
}
