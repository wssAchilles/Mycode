import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

export interface FeedRecommendRequest {
    userId: string;
    limit: number;
    cursor?: string;
    request_id?: string;
    in_network_only?: boolean;
    is_bottom_request?: boolean;
    inNetworkCandidateIds: string[];
    seen_ids: string[];
    served_ids: string[];
}

export interface FeedRecommendItem {
    postId: string;
    score: number;
    inNetwork: boolean;
    phoenixScores?: {
        likeScore?: number;
        replyScore?: number;
        repostScore?: number;
        clickScore?: number;
        profileClickScore?: number;
        shareScore?: number;
        dwellScore?: number;
        dismissScore?: number;
        blockScore?: number;
    };
    safe: boolean;
    reason?: string;
}

export interface FeedRecommendResponse {
    requestId: string;
    candidates: FeedRecommendItem[];
}

const FeedRecommendRequestSchema = z.object({
    userId: z.string().min(1),
    limit: z.number().int().min(0),
    cursor: z.string().optional(),
    request_id: z.string().optional(),
    in_network_only: z.boolean().optional(),
    is_bottom_request: z.boolean().optional(),
    inNetworkCandidateIds: z.array(z.string()),
    seen_ids: z.array(z.string()),
    served_ids: z.array(z.string()),
});

const FeedRecommendItemSchema = z.object({
    postId: z.string().min(1),
    score: z.number().finite(),
    inNetwork: z.boolean(),
    phoenixScores: z
        .object({
            likeScore: z.number().finite().optional(),
            replyScore: z.number().finite().optional(),
            repostScore: z.number().finite().optional(),
            clickScore: z.number().finite().optional(),
            profileClickScore: z.number().finite().optional(),
            shareScore: z.number().finite().optional(),
            dwellScore: z.number().finite().optional(),
            dismissScore: z.number().finite().optional(),
            blockScore: z.number().finite().optional(),
        })
        .optional(),
    safe: z.boolean(),
    reason: z.string().optional(),
});

const FeedRecommendResponseSchema = z.object({
    requestId: z.string().min(1),
    candidates: z.array(FeedRecommendItemSchema),
});

export function parseFeedRecommendResponse(data: unknown): FeedRecommendResponse {
    const parsed = FeedRecommendResponseSchema.safeParse(data);
    if (!parsed.success) {
        // Keep the error compact to avoid flooding logs with large payloads.
        const issues = parsed.error.issues
            .slice(0, 10)
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; ');
        throw new Error(`ml_feed_contract_violation: invalid FeedRecommendResponse (${issues})`);
    }
    return parsed.data as FeedRecommendResponse;
}

export class HttpFeedRecommendClient {
    private client: AxiosInstance;
    private timeoutMs: number;

    constructor(endpoint: string, timeoutMs: number = 4500) {
        this.client = axios.create({
            baseURL: endpoint,
            timeout: timeoutMs,
        });
        this.timeoutMs = timeoutMs;
    }

    async recommend(request: FeedRecommendRequest): Promise<FeedRecommendResponse> {
        const validatedReq = FeedRecommendRequestSchema.safeParse(request);
        if (!validatedReq.success) {
            const issues = validatedReq.error.issues
                .slice(0, 10)
                .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
                .join('; ');
            throw new Error(`ml_feed_contract_violation: invalid FeedRecommendRequest (${issues})`);
        }

        const res = await this.client.post('/feed/recommend', validatedReq.data, {
            timeout: this.timeoutMs,
        });
        return parseFeedRecommendResponse(res.data);
    }
}

export function getDefaultMlServiceBaseUrl(): string {
    return (
        process.env.ML_SERVICE_URL ||
        process.env.ML_SERVICE_BASE_URL ||
        process.env.ML_BASE_URL ||
        'https://telegram-ml-services-22619257282.us-central1.run.app'
    );
}
