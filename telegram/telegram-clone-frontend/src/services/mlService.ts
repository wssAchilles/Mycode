import axios from 'axios';
import { authUtils } from './apiClient';

// ==========================================
// Types Definition (Matches app.py Pydantic)
// ==========================================

// --- 1. ANN Retrieval (Recall) ---
export interface ANNRequest {
    userId: string;
    historyPostIds: string[];
    keywords?: string[];
    topK?: number;
}

export interface ANNCandidate {
    postId: string;
    score: float;
}

export interface ANNResponse {
    candidates: ANNCandidate[];
}

// --- 2. Phoenix Ranking (Ranking) ---
export interface PhoenixCandidatePayload {
    postId: string;
    authorId?: string;
    inNetwork?: boolean; // Default False in python
    hasVideo?: boolean;  // Default False in python
    videoDurationSec?: number;
}

export interface PhoenixRequest {
    userId: string;
    userActionSequence?: any[]; // List[dict] in python
    candidates: PhoenixCandidatePayload[];
}

export interface PhoenixPrediction {
    postId: string;
    like: number;
    reply: number;
    repost: number;
    click: number;
    // Others omitted as they are dummy in backend usually
}

export interface PhoenixResponse {
    predictions: PhoenixPrediction[];
}

// --- 3. VF Safety (Vertical Filter) ---
export interface VFItem {
    postId: string;
    userId: string;
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

// --- 3. VF Safety v2 (content-aware) ---
export interface VFItemExtended {
    postId: string;
    userId: string;
    content?: string;
}

export interface VFRequestExtended {
    items: VFItemExtended[];
    skipML?: boolean;
}

export interface VFResultExtended {
    postId: string;
    safe: boolean;
    reason?: string;
    level: string;
    score: number;
    violations: string[];
    requiresReview: boolean;
}

export interface VFResponseExtended {
    results: VFResultExtended[];
}

// ==========================================
// Service Implementation
// ==========================================

// Backend base URL (same as apiClient)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';
const normalizeBase = (value: string) => value.replace(/\/+$/, '');
const parseEnvBool = (value: unknown, fallback = false): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return fallback;
};

const ML_PROXY_BASE = normalizeBase(import.meta.env.VITE_ML_PROXY_URL || `${API_BASE_URL}/api/ml`);
const ALLOW_DIRECT_ML = parseEnvBool(import.meta.env.VITE_ALLOW_DIRECT_ML, false);

const resolveMlEndpoint = (
    directEndpoint: string | undefined,
    proxyPath: string,
    serviceName: string
): string => {
    const proxyEndpoint = `${ML_PROXY_BASE}${proxyPath}`;
    if (!directEndpoint) return proxyEndpoint;
    if (ALLOW_DIRECT_ML) return directEndpoint;
    console.warn(`[ML] ${serviceName} direct endpoint is disabled, fallback to proxy: ${proxyEndpoint}`);
    return proxyEndpoint;
};

// Environment variables with fallbacks to Backend ML Proxy (avoids CORS)
const ANN_ENDPOINT = resolveMlEndpoint(import.meta.env.VITE_ANN_ENDPOINT, '/ann/retrieve', 'ANN');
const PHOENIX_ENDPOINT = resolveMlEndpoint(import.meta.env.VITE_PHOENIX_ENDPOINT, '/phoenix/predict', 'Phoenix');
const VF_ENDPOINT = resolveMlEndpoint(import.meta.env.VITE_VF_ENDPOINT, '/vf/check', 'VF');
const VF_ENDPOINT_V2 = resolveMlEndpoint(import.meta.env.VITE_VF_ENDPOINT_V2, '/vf/check/v2', 'VF v2');

// Helper for float type in TS (just number)
type float = number;

const getAuthHeaders = () => {
    const token = authUtils.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : undefined;
};

const isBenignAbortError = (error: unknown): boolean => {
    if (axios.isAxiosError(error)) {
        const code = String(error.code || '').toUpperCase();
        const message = String(error.message || '').toLowerCase();
        return (
            code === 'ERR_CANCELED' ||
            message.includes('canceled') ||
            message.includes('abort') ||
            message.includes('err_aborted')
        );
    }
    const message = String((error as any)?.message || '').toLowerCase();
    return message.includes('abort') || message.includes('err_aborted');
};

export const mlService = {
    /**
     * Two-Tower ANN Retrieval
     * Retrieves candidate posts based on user history and keywords
     */
    annRetrieve: async (
        historyPostIds: string[] = [],
        keywords: string[] = [],
        topK: number = 20
    ): Promise<ANNCandidate[]> => {
        try {
            const currentUser = authUtils.getCurrentUser();
            const userId = currentUser?.id || 'anonymous_user';

            const payload: ANNRequest = {
                userId,
                historyPostIds,
                keywords: keywords.length > 0 ? keywords : undefined,
                topK
            };

            console.log('🔮 [ML] ANN Request:', payload);
            const response = await axios.post<ANNResponse>(ANN_ENDPOINT, payload, {
                timeout: 5000,
                headers: getAuthHeaders(),
            });
            return response.data.candidates;
        } catch (error) {
            console.error('❌ [ML] ANN Retrieve Failed:', error);
            return []; // Fail safe: return empty list
        }
    },

    /**
     * Phoenix Ranking
     * Ranks a list of candidates using the neural ranking model
     */
    phoenixRank: async (
        candidates: PhoenixCandidatePayload[]
    ): Promise<PhoenixPrediction[]> => {
        try {
            const currentUser = authUtils.getCurrentUser();
            const userId = currentUser?.id || 'anonymous_user';

            // Minimal payload for now, can be expanded with real user action sequence if tracked
            const payload: PhoenixRequest = {
                userId,
                candidates,
                userActionSequence: []
            };

            console.log('⚖️ [ML] Phoenix Rank Request:', payload);
            const response = await axios.post<PhoenixResponse>(PHOENIX_ENDPOINT, payload, {
                timeout: 5000,
                headers: getAuthHeaders(),
            });
            return response.data.predictions;
        } catch (error) {
            console.error('❌ [ML] Phoenix Rank Failed:', error);
            return []; // Fail safe
        }
    },

    /**
     * VF Safety Check
     * Checks if content is safe using the Vertical Filter model
     */
    vfCheck: async (postId: string): Promise<boolean> => {
        try {
            const currentUser = authUtils.getCurrentUser();
            const userId = currentUser?.id || 'anonymous_user';

            const payload: VFRequest = {
                items: [{ postId, userId }]
            };

            console.log('🛡️ [ML] VF Check Request:', payload);
            const response = await axios.post<VFResponse>(VF_ENDPOINT, payload, {
                timeout: 5000,
                headers: getAuthHeaders(),
            });
            // If the backend ML proxy is returning a fallback payload, treat VF as unavailable.
            // Industrial degrade policy for discovery surfaces: fail-closed instead of showing unsafe content.
            const fallbackHeader = (response as any)?.headers?.['x-ml-fallback'] ?? (response as any)?.headers?.['X-ML-Fallback'];
            if (String(fallbackHeader || '').toLowerCase() === 'true') {
                console.warn('[ML] VF proxy fallback detected, treat as unavailable');
                return false;
            }

            if (response.data.results && response.data.results.length > 0) {
                const result = response.data.results[0];
                if (!result.safe) {
                    console.warn(`[ML] Content flagged as unsafe: ${result.reason}`);
                }
                return result.safe;
            }
            return false; // Fail-closed when no decision returned
        } catch (error) {
            if (isBenignAbortError(error)) {
                console.warn('⚠️ [ML] VF Check Aborted by navigation/lifecycle');
                return false;
            }
            console.error('❌ [ML] VF Check Failed:', error);
            // Industrial default for OON/discovery: fail-closed when VF is unavailable.
            return false;
        }
    },

    /**
     * VF Safety Check v2 (content-aware)
     */
    vfCheckContent: async (content: string): Promise<VFResultExtended | null> => {
        try {
            const currentUser = authUtils.getCurrentUser();
            const userId = currentUser?.id || 'anonymous_user';

            const payload: VFRequestExtended = {
                items: [{ postId: `content_${Date.now()}`, userId, content }],
                skipML: true,
            };

            const response = await axios.post<VFResponseExtended>(VF_ENDPOINT_V2, payload, {
                timeout: 5000,
                headers: getAuthHeaders(),
            });
            const fallbackHeader = (response as any)?.headers?.['x-ml-fallback'] ?? (response as any)?.headers?.['X-ML-Fallback'];
            if (String(fallbackHeader || '').toLowerCase() === 'true') {
                console.warn('[ML] VF v2 proxy fallback detected, treat as unavailable');
                return null;
            }

            if (response.data.results && response.data.results.length > 0) {
                return response.data.results[0];
            }
            return null;
        } catch (error) {
            if (isBenignAbortError(error)) {
                console.warn('⚠️ [ML] VF Check v2 Aborted by navigation/lifecycle');
                return null;
            }
            console.error('❌ [ML] VF Check v2 Failed:', error);
            return null;
        }
    },

    /**
         * Get Smart Replies
         * Generates context-aware reply suggestions using backend AI service
         */
    getSmartReplies: async (message: string, context: any[] = []): Promise<string[]> => {
        try {
            // Use the main backend URL, not the ML service URL
            const response = await axios.post(`${API_BASE_URL}/api/ai/smart-replies`, {
                message,
                context
            }, {
                headers: {
                    Authorization: `Bearer ${authUtils.getAccessToken()}`
                }
            });

            if (response.data.success) {
                return response.data.data.suggestions;
            }
            return [];
        } catch (error) {
            console.error('❌ [Smart Reply] Failed to get suggestions:', error);
            return [];
        }
    }
};
