/**
 * ML 推荐系统服务层
 * 对接云端 Phoenix 推荐系统 (Render)
 * 
 * 端点:
 * - /ann/retrieve: Two-Tower ANN 召回 (FAISS)
 * - /phoenix/predict: Phoenix Ranking 排序
 * - /vf/check: 安全内容过滤
 */

import axios from 'axios';

// ========== 配置 ==========
// 从环境变量读取 ML 服务端点 (定义在根目录 .env)
const ANN_ENDPOINT = import.meta.env.VITE_ANN_ENDPOINT ||
    'https://telegram-ml-services.onrender.com/ann/retrieve';
const PHOENIX_ENDPOINT = import.meta.env.VITE_PHOENIX_ENDPOINT ||
    'https://telegram-ml-services.onrender.com/phoenix/predict';
const VF_ENDPOINT = import.meta.env.VITE_VF_ENDPOINT ||
    'https://telegram-ml-services.onrender.com/vf/check';

// ML 服务专用 axios 实例 (不带 Auth 拦截器)
const mlClient = axios.create({
    timeout: 15000, // ML 推理可能较慢
    headers: {
        'Content-Type': 'application/json',
    },
});

// ========== 类型定义 ==========

// ANN 召回
export interface ANNRequest {
    userId: string;
    historyPostIds: string[];
    keywords?: string[];
    topK?: number;
}

export interface ANNCandidate {
    postId: string;
    score: number;
}

export interface ANNResponse {
    candidates: ANNCandidate[];
}

// Phoenix 排序
export interface PhoenixCandidatePayload {
    postId: string;
    authorId?: string;
    inNetwork?: boolean;
    hasVideo?: boolean;
    videoDurationSec?: number;
}

export interface PhoenixRequest {
    userId: string;
    userActionSequence?: Array<{
        actionType: string;
        targetPostId: string;
        timestamp?: number;
    }>;
    candidates: PhoenixCandidatePayload[];
}

export interface PhoenixPrediction {
    postId: string;
    click: number;
    like: number;
    reply: number;
    repost: number;
    profileClick: number;
    share: number;
    dwell: number;
    dismiss: number;
    block: number;
}

export interface PhoenixResponse {
    predictions: PhoenixPrediction[];
}

// 安全检测
export interface VFItem {
    postId: string;
    userId: string;
    content?: string;
}

export interface VFRequest {
    items: VFItem[];
}

export interface VFResult {
    postId: string;
    safe: boolean;
    reason?: string;
}

export interface VFResponse {
    results: VFResult[];
}

// ========== API 服务 ==========

export const mlService = {
    /**
     * ANN 召回 - 基于用户历史行为召回候选内容
     * 用于智能搜索和推荐预召回
     */
    retrieveCandidates: async (request: ANNRequest): Promise<ANNResponse> => {
        try {
            const response = await mlClient.post<ANNResponse>(ANN_ENDPOINT, request);
            return response.data;
        } catch (error) {
            console.error('[ML] ANN 召回失败:', error);
            // 降级: 返回空候选列表
            return { candidates: [] };
        }
    },

    /**
     * Phoenix 排序 - 对候选内容进行精排
     * 预测点击率、点赞率等多目标
     */
    rankCandidates: async (request: PhoenixRequest): Promise<PhoenixResponse> => {
        try {
            const response = await mlClient.post<PhoenixResponse>(PHOENIX_ENDPOINT, request);
            return response.data;
        } catch (error) {
            console.error('[ML] Phoenix 排序失败:', error);
            // 降级: 返回原始顺序，所有概率设为 0.5
            return {
                predictions: request.candidates.map(c => ({
                    postId: c.postId,
                    click: 0.5,
                    like: 0.5,
                    reply: 0.5,
                    repost: 0.5,
                    profileClick: 0.5,
                    share: 0.5,
                    dwell: 0.5,
                    dismiss: 0.5,
                    block: 0.5,
                })),
            };
        }
    },

    /**
     * 安全检测 - 检查内容是否安全
     * 用于发送前检测和内容展示过滤
     */
    checkSafety: async (items: VFItem[]): Promise<VFResponse> => {
        try {
            const response = await mlClient.post<VFResponse>(VF_ENDPOINT, { items });
            return response.data;
        } catch (error) {
            console.error('[ML] 安全检测失败:', error);
            // 降级: 假设所有内容安全 (宽松策略)
            return {
                results: items.map(item => ({
                    postId: item.postId,
                    safe: true,
                    reason: undefined,
                })),
            };
        }
    },

    /**
     * 检查 ML 服务健康状态
     */
    healthCheck: async (): Promise<boolean> => {
        try {
            const baseUrl = ANN_ENDPOINT.replace('/ann/retrieve', '');
            const response = await mlClient.get(`${baseUrl}/health`);
            return response.data?.status === 'ok';
        } catch {
            return false;
        }
    },

    /**
     * 智能内容过滤 (组合调用)
     * 1. ANN 召回 -> 2. VF 安全过滤 -> 3. Phoenix 排序
     */
    getSmartRecommendations: async (
        userId: string,
        historyPostIds: string[],
        topK: number = 20
    ): Promise<PhoenixPrediction[]> => {
        // Step 1: ANN 召回
        const annResult = await mlService.retrieveCandidates({
            userId,
            historyPostIds,
            topK: topK * 2, // 召回更多以便过滤
        });

        if (annResult.candidates.length === 0) {
            return [];
        }

        // Step 2: 安全过滤
        const vfResult = await mlService.checkSafety(
            annResult.candidates.map(c => ({
                postId: c.postId,
                userId,
            }))
        );

        const safeCandidates = annResult.candidates.filter(c => {
            const vfItem = vfResult.results.find(r => r.postId === c.postId);
            return vfItem?.safe !== false;
        });

        if (safeCandidates.length === 0) {
            return [];
        }

        // Step 3: Phoenix 精排
        const phoenixResult = await mlService.rankCandidates({
            userId,
            candidates: safeCandidates.map(c => ({ postId: c.postId })),
        });

        // 按点击概率排序，返回 topK
        return phoenixResult.predictions
            .sort((a, b) => b.click - a.click)
            .slice(0, topK);
    },
};

export default mlService;
