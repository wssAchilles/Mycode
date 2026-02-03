/**
 * Space API 服务
 * 对接后端 Space Feed 接口
 */

import apiClient from './apiClient';
import type { PostData, PostMedia } from '../components/space';

// 后端帖子响应类型 (MongoDB 返回 _id)
interface PostResponse {
    _id?: string;
    id?: string;
    authorId: string;
    authorUsername?: string;
    authorAvatarUrl?: string;
    content: string;
    media?: {
        type: 'image' | 'video' | 'gif';
        url: string;
        thumbnailUrl?: string;
    }[];
    createdAt: string;
    likeCount?: number;
    commentCount?: number;
    repostCount?: number;
    viewCount?: number;
    isLiked?: boolean;
    isReposted?: boolean;
    isPinned?: boolean;
    isNews?: boolean;
    newsMetadata?: {
        title?: string;
        summary?: string;
        url?: string;
        source?: string;
        clusterId?: number;
    };
}

export interface NewsCluster {
    clusterId: number;
    postId?: string; // Representative post ID
    count: number;
    title: string;
    summary: string;
    source: string;
    coverUrl?: string | null;
    latestAt: string;
}

export interface NewsBriefItem {
    postId: string;
    title: string;
    summary?: string;
    source?: string;
    url?: string;
    coverUrl?: string;
    clusterId?: number;
    createdAt?: string;
}

export interface TrendItem {
    tag: string;
    count: number;
    heat: number;
}

export interface RecommendedUser {
    id: string;
    username: string;
    avatarUrl?: string | null;
    isOnline?: boolean | null;
    reason?: string;
    isFollowed: boolean;
    recentPosts: number;
    engagementScore: number;
}

export interface NotificationItem {
    id: string;
    type: 'like' | 'reply' | 'repost' | 'quote';
    actor: {
        id: string;
        username: string;
        avatarUrl?: string | null;
        isOnline?: boolean | null;
    };
    postId?: string;
    postSnippet?: string;
    createdAt: string;
}

export interface CommentData {
    id: string;
    postId: string;
    content: string;
    author: {
        id: string;
        username: string;
        avatarUrl?: string | null;
        isOnline?: boolean | null;
    };
    likeCount: number;
    parentId?: string;
    replyToUserId?: string;
    createdAt: string;
}

export interface UserProfile {
    id: string;
    username: string;
    avatarUrl?: string | null;
    isOnline?: boolean | null;
    lastSeen?: string | null;
    createdAt?: string | null;
    coverUrl?: string | null;
    stats: {
        posts: number;
        followers: number;
        following: number;
    };
    isFollowed: boolean;
    pinnedPost?: PostData | null;
}

interface UserProfileResponse extends Omit<UserProfile, 'pinnedPost'> {
    pinnedPost?: PostResponse | null;
}

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

const withApiBase = (url?: string | null) => {
    if (!url) return url || null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

// 转换后端响应为前端类型
const transformPost = (post: PostResponse): PostData => ({
    id: post._id || post.id || '',
    author: {
        id: post.authorId,
        username: post.authorUsername || 'Unknown',
        avatarUrl: post.authorAvatarUrl,
    },
    content: post.content,
    media: (post.media || []).map((m) => ({
        ...m,
        url: withApiBase(m.url) || '',
        thumbnailUrl: withApiBase(m.thumbnailUrl || null) || undefined,
    })) as PostMedia[],
    createdAt: new Date(post.createdAt),
    likeCount: post.likeCount || 0,
    commentCount: post.commentCount || 0,
    repostCount: post.repostCount || 0,
    isLiked: post.isLiked || false,
    isReposted: post.isReposted || false,
    isPinned: post.isPinned || false,
    isNews: post.isNews || false,
    newsMetadata: post.newsMetadata,
});

const transformComment = (comment: CommentData): CommentData => ({
    ...comment,
    author: {
        id: comment.author?.id || 'unknown',
        username: comment.author?.username || 'Unknown',
        avatarUrl: comment.author?.avatarUrl,
        isOnline: comment.author?.isOnline,
    },
});


export const spaceAPI = {
    /**
     * 获取推荐 Feed
     */
    getFeed: async (
        limit: number = 20,
        cursor?: string
    ): Promise<{ posts: PostData[]; hasMore: boolean; nextCursor?: string }> => {
        try {
            const params = new URLSearchParams({ limit: String(limit), includeSelf: 'true' });
            if (cursor) params.append('cursor', cursor);

            // 后端返回格式: { posts: [...] }
            const response = await apiClient.get<{ posts: PostResponse[]; hasMore?: boolean; nextCursor?: string }>(
                `/api/space/feed?${params.toString()}`
            );

            const posts = response.data.posts || [];

            return {
                posts: posts.map(transformPost),
                hasMore: response.data.hasMore ?? (posts.length >= limit),
                nextCursor: response.data.nextCursor,
            };
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '获取动态失败';
            throw new Error(errorMessage);
        }
    },


    /**
     * 获取单个帖子详情
     */
    getPost: async (postId: string): Promise<PostData> => {
        try {
            const response = await apiClient.get<PostResponse>(`/api/space/posts/${postId}`);
            return transformPost(response.data);
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '获取帖子失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 创建帖子
     */
    createPost: async (content: string, media?: File[]): Promise<PostData> => {
        try {
            let response;

            if (media && media.length > 0) {
                // 有文件时使用 FormData
                const formData = new FormData();
                formData.append('content', content);
                media.forEach((file) => {
                    formData.append('media', file);
                });

                response = await apiClient.post<PostResponse>('/api/space/posts', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                });
            } else {
                // 无文件时使用 JSON
                response = await apiClient.post<PostResponse>('/api/space/posts', { content });
            }

            // 后端可能不返回 authorUsername，从 localStorage 补充
            const postData = response.data;
            if (!postData.authorUsername) {
                try {
                    const userStr = localStorage.getItem('user');
                    if (userStr) {
                        const user = JSON.parse(userStr);
                        postData.authorUsername = user.username;
                        postData.authorAvatarUrl = user.avatarUrl;
                    }
                } catch { /* ignore */ }
            }

            return transformPost(postData);
        } catch (error: any) {
            const errorMessage = error.response?.data?.error || error.response?.data?.message || '发布失败';
            throw new Error(errorMessage);
        }
    },


    /**
     * 删除帖子
     */
    deletePost: async (postId: string): Promise<void> => {
        try {
            await apiClient.delete(`/api/space/posts/${postId}`);
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '删除失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 点赞帖子
     */
    likePost: async (postId: string): Promise<void> => {
        try {
            await apiClient.post(`/api/space/posts/${postId}/like`);
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '点赞失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 取消点赞
     */
    unlikePost: async (postId: string): Promise<void> => {
        try {
            await apiClient.delete(`/api/space/posts/${postId}/like`);
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '取消点赞失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 转发帖子
     */
    repostPost: async (postId: string): Promise<PostData> => {
        try {
            const response = await apiClient.post<PostResponse>(`/api/space/posts/${postId}/repost`);
            return transformPost(response.data);
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '转发失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 获取帖子评论
     */
    getComments: async (
        postId: string,
        limit: number = 20,
        cursor?: string
    ): Promise<{ comments: CommentData[]; hasMore: boolean; nextCursor?: string }> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (cursor) params.append('cursor', cursor);

            const response = await apiClient.get<{ comments: CommentData[]; hasMore: boolean; nextCursor?: string }>(
                `/api/space/posts/${postId}/comments?${params.toString()}`
            );

            return {
                comments: (response.data.comments || []).map(transformComment),
                hasMore: response.data.hasMore,
                nextCursor: response.data.nextCursor,
            };
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '获取评论失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 发表评论
     */
    createComment: async (postId: string, content: string): Promise<CommentData> => {
        try {
            const response = await apiClient.post<CommentData>(
                `/api/space/posts/${postId}/comments`,
                { content }
            );
            return transformComment(response.data);
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '评论失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 获取用户帖子
     */
    getUserPosts: async (
        userId: string,
        limit: number = 20,
        cursor?: string
    ): Promise<{ posts: PostData[]; hasMore: boolean; nextCursor?: string }> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (cursor) params.append('cursor', cursor);

            const response = await apiClient.get<{ posts: PostResponse[]; hasMore: boolean; nextCursor?: string }>(
                `/api/space/users/${userId}/posts?${params.toString()}`
            );

            return {
                posts: response.data.posts.map(transformPost),
                hasMore: response.data.hasMore,
                nextCursor: response.data.nextCursor,
            };
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '获取用户帖子失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 获取用户点赞列表
     */
    getUserLikes: async (
        userId: string,
        limit: number = 20,
        cursor?: string
    ): Promise<{ posts: PostData[]; hasMore: boolean; nextCursor?: string }> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (cursor) params.append('cursor', cursor);

            const response = await apiClient.get<{ posts: PostResponse[]; hasMore: boolean; nextCursor?: string }>(
                `/api/space/users/${userId}/likes?${params.toString()}`
            );

            return {
                posts: response.data.posts.map(transformPost),
                hasMore: response.data.hasMore,
                nextCursor: response.data.nextCursor,
            };
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '获取点赞列表失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 批量获取帖子 (用于 ML 推荐系统)
     */
    getPostsBatch: async (postIds: string[]): Promise<PostData[]> => {
        if (!postIds || postIds.length === 0) return [];
        try {
            const response = await apiClient.post<{ posts: PostResponse[] }>('/api/space/posts/batch', {
                postIds
            });
            return response.data.posts.map(transformPost);
        } catch (error: any) {
            console.error('批量获取帖子失败:', error);
            return []; // Fail safe
        }
    },

    /**
     * 智能推荐 Feed (Full ML Pipeline)
     * Flow: ANN Recall -> Hydrate Posts -> Phoenix Rank -> Display
     */
    getSmartFeed: async (
        limit: number = 20
    ): Promise<{ posts: PostData[]; hasMore: boolean; isMLEnhanced: boolean }> => {
        try {
            // 动态导入 mlService 避免循环依赖
            const { mlService } = await import('./mlService');
            // const currentUser = authUtils.getCurrentUser();
            // const userId = currentUser?.id || 'anonymous_user';

            // TODO: 获取真实用户历史
            const historyPostIds: string[] = [];

            // Step 1: 召回 (Recall)
            // 获取 100 个候选 ID
            const annCandidates = await mlService.annRetrieve(historyPostIds, [], 100);

            if (annCandidates.length === 0) {
                // 降级: 返回普通 Feed
                const fallback = await spaceAPI.getFeed(limit);
                return { ...fallback, isMLEnhanced: false };
            }

            // Step 2: 补全 (Hydrate)
            // 取前 50 个 ID 进行补全 (避免一次请求太大)
            const topCandidateIds = annCandidates.slice(0, 50).map(c => c.postId);
            const hydratedPosts = await spaceAPI.getPostsBatch(topCandidateIds);

            if (hydratedPosts.length === 0) {
                // 降级
                const fallback = await spaceAPI.getFeed(limit);
                return { ...fallback, isMLEnhanced: false };
            }

            // Step 3: 排序 (Rank)
            // 构建 Phoenix 请求 payload
            const predictionCandidates = hydratedPosts.map(p => ({
                postId: p.id,
                authorId: p.author.id,
                inNetwork: false, // 可扩展
                hasVideo: p.media?.some(m => m.type === 'video') || false,
            }));

            const predictions = await mlService.phoenixRank(predictionCandidates);

            // 构建分数映射
            const scoreMap = new Map();
            predictions.forEach(p => {
                // 简单的加权公式: Click * 1 + Like * 5 + Reply * 10
                const score = (p.click * 1.0) + (p.like * 5.0) + (p.reply * 10.0);
                scoreMap.set(p.postId, score);
            });

            // Step 4: 最终排序
            const sortedPosts = [...hydratedPosts].sort((a, b) => {
                const scoreA = scoreMap.get(a.id) || 0;
                const scoreB = scoreMap.get(b.id) || 0;
                return scoreB - scoreA;
            });

            // 附加推荐理由元数据 (Mock for now, will be used by UI)
            const finalPosts = sortedPosts.slice(0, limit).map(p => ({
                ...p,
                // 我们在 PostData 类型里还没加 recommendationReason字段，
                // 但可以直接附加，React 组件里 cast 一下即可使用
                recommendationReason: {
                    source: 'embedding',
                    detail: '猜你喜欢'
                }
            }));

            return {
                posts: finalPosts,
                hasMore: true, // 智能推荐通常认为是无限流
                isMLEnhanced: true,
            };

        } catch (error) {
            console.warn('[ML] 智能推荐失败，降级到普通 Feed:', error);
            // 降级: 返回普通 Feed
            const fallback = await spaceAPI.getFeed(limit);
            return { ...fallback, isMLEnhanced: false };
        }
    },

    /**
     * 智能搜索 (ANN 召回 + VF 过滤)
     * 使用 ANN 向量检索查找相关内容
     */
    searchPosts: async (
        keywords: string[],
        historyPostIds: string[],
        limit: number = 20
    ): Promise<{ posts: PostData[]; isMLEnhanced: boolean }> => {
        const keywordQuery = keywords.join(' ').trim();
        const fallbackSearch = async () => {
            if (!keywordQuery) return { posts: [], isMLEnhanced: false };
            try {
                const params = new URLSearchParams({ query: keywordQuery, limit: String(limit) });
                const response = await apiClient.get<{ posts: PostResponse[] }>(`/api/space/search?${params.toString()}`);
                return { posts: response.data.posts.map(transformPost), isMLEnhanced: false };
            } catch (error) {
                console.warn('[Search] Fallback search failed:', error);
                return { posts: [], isMLEnhanced: false };
            }
        };

        try {
            // 动态导入 mlService 避免循环依赖
            const { mlService } = await import('./mlService');

            // Step 1: ANN 召回
            // annRetrieve(history, keywords, topK)
            const annCandidates = await mlService.annRetrieve(
                historyPostIds,
                keywords,
                limit * 2
            );

            if (annCandidates.length === 0) {
                return await fallbackSearch();
            }

            // Step 2: VF 安全过滤
            // Serial/Parallel checks using vfCheck(postId)
            const vfChecks = await Promise.all(
                annCandidates.map(async (c) => {
                    const isSafe = await mlService.vfCheck(c.postId);
                    return { postId: c.postId, safe: isSafe };
                })
            );

            const safePostIds = vfChecks
                .filter(r => r.safe)
                .slice(0, limit)
                .map(r => r.postId);

            if (safePostIds.length === 0) {
                return await fallbackSearch();
            }

            // Step 3: 批量获取帖子详情
            const posts = await Promise.all(
                safePostIds.map(id =>
                    spaceAPI.getPost(id).catch(() => null)
                )
            );

            const finalPosts = posts.filter((p): p is PostData => p !== null);
            if (finalPosts.length === 0) {
                return await fallbackSearch();
            }

            return {
                posts: finalPosts,
                isMLEnhanced: true,
            };
        } catch (error) {
            console.warn('[ML] 智能搜索失败:', error);
            return await fallbackSearch();
        }
    },

    /**
     * 获取热门新闻话题
     */
    getNewsTopics: async (): Promise<NewsCluster[]> => {
        try {
            const response = await apiClient.get<{ topics: NewsCluster[] }>('/api/space/news/topics');
            const topics = response.data.topics || [];
            return topics.map((topic) => ({
                ...topic,
                coverUrl: withApiBase(topic.coverUrl) ?? topic.coverUrl,
            }));
        } catch (error) {
            console.error('获取新闻话题失败:', error);
            return [];
        }
    },

    /**
     * 获取新闻简报 (Home 顶部模块)
     */
    getNewsBrief: async (limit: number = 5, sinceHours: number = 24): Promise<NewsBriefItem[]> => {
        try {
            const params = new URLSearchParams({ limit: String(limit), sinceHours: String(sinceHours) });
            const response = await apiClient.get<{ items: NewsBriefItem[] }>(`/api/space/news/brief?${params.toString()}`);
            const items = response.data.items || [];
            return items.map((item) => ({
                ...item,
                coverUrl: withApiBase(item.coverUrl) ?? item.coverUrl,
            }));
        } catch (error) {
            console.error('获取新闻简报失败:', error);
            return [];
        }
    },

    /**
     * 获取新闻列表 (分页)
     */
    getNewsPosts: async (
        limit: number = 20,
        cursor?: string,
        days: number = 1
    ): Promise<{ posts: PostData[]; hasMore: boolean; nextCursor?: string }> => {
        try {
            const params = new URLSearchParams({ limit: String(limit), days: String(days) });
            if (cursor) params.append('cursor', cursor);
            const response = await apiClient.get<{ posts: PostResponse[]; hasMore: boolean; nextCursor?: string }>(
                `/api/space/news/posts?${params.toString()}`
            );
            return {
                posts: response.data.posts.map(transformPost),
                hasMore: response.data.hasMore,
                nextCursor: response.data.nextCursor,
            };
        } catch (error) {
            console.error('获取新闻列表失败:', error);
            return { posts: [], hasMore: false };
        }
    },

    /**
     * 获取话题内新闻
     */
    getNewsClusterPosts: async (clusterId: number, limit: number = 20): Promise<PostData[]> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            const response = await apiClient.get<{ posts: PostResponse[] }>(
                `/api/space/news/cluster/${clusterId}?${params.toString()}`
            );
            return response.data.posts.map(transformPost);
        } catch (error) {
            console.error('获取话题新闻失败:', error);
            return [];
        }
    },

    /**
     * 获取热门话题 (hashtags)
     */
    getTrends: async (limit: number = 6): Promise<TrendItem[]> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            const response = await apiClient.get<{ trends: TrendItem[] }>(`/api/space/trends?${params.toString()}`);
            return response.data.trends || [];
        } catch (error) {
            console.error('获取热门话题失败:', error);
            return [];
        }
    },

    /**
     * 推荐关注用户
     */
    getRecommendedUsers: async (limit: number = 4): Promise<RecommendedUser[]> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            const response = await apiClient.get<{ users: RecommendedUser[] }>(`/api/space/recommend/users?${params.toString()}`);
            return response.data.users || [];
        } catch (error) {
            console.error('获取推荐关注失败:', error);
            return [];
        }
    },

    /**
     * 关注用户
     */
    followUser: async (userId: string): Promise<void> => {
        await apiClient.post(`/api/space/users/${userId}/follow`);
    },

    /**
     * 取消关注用户
     */
    unfollowUser: async (userId: string): Promise<void> => {
        await apiClient.delete(`/api/space/users/${userId}/follow`);
    },

    /**
     * 获取通知列表
     */
    getNotifications: async (
        limit: number = 20,
        cursor?: string
    ): Promise<{ items: NotificationItem[]; hasMore: boolean; nextCursor?: string }> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.append('cursor', cursor);
        const response = await apiClient.get<{ items: NotificationItem[]; hasMore: boolean; nextCursor?: string }>(
            `/api/space/notifications?${params.toString()}`
        );
        return response.data;
    },

    /**
     * 获取用户空间主页信息
     */
    getUserProfile: async (userId: string): Promise<UserProfile> => {
        const response = await apiClient.get<{ profile: UserProfileResponse }>(`/api/space/users/${userId}/profile`);
        const profile = response.data.profile;
        return {
            ...profile,
            coverUrl: withApiBase(profile.coverUrl),
            pinnedPost: profile.pinnedPost ? transformPost(profile.pinnedPost) : null,
        };
    },

    /**
     * 更新空间封面
     */
    updateCover: async (userId: string, file: File): Promise<string | null> => {
        const formData = new FormData();
        formData.append('cover', file);
        const response = await apiClient.put<{ coverUrl: string | null }>(`/api/space/users/${userId}/cover`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data.coverUrl;
    },

    /**
     * 置顶/取消置顶
     */
    pinPost: async (postId: string): Promise<PostData> => {
        const response = await apiClient.post<{ post: PostResponse }>(`/api/space/posts/${postId}/pin`);
        return transformPost(response.data.post);
    },

    unpinPost: async (postId: string): Promise<PostData> => {
        const response = await apiClient.delete<{ post: PostResponse }>(`/api/space/posts/${postId}/pin`);
        return transformPost(response.data.post);
    },
};

export default spaceAPI;
