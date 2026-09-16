/**
 * Space search domain.
 * Extracted from spaceService with identical control flow.
 */
import Post, { IPost, MediaType } from '../../../models/Post';
import { newsService } from '../../newsService';
import type { SpaceSearchPageResult } from '../types';
import {
    buildExactTextSearchQuery,
    buildTextSearchQuery,
    buildTopicTextSearchQueries,
    dedupePostsById,
    normalizeSearchLimit,
    normalizeTopicTag,
} from '../internal/pureHelpers';

async function fetchTextSearchPosts(
    query: string,
    limit: number,
    cursor?: Date
): Promise<IPost[]> {
    return Post.find(buildTextSearchQuery(query, cursor))
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .exec();
}

export async function countTextSearchMatches(query: string): Promise<number> {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return 0;
    return Post.countDocuments(buildTextSearchQuery(normalizedQuery)).exec();
}

async function fetchExactTextSearchPosts(
    query: string,
    limit: number,
    cursor?: Date
): Promise<IPost[]> {
    return Post.find(buildExactTextSearchQuery(query, cursor))
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .exec();
}

export async function countExactTextSearchMatches(query: string): Promise<number> {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return 0;
    return Post.countDocuments(buildExactTextSearchQuery(normalizedQuery)).exec();
}

export function newsArticleToSpacePost(article: Awaited<ReturnType<typeof newsService.searchTopicArticles>>['articles'][number]) {
    const createdAt = article.fetchedAt || article.publishedAt || article.createdAt || new Date();
    const summary = String(article.summary || article.lead || '').trim();
    const content = [article.title, summary].filter(Boolean).join('\n\n');
    return {
        _id: article.id,
        id: article.id,
        authorId: 'news_bot_official',
        content,
        media: article.coverImageUrl
            ? [{ type: MediaType.IMAGE, url: article.coverImageUrl }]
            : [],
        stats: {
            likeCount: 0,
            repostCount: article.shareCount || 0,
            quoteCount: 0,
            commentCount: 0,
            viewCount: article.viewCount || 0,
        },
        keywords: article.keywords || [],
        isNsfw: false,
        isPinned: false,
        isRepost: false,
        isReply: false,
        isNews: true,
        newsMetadata: {
            title: article.title,
            source: article.source || 'news',
            url: article.canonicalUrl || article.sourceUrl || `news://${article.id}`,
            sourceUrl: article.sourceUrl || article.canonicalUrl || undefined,
            externalId: article.id,
            clusterId: article.clusterId ?? undefined,
            summary,
        },
        createdAt,
        updatedAt: article.updatedAt || createdAt,
    };
}

export async function searchPostsPage(
    query: string,
    limit: number = 20,
    cursor?: Date
): Promise<SpaceSearchPageResult> {
    const normalizedQuery = String(query || '').trim();
    const safeLimit = normalizeSearchLimit(limit);

    if (!normalizedQuery) {
        return {
            posts: [],
            totalCount: 0,
            hasMore: false,
            query: normalizedQuery,
        };
    }

    const [totalCount, fetchedPosts] = await Promise.all([
        countTextSearchMatches(normalizedQuery),
        fetchTextSearchPosts(normalizedQuery, safeLimit + 1, cursor),
    ]);

    const hasMore = fetchedPosts.length > safeLimit;
    const posts = hasMore ? fetchedPosts.slice(0, safeLimit) : fetchedPosts;
    const lastPost = posts[posts.length - 1];
    const nextCursor = hasMore && lastPost?.createdAt
        ? new Date(lastPost.createdAt).toISOString()
        : undefined;

    return {
        posts,
        totalCount,
        hasMore,
        nextCursor,
        query: normalizedQuery,
    };
}

export async function searchPostsByExactTextPage(
    query: string,
    limit: number = 20,
    cursor?: Date
): Promise<SpaceSearchPageResult> {
    const normalizedQuery = String(query || '').trim();
    const safeLimit = normalizeSearchLimit(limit);
    if (!normalizedQuery) {
        return {
            posts: [],
            totalCount: 0,
            hasMore: false,
            query: normalizedQuery,
        };
    }

    const [totalCount, fetchedPosts] = await Promise.all([
        countExactTextSearchMatches(normalizedQuery),
        fetchExactTextSearchPosts(normalizedQuery, safeLimit + 1, cursor),
    ]);
    const hasMore = fetchedPosts.length > safeLimit;
    const posts = hasMore ? fetchedPosts.slice(0, safeLimit) : fetchedPosts;
    const lastPost = posts[posts.length - 1];
    const nextCursor = hasMore && lastPost?.createdAt
        ? new Date(lastPost.createdAt).toISOString()
        : undefined;

    return {
        posts,
        totalCount,
        hasMore,
        nextCursor,
        query: normalizedQuery,
    };
}

export async function searchNewsTopicPosts(
    tag: string,
    limit: number = 20,
    cursor?: Date
): Promise<SpaceSearchPageResult> {
    const result = await newsService.searchTopicArticles(tag, limit, cursor);
    const posts = result.articles.map((article) => newsArticleToSpacePost(article)) as unknown as IPost[];
    const query = `#${tag}`;
    return {
        posts,
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        query,
        tag,
    };
}

export async function getTopicPosts(
    tag: string,
    limit: number = 20,
    cursor?: Date
): Promise<SpaceSearchPageResult> {
    const normalizedTag = normalizeTopicTag(tag);
    if (!normalizedTag) {
        return {
            posts: [],
            totalCount: 0,
            hasMore: false,
            query: '',
            tag: normalizedTag,
        };
    }

    const query = `#${normalizedTag}`;
    const textQueries = buildTopicTextSearchQueries(normalizedTag);
    const [textResults, exactTextResults, newsResult] = await Promise.all([
        Promise.all(textQueries.map((textQuery) => searchPostsPage(textQuery, limit, cursor))),
        Promise.all(textQueries.map((textQuery) => searchPostsByExactTextPage(textQuery, limit, cursor))),
        searchNewsTopicPosts(normalizedTag, limit, cursor),
    ]);

    const mergedPosts = dedupePostsById([
        ...textResults.flatMap((result) => result.posts),
        ...exactTextResults.flatMap((result) => result.posts),
        ...newsResult.posts,
    ]);
    mergedPosts.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateB - dateA;
    });

    const posts = mergedPosts.slice(0, limit);
    const hasMore = textResults.some((result) => result.hasMore)
        || exactTextResults.some((result) => result.hasMore)
        || newsResult.hasMore
        || mergedPosts.length > limit;
    const lastPost = posts[posts.length - 1];
    const nextCursor = hasMore && lastPost?.createdAt
        ? new Date(lastPost.createdAt).toISOString()
        : undefined;
    const totalCount = Math.max(
        posts.length,
        newsResult.totalCount,
        ...textResults.map((result) => result.totalCount),
        ...exactTextResults.map((result) => result.totalCount),
    );

    return {
        posts,
        totalCount,
        hasMore,
        nextCursor,
        query,
        tag: normalizedTag,
    };
}
