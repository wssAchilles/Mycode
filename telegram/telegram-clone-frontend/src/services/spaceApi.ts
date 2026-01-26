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
                return { posts: [], isMLEnhanced: true };
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
