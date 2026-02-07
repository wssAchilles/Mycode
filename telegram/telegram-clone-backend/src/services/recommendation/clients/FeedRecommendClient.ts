import axios, { AxiosInstance } from 'axios';

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
    safe: boolean;
    reason?: string;
}

export interface FeedRecommendResponse {
    requestId: string;
    candidates: FeedRecommendItem[];
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
        const res = await this.client.post('/feed/recommend', request, {
            timeout: this.timeoutMs,
        });
        return res.data as FeedRecommendResponse;
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
