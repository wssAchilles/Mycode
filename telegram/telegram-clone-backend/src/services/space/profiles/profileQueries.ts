/**
 * Space profile domain queries.
 * Extracted from spaceService with identical control flow.
 */
import mongoose from 'mongoose';
import Post, { IPost } from '../../../models/Post';
import Like from '../../../models/Like';
import Repost from '../../../models/Repost';
import User from '../../../models/User';
import Contact, { ContactStatus } from '../../../models/Contact';
import SpaceProfile from '../../../models/SpaceProfile';
import { createChildLogger } from '../../../utils/logger';
import { getPostsByIds } from '../posts/postMutations';

const log = createChildLogger('services:spaceService');

export async function getFollowedSet(userId: string): Promise<Set<string>> {
    try {
        const contacts = await Contact.findAll({
            where: { userId, status: ContactStatus.ACCEPTED },
            attributes: ['contactId'],
        });
        return new Set(contacts.map((c: { contactId: string }) => c.contactId));
    } catch (error) {
        log.error({ err: error }, '[SpaceService] Failed to load followed users');
        return new Set();
    }
}

export async function getUserPosts(
    authorId: string,
    limit: number = 20,
    cursor?: Date
): Promise<IPost[]> {
    const query: Record<string, unknown> = {
        authorId,
        deletedAt: null,
    };

    if (cursor) {
        query.createdAt = { $lt: cursor };
    }

    return Post.find(query).sort({ createdAt: -1 }).limit(limit);
}

export async function getUserLikedPosts(
    targetUserId: string,
    viewerId?: string,
    limit: number = 20,
    cursor?: Date
): Promise<{ posts: any[]; hasMore: boolean; nextCursor?: string }> {
    const likeQuery: Record<string, unknown> = { userId: targetUserId };
    if (cursor) {
        likeQuery.createdAt = { $lt: cursor };
    }

    const likes = await Like.find(likeQuery)
        .sort({ createdAt: -1 })
        .select('postId createdAt')
        .limit(limit)
        .lean();

    const nextCursor = likes.length > 0
        ? new Date(likes[likes.length - 1].createdAt).toISOString()
        : undefined;

    const postIds = likes
        .map((like: { postId?: mongoose.Types.ObjectId }) => like.postId)
        .filter((id: mongoose.Types.ObjectId | undefined): id is mongoose.Types.ObjectId => !!id);

    if (postIds.length === 0) {
        return { posts: [], hasMore: likes.length >= limit, nextCursor };
    }

    const idStrings = postIds.map((id) => id.toString());
    const posts = await getPostsByIds(idStrings);

    const objectIds = postIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const [likedSet, repostedSet] = viewerId
        ? await Promise.all([
            Like.getLikedPostIds(viewerId, objectIds),
            Repost.getRepostedPostIds(viewerId, objectIds),
        ])
        : [new Set<string>(), new Set<string>()];

    const enriched = posts.map((post) => {
        const raw = post.toObject ? post.toObject() : post;
        const id = raw._id?.toString() || raw.id;
        return {
            ...raw,
            isLikedByUser: viewerId ? likedSet.has(id) : false,
            isRepostedByUser: viewerId ? repostedSet.has(id) : false,
        };
    });

    return {
        posts: enriched,
        hasMore: likes.length >= limit,
        nextCursor,
    };
}

export async function getUserProfile(
    targetUserId: string,
    viewerId?: string
): Promise<{
    id: string;
    username: string;
    avatarUrl?: string | null;
    isOnline?: boolean | null;
    lastSeen?: Date | null;
    createdAt?: Date | null;
    displayName?: string | null;
    bio?: string | null;
    location?: string | null;
    website?: string | null;
    coverUrl?: string | null;
    stats: {
        posts: number;
        followers: number;
        following: number;
    };
    isFollowed: boolean;
    pinnedPost?: IPost | null;
} | null> {
    const user = await User.findByPk(targetUserId, {
        attributes: ['id', 'username', 'avatarUrl', 'isOnline', 'lastSeen', 'createdAt'],
    });

    if (!user) return null;

    const [postsCount, followersCount, followingCount, followRecord, profileDoc, pinnedPost] = await Promise.all([
        Post.countDocuments({ authorId: targetUserId, deletedAt: null }),
        Contact.count({ where: { contactId: targetUserId, status: ContactStatus.ACCEPTED } }),
        Contact.count({ where: { userId: targetUserId, status: ContactStatus.ACCEPTED } }),
        viewerId
            ? Contact.findOne({
                where: {
                    userId: viewerId,
                    contactId: targetUserId,
                    status: ContactStatus.ACCEPTED,
                },
            })
            : Promise.resolve(null),
        SpaceProfile.findOne({ userId: targetUserId }).lean(),
        Post.findOne({ authorId: targetUserId, isPinned: true, deletedAt: null }),
    ]);

    return {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl ?? null,
        isOnline: user.isOnline ?? null,
        lastSeen: user.lastSeen ?? null,
        createdAt: user.createdAt ?? null,
        displayName: profileDoc?.displayName ?? null,
        bio: profileDoc?.bio ?? null,
        location: profileDoc?.location ?? null,
        website: profileDoc?.website ?? null,
        coverUrl: profileDoc?.coverUrl ?? null,
        stats: {
            posts: postsCount,
            followers: followersCount,
            following: followingCount,
        },
        isFollowed: !!followRecord,
        pinnedPost,
    };
}

export async function setUserCover(userId: string, coverUrl: string | null): Promise<string | null> {
    const updated = await SpaceProfile.findOneAndUpdate(
        { userId },
        { coverUrl },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return updated?.coverUrl ?? null;
}

export async function updateSpaceProfileFields(
    userId: string,
    updates: {
        displayName?: string | null;
        bio?: string | null;
        location?: string | null;
        website?: string | null;
    }
): Promise<{
    displayName: string | null;
    bio: string | null;
    location: string | null;
    website: string | null;
}> {
    const $set: Record<string, unknown> = {};
    if (updates.displayName !== undefined) $set.displayName = updates.displayName;
    if (updates.bio !== undefined) $set.bio = updates.bio;
    if (updates.location !== undefined) $set.location = updates.location;
    if (updates.website !== undefined) $set.website = updates.website;

    const updated = await SpaceProfile.findOneAndUpdate(
        { userId },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return {
        displayName: (updated as any)?.displayName ?? null,
        bio: (updated as any)?.bio ?? null,
        location: (updated as any)?.location ?? null,
        website: (updated as any)?.website ?? null,
    };
}
