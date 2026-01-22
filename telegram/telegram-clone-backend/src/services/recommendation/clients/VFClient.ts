import axios, { AxiosInstance } from 'axios';

export interface VFRequestItem {
    postId: string;
    userId: string;
}

export interface VFResponseItem {
    postId: string;
    safe: boolean;
    reason?: string;
}

export interface VFClient {
    check(items: VFRequestItem[]): Promise<VFResponseItem[]>;
}

export class HttpVFClient implements VFClient {
    private client: AxiosInstance;
    private timeoutMs: number;

    constructor(endpoint: string, timeoutMs: number = 2000) {
        this.client = axios.create({
            baseURL: endpoint,
            timeout: timeoutMs,
        });
        this.timeoutMs = timeoutMs;
    }

    async check(items: VFRequestItem[]): Promise<VFResponseItem[]> {
        const res = await this.client.post(
            '/check',
            { items },
            { timeout: this.timeoutMs }
        );
        return res.data?.results as VFResponseItem[];
    }
}
