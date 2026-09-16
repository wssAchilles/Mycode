/**
 * Space domain shared types.
 * Re-exported from services/spaceService for caller compatibility.
 */
import type { IPost } from '../../models/Post';

export interface CreatePostParams {
    authorId: string;
    content: string;
    media?: { type: 'image' | 'video' | 'gif'; url: string }[];
    replyToPostId?: string;
    quotePostId?: string;
    quoteContent?: string;
}

export interface SpaceSearchPageResult {
    posts: IPost[];
    totalCount: number;
    hasMore: boolean;
    nextCursor?: string;
    query: string;
    tag?: string;
}

export interface RecommendedSpaceUser {
    id: string;
    username: string;
    avatarUrl?: string | null;
    isOnline?: boolean | null;
    reason?: string;
    isFollowed: boolean;
    recentPosts: number;
    engagementScore: number;
}
