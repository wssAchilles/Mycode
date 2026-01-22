import axios, { AxiosInstance } from 'axios';
import { FeedCandidate } from '../types/FeedCandidate';
import { FeedQuery } from '../types/FeedQuery';

export interface PhoenixPrediction {
    like: number;
    reply: number;
    repost: number;
    click: number;
    profileClick: number;
    share: number;
    dwell: number;
    dismiss: number;
    block: number;
}

export interface PhoenixClient {
    predict(
        userId: string,
        userActionSequence: FeedQuery['userActionSequence'],
        candidates: FeedCandidate[]
    ): Promise<PhoenixPrediction[]>;
}

/**
 * HTTP Phoenix Client
 * 依赖环境变量 PHOENIX_ENDPOINT (POST)
 * 请求体结构可按实际服务调整
 */
export class HttpPhoenixClient implements PhoenixClient {
    private client: AxiosInstance;
    private timeoutMs: number;

    constructor(endpoint: string, timeoutMs: number = 2000) {
        this.client = axios.create({
            baseURL: endpoint,
            timeout: timeoutMs,
        });
        this.timeoutMs = timeoutMs;
    }

    async predict(
        userId: string,
        userActionSequence: FeedQuery['userActionSequence'],
        candidates: FeedCandidate[]
    ): Promise<PhoenixPrediction[]> {
        const payload = {
            userId,
            userActionSequence,
            candidates: candidates.map((c) => ({
                postId: c.postId.toString(),
                authorId: c.authorId,
                inNetwork: c.inNetwork ?? false,
                hasVideo: c.hasVideo ?? false,
                videoDurationSec: c.videoDurationSec,
            })),
        };

        const res = await this.client.post('/predict', payload, {
            timeout: this.timeoutMs,
        });
        return res.data?.predictions as PhoenixPrediction[];
    }
}
