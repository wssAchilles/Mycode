import axios, { AxiosInstance } from 'axios';
import { createChildLogger } from '../../../utils/logger';
import type { EmbeddingContract } from '../contracts/embeddingContract';

const log = createChildLogger('services:recommendation:sidEncoderClient');

const DEFAULT_ML_SERVICE_URL = 'https://telegram-ml-services-22619257282.us-central1.run.app';

export interface SidEncodeInputItem {
    postId: string;
    content: string;
    title?: string;
    keywords?: string[];
}

export interface SidEncodeResultItem {
    postId: string;
    semanticIds: number[];
    semanticIdsU64?: string;
    embedding256d: number[];
    embeddingContract: EmbeddingContract;
}

export interface SidEncoderClientConfig {
    baseUrl?: string;
    timeoutMs?: number;
}

/**
 * 判断 6x256 SID 数组是否合法有效
 */
export function isValidSemanticIdTuple(sids: unknown): sids is number[] {
    return (
        Array.isArray(sids)
        && sids.length === 6
        && sids.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    );
}

/**
 * 非阻塞调用 Cloud Run /sid/encode 实时获取帖子 V3 语义 ID 与 256d 向量
 */
export class SidEncoderClient {
    private readonly client: AxiosInstance;
    private readonly baseUrl: string;

    constructor(config: SidEncoderClientConfig = {}) {
        this.baseUrl = (config.baseUrl || process.env.ML_SERVICE_URL || DEFAULT_ML_SERVICE_URL).replace(/\/+$/, '');
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: config.timeoutMs ?? 15000,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    async encodeBatch(items: SidEncodeInputItem[]): Promise<SidEncodeResultItem[]> {
        if (!items || items.length === 0) {
            return [];
        }

        const payload = {
            items: items.map((item) => ({
                postId: item.postId,
                content: item.content || '',
                ...(item.title ? { title: item.title } : {}),
                keywords: Array.isArray(item.keywords) ? item.keywords : [],
            })),
        };

        const maxAttempts = 2;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const resp = await this.client.post<{ results?: unknown[] }>('/sid/encode', payload);
                const rawResults = Array.isArray(resp.data?.results) ? resp.data.results : [];
                const validResults: SidEncodeResultItem[] = [];

                for (const raw of rawResults) {
                    if (!raw || typeof raw !== 'object') continue;
                    const entry = raw as Record<string, unknown>;
                    const postId = String(entry.postId || '').trim();
                    const semanticIds = entry.semanticIds;
                    const embedding256d = entry.embedding256d;
                    const contract = entry.embeddingContract as EmbeddingContract | undefined;

                    if (
                        !postId
                        || !isValidSemanticIdTuple(semanticIds)
                        || !Array.isArray(embedding256d)
                        || embedding256d.length !== 256
                        || !embedding256d.every((v) => typeof v === 'number' && Number.isFinite(v))
                        || !contract
                    ) {
                        continue;
                    }

                    validResults.push({
                        postId,
                        semanticIds,
                        semanticIdsU64: entry.semanticIdsU64 != null ? String(entry.semanticIdsU64) : undefined,
                        embedding256d,
                        embeddingContract: contract,
                    });
                }

                return validResults;
            } catch (err: any) {
                const isLast = attempt === maxAttempts;
                log.warn(
                    { err: err?.message || String(err), batchSize: items.length, endpoint: this.baseUrl, attempt },
                    '[SidEncoderClient] /sid/encode request failed',
                );
                if (!isLast) {
                    await new Promise((r) => setTimeout(r, 800));
                }
            }
        }
        return [];
    }
}

export const sidEncoderClient = new SidEncoderClient();
