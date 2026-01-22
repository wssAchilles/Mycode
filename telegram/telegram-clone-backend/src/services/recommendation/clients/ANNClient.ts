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
}

export class HttpAnnClient implements AnnClient {
    private client: AxiosInstance;
    private timeoutMs: number;

    constructor(endpoint: string, timeoutMs: number = 2000) {
        this.client = axios.create({
            baseURL: endpoint,
            timeout: timeoutMs,
        });
        this.timeoutMs = timeoutMs;
    }

    async retrieve(request: AnnRequest): Promise<AnnCandidate[]> {
        const res = await this.client.post('/retrieve', request, {
            timeout: this.timeoutMs,
        });
        return res.data?.candidates as AnnCandidate[];
    }
}
