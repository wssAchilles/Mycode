import axios, { AxiosInstance } from 'axios';
import { FeedCandidate } from '../types/FeedCandidate';
import { FeedQuery } from '../types/FeedQuery';

export interface PhoenixPrediction {
    /** Candidate identifier used by the Phoenix model (for news: externalId) */
    postId: string;
    like: number;
    reply: number;
    repost: number;
    quote?: number;
    click: number;
    quotedClick?: number;
    photoExpand?: number;
    profileClick: number;
    share: number;
    /** Video quality view (VQV) */
    videoQualityView?: number;
    shareViaDm?: number;
    shareViaCopyLink?: number;
    dwell: number;
    dwellTime?: number;
    followAuthor?: number;

    // Negative actions (naming aligned with x-algorithm where possible)
    notInterested?: number;
    dismiss: number;
    blockAuthor?: number;
    block: number;
    muteAuthor?: number;
    report?: number;
}

export interface PhoenixClient {
    predict(
        userId: string,
        // We may pass a model-specific action sequence where targetPostId is an externalId string.
        // Keep this loose to avoid coupling to Mongo schemas.
        userActionSequence: FeedQuery['modelUserActionSequence'] | FeedQuery['userActionSequence'],
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
        userActionSequence: FeedQuery['modelUserActionSequence'] | FeedQuery['userActionSequence'],
        candidates: FeedCandidate[]
    ): Promise<PhoenixPrediction[]> {
        const payload = {
            userId,
            userActionSequence,
            candidates: candidates.map((c) => ({
                // For news, Phoenix vocab uses externalId (e.g. MIND `N12345`).
                // For social posts, we still send Mongo ids, but PhoenixScorer should not call Phoenix for them by default.
                postId: c.modelPostId ?? c.newsMetadata?.externalId ?? c.postId.toString(),
                authorId: c.authorId,
                inNetwork: c.inNetwork ?? false,
                hasVideo: c.hasVideo ?? false,
                videoDurationSec: c.videoDurationSec,
            })),
        };

        const res = await this.client.post('', payload, {
            timeout: this.timeoutMs,
        });
        return res.data?.predictions as PhoenixPrediction[];
    }
}
