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

// ==========================================
// Service Implementation
// ==========================================

// Environment variables with fallbacks to Render URL
const ANN_ENDPOINT = import.meta.env.VITE_ANN_ENDPOINT || 'https://telegram-ml-services.onrender.com/ann/retrieve';
const PHOENIX_ENDPOINT = import.meta.env.VITE_PHOENIX_ENDPOINT || 'https://telegram-ml-services.onrender.com/phoenix/predict';
const VF_ENDPOINT = import.meta.env.VITE_VF_ENDPOINT || 'https://telegram-ml-services.onrender.com/vf/check';

// Helper for float type in TS (just number)
type float = number;

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
            const response = await axios.post<ANNResponse>(ANN_ENDPOINT, payload, { timeout: 5000 });
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
            const response = await axios.post<PhoenixResponse>(PHOENIX_ENDPOINT, payload, { timeout: 5000 });
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
            const response = await axios.post<VFResponse>(VF_ENDPOINT, payload, { timeout: 5000 });

            if (response.data.results && response.data.results.length > 0) {
                const result = response.data.results[0];
                if (!result.safe) {
                    console.warn(`[ML] Content flagged as unsafe: ${result.reason}`);
                }
                return result.safe;
            }
            return true; // Default safe if no result
        } catch (error) {
            console.error('❌ [ML] VF Check Failed:', error);
            return true; // Fail safe: allow content if check fails (open policy) or false (strict)
        }
    },

    /**
         * Get Smart Replies
         * Generates context-aware reply suggestions using backend AI service
         */
    getSmartReplies: async (message: string, context: any[] = []): Promise<string[]> => {
        try {
            // Use the main backend URL, not the ML service URL
            const BACKEND_URL = import.meta.env.VITE_API_URL || 'https://telegram-clone-backend-88ez.onrender.com/api';
            const response = await axios.post(`${BACKEND_URL}/ai/smart-replies`, {
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
