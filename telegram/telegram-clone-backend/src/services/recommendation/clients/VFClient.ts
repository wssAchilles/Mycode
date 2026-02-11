import axios, { AxiosInstance } from 'axios';

// ========== 基础类型 (v1 兼容) ==========

export interface VFRequestItem {
    postId: string;
    userId: string;
}

export interface VFResponseItem {
    postId: string;
    safe: boolean;
    reason?: string;
}

// ========== 增强类型 (v2) ==========

export interface VFRequestItemExtended {
    postId: string;
    userId: string;
    /** 帖子内容 (用于完整安全检测) */
    content?: string;
}

export interface VFRequestExtended {
    items: VFRequestItemExtended[];
    /** 是否跳过 ML 检测 (仅使用规则引擎) */
    skipML?: boolean;
}

/**
 * 安全级别
 */
export type SafetyLevel = 'safe' | 'low_risk' | 'medium' | 'high' | 'blocked';

/**
 * 违规类型
 */
export type ViolationType = 
    | 'spam'
    | 'nsfw'
    | 'violence'
    | 'hate_speech'
    | 'harassment'
    | 'misinformation'
    | 'scam'
    | 'illegal'
    | 'self_harm'
    | 'unknown';

export interface VFResponseItemExtended {
    postId: string;
    safe: boolean;
    reason?: string;
    /** 安全级别 */
    level: SafetyLevel;
    /** 风险分数 (0-1) */
    score: number;
    /** 违规类型列表 */
    violations: ViolationType[];
    /** 是否需要人工复审 */
    requiresReview: boolean;
}

// ========== 客户端接口 ==========

export interface VFClient {
    check(items: VFRequestItem[]): Promise<VFResponseItem[]>;
}

export interface VFClientExtended extends VFClient {
    checkExtended(request: VFRequestExtended): Promise<VFResponseItemExtended[]>;
    addToBlacklist(userId: string): Promise<void>;
    removeFromBlacklist(userId: string): Promise<void>;
}

export class VFUnavailableError extends Error {
    cause?: unknown;
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'VFUnavailableError';
        this.cause = cause;
    }
}

// ========== HTTP 客户端实现 ==========

export interface VFClientConfig {
    /** 服务端点 */
    endpoint: string;
    /** 超时时间 (ms) */
    timeoutMs?: number;
    /** 重试次数 */
    retries?: number;
    /** 是否默认使用 v2 API */
    useV2?: boolean;
}

export class HttpVFClient implements VFClientExtended {
    private client: AxiosInstance;
    private config: Required<Omit<VFClientConfig, 'endpoint'>> & { endpoint: string };

    constructor(endpointOrConfig: string | VFClientConfig) {
        if (typeof endpointOrConfig === 'string') {
            this.config = {
                endpoint: endpointOrConfig,
                timeoutMs: 2000,
                retries: 1,
                useV2: false,
            };
        } else {
            this.config = {
                endpoint: endpointOrConfig.endpoint,
                timeoutMs: endpointOrConfig.timeoutMs ?? 2000,
                retries: endpointOrConfig.retries ?? 1,
                useV2: endpointOrConfig.useV2 ?? false,
            };
        }

        this.client = axios.create({
            baseURL: this.config.endpoint,
            timeout: this.config.timeoutMs,
        });
    }

    /**
     * v1 API - 基础安全检测
     */
    async check(items: VFRequestItem[]): Promise<VFResponseItem[]> {
        try {
            const res = await this.client.post(
                '',
                { items },
                { timeout: this.config.timeoutMs }
            );
            const fallbackHeader = (res as any)?.headers?.['x-ml-fallback'] ?? (res as any)?.headers?.['X-ML-Fallback'];
            if (String(fallbackHeader || '').toLowerCase() === 'true') {
                throw new VFUnavailableError('[VFClient] upstream returned fallback response', {
                    headers: (res as any)?.headers,
                });
            }
            return res.data?.results as VFResponseItem[];
        } catch (error: any) {
            throw new VFUnavailableError(`[VFClient] check failed: ${error?.message || error}`, error);
        }
    }

    /**
     * v2 API - 增强安全检测
     */
    async checkExtended(request: VFRequestExtended): Promise<VFResponseItemExtended[]> {
        try {
            // 构造 v2 端点
            const v2Url = this.config.endpoint.replace(/\/vf\/check\/?$/, '/vf/check/v2');
            
            const res = await axios.post(
                v2Url,
                request,
                { timeout: this.config.timeoutMs }
            );
            const fallbackHeader = (res as any)?.headers?.['x-ml-fallback'] ?? (res as any)?.headers?.['X-ML-Fallback'];
            if (String(fallbackHeader || '').toLowerCase() === 'true') {
                throw new VFUnavailableError('[VFClient] upstream returned fallback response', {
                    headers: (res as any)?.headers,
                });
            }
            return res.data?.results as VFResponseItemExtended[];
        } catch (error: any) {
            throw new VFUnavailableError(`[VFClient] checkExtended failed: ${error?.message || error}`, error);
        }
    }

    /**
     * 添加用户到黑名单
     */
    async addToBlacklist(userId: string): Promise<void> {
        try {
            const url = this.config.endpoint.replace(/\/vf\/check\/?$/, '/vf/blacklist/add');
            await axios.post(url, null, {
                params: { user_id: userId },
                timeout: this.config.timeoutMs,
            });
        } catch (error: any) {
            console.error('[VFClient] addToBlacklist failed:', error.message);
        }
    }

    /**
     * 从黑名单移除用户
     */
    async removeFromBlacklist(userId: string): Promise<void> {
        try {
            const url = this.config.endpoint.replace(/\/vf\/check\/?$/, '/vf/blacklist/remove');
            await axios.post(url, null, {
                params: { user_id: userId },
                timeout: this.config.timeoutMs,
            });
        } catch (error: any) {
            console.error('[VFClient] removeFromBlacklist failed:', error.message);
        }
    }
}
