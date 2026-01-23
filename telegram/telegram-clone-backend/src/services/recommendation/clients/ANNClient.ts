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
        // Assume endpoint is full URL (e.g. http://host:8000/ann/retrieve)
        // Set baseURL to undefined or empty if we want to use the construct param as full URL? 
        // Better: client is created with baseURL=endpoint.
        // If endpoint is ends with /retrieve, we should post to empty string or /
        const res = await this.client.post('', request, {
            timeout: this.timeoutMs,
        });
        return res.data?.candidates as AnnCandidate[];
    }
}
