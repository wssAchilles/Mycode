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
    isLiked?: boolean;
    isReposted?: boolean;
}

// 分页响应类型
interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        hasMore: boolean;
    };
}

// 转换后端响应为前端类型
const transformPost = (post: PostResponse): PostData => ({
    id: post._id || post.id || '',
    author: {
        id: post.authorId,
        username: post.authorUsername || 'Unknown',
        avatarUrl: post.authorAvatarUrl,
    },
    content: post.content,
    media: post.media as PostMedia[],
    createdAt: new Date(post.createdAt),
    likeCount: post.likeCount || 0,
    commentCount: post.commentCount || 0,
    repostCount: post.repostCount || 0,
    isLiked: post.isLiked || false,
    isReposted: post.isReposted || false,
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
            const params = new URLSearchParams({ limit: String(limit) });
            if (cursor) params.append('cursor', cursor);

            // 后端返回格式: { posts: [...] }
            const response = await apiClient.get<{ posts: PostResponse[] }>(
                `/api/space/feed?${params.toString()}`
            );

            const posts = response.data.posts || [];

            return {
                posts: posts.map(transformPost),
                hasMore: posts.length >= limit,
                nextCursor: posts.length > 0
                    ? posts[posts.length - 1].id
                    : undefined,
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
    ): Promise<{ comments: PostData[]; hasMore: boolean }> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (cursor) params.append('cursor', cursor);

            const response = await apiClient.get<PaginatedResponse<PostResponse>>(
                `/api/space/posts/${postId}/comments?${params.toString()}`
            );

            return {
                comments: response.data.data.map(transformPost),
                hasMore: response.data.pagination.hasMore,
            };
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '获取评论失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 发表评论
     */
    createComment: async (postId: string, content: string): Promise<PostData> => {
        try {
            const response = await apiClient.post<PostResponse>(
                `/api/space/posts/${postId}/comments`,
                { content }
            );
            return transformPost(response.data);
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
    ): Promise<{ posts: PostData[]; hasMore: boolean }> => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (cursor) params.append('cursor', cursor);

            const response = await apiClient.get<PaginatedResponse<PostResponse>>(
                `/api/space/users/${userId}/posts?${params.toString()}`
            );

            return {
                posts: response.data.data.map(transformPost),
                hasMore: response.data.pagination.hasMore,
            };
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || '获取用户帖子失败';
            throw new Error(errorMessage);
        }
    },

    /**
     * 智能推荐 Feed (ML 增强)
     * 使用 Phoenix 排序对原始 Feed 进行精排
     */
    getSmartFeed: async (
        userId: string,
        historyPostIds: string[],
        limit: number = 20
    ): Promise<{ posts: PostData[]; hasMore: boolean; isMLEnhanced: boolean }> => {
        try {
            // 动态导入 mlService 避免循环依赖
            const { mlService } = await import('./mlService');

            // Step 1: 获取原始 Feed (召回更多用于排序)
            const rawFeed = await spaceAPI.getFeed(limit * 2);

            if (rawFeed.posts.length === 0) {
                return { posts: [], hasMore: false, isMLEnhanced: false };
            }

            // Step 2: 使用 Phoenix 精排
            const phoenixResult = await mlService.rankCandidates({
                userId,
                userActionSequence: historyPostIds.slice(0, 10).map(id => ({
                    actionType: 'view',
                    targetPostId: id,
                })),
                candidates: rawFeed.posts.map(p => ({
                    postId: p.id,
                    authorId: p.author.id,
                    inNetwork: false, // 可扩展：判断是否关注
                    hasVideo: p.media?.some(m => m.type === 'video') || false,
                })),
            });

            // Step 3: 按 Phoenix 预测分数重排序
            const scoreMap = new Map(
                phoenixResult.predictions.map(p => [p.postId, p.click + p.like * 0.5])
            );

            const sortedPosts = [...rawFeed.posts]
                .sort((a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0))
                .slice(0, limit);

            return {
                posts: sortedPosts,
                hasMore: rawFeed.hasMore,
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
        userId: string,
        keywords: string[],
        historyPostIds: string[],
        limit: number = 20
    ): Promise<{ posts: PostData[]; isMLEnhanced: boolean }> => {
        try {
            // 动态导入 mlService 避免循环依赖
            const { mlService } = await import('./mlService');

            // Step 1: ANN 召回
            const annResult = await mlService.retrieveCandidates({
                userId,
                historyPostIds,
                keywords,
                topK: limit * 2,
            });

            if (annResult.candidates.length === 0) {
                return { posts: [], isMLEnhanced: true };
            }

            // Step 2: VF 安全过滤
            const vfResult = await mlService.checkSafety(
                annResult.candidates.map(c => ({ postId: c.postId, userId }))
            );

            const safePostIds = annResult.candidates
                .filter(c => {
                    const vf = vfResult.results.find(r => r.postId === c.postId);
                    return vf?.safe !== false;
                })
                .slice(0, limit)
                .map(c => c.postId);

            if (safePostIds.length === 0) {
                return { posts: [], isMLEnhanced: true };
            }

            // Step 3: 批量获取帖子详情
            const posts = await Promise.all(
                safePostIds.map(id =>
                    spaceAPI.getPost(id).catch(() => null)
                )
            );

            return {
                posts: posts.filter((p): p is PostData => p !== null),
                isMLEnhanced: true,
            };
        } catch (error) {
            console.warn('[ML] 智能搜索失败:', error);
            return { posts: [], isMLEnhanced: false };
        }
    },
};

export default spaceAPI;
