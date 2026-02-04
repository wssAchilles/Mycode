import axios, { AxiosInstance } from 'axios';

export interface AnnCandidate {
    postId: string;
    score: number;
}

export interface AnnRequest {
    userId: string;
    keywords: string[];
    historyPostIds: string[];
    topK: number;
}

export interface AnnClient {
    retrieve(request: AnnRequest): Promise<AnnCandidate[]>;
    healthCheck?(): Promise<AnnHealthStatus>;
}

/**
 * ANN 服务健康状态
 */
export interface AnnHealthStatus {
    status: 'ok' | 'error';
    modelsLoaded: boolean;
    faissEnabled: boolean;
    faissIndexType: string | null;
    latencyMs?: number;
}

/**
 * ANN Client 配置
 */
export interface AnnClientConfig {
    /** 服务端点 */
    endpoint: string;
    /** 超时时间 (ms) */
    timeoutMs?: number;
    /** 重试次数 */
    retries?: number;
    /** 重试延迟 (ms) */
    retryDelayMs?: number;
}

/**
 * HTTP ANN Client - FAISS 加速版
 * 支持健康检查、自动重试、超时控制
 */
export class HttpAnnClient implements AnnClient {
    private client: AxiosInstance;
    private config: Required<AnnClientConfig>;

    constructor(endpointOrConfig: string | AnnClientConfig) {
        if (typeof endpointOrConfig === 'string') {
            this.config = {
                endpoint: endpointOrConfig,
                timeoutMs: 3000,
                retries: 2,
                retryDelayMs: 100,
            };
        } else {
            this.config = {
                endpoint: endpointOrConfig.endpoint,
                timeoutMs: endpointOrConfig.timeoutMs ?? 3000,
                retries: endpointOrConfig.retries ?? 2,
                retryDelayMs: endpointOrConfig.retryDelayMs ?? 100,
            };
        }

        this.client = axios.create({
            baseURL: this.config.endpoint,
            timeout: this.config.timeoutMs,
        });
    }

    /**
     * 健康检查
     */
    async healthCheck(): Promise<AnnHealthStatus> {
        const start = Date.now();
        try {
            // 构造健康检查 URL
            const healthUrl = this.config.endpoint.replace(/\/ann\/retrieve\/?$/, '/health');
            const res = await axios.get(healthUrl, { timeout: 2000 });
            return {
                status: 'ok',
                modelsLoaded: res.data?.models_loaded ?? false,
                faissEnabled: res.data?.faiss_enabled ?? false,
                faissIndexType: res.data?.faiss_index_type ?? null,
                latencyMs: Date.now() - start,
            };
        } catch (error) {
            return {
                status: 'error',
                modelsLoaded: false,
                faissEnabled: false,
                faissIndexType: null,
                latencyMs: Date.now() - start,
            };
        }
    }

    /**
     * ANN 检索 (支持重试)
     */
    async retrieve(request: AnnRequest): Promise<AnnCandidate[]> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.config.retries; attempt++) {
            try {
                const res = await this.client.post('', request, {
                    timeout: this.config.timeoutMs,
                });
                return res.data?.candidates as AnnCandidate[];
            } catch (error: any) {
                lastError = error;
                
                // 如果是最后一次尝试，不再等待
                if (attempt < this.config.retries) {
                    await this.delay(this.config.retryDelayMs * (attempt + 1));
                }
            }
        }

        console.error('[HttpAnnClient] All retries failed:', lastError?.message);
        return [];
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
