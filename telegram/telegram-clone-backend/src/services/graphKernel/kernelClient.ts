import type {
  GraphKernelAuthorCandidate,
  GraphKernelBridgeCandidate,
  GraphKernelNeighborCandidate,
  GraphKernelOverlapCandidate,
} from './contracts';

export interface GraphKernelAuthorCandidateRequest {
  userId: string;
  limit?: number;
  maxDepth?: number;
  excludeUserIds?: string[];
}

export interface GraphKernelNeighborRequest {
  userId: string;
  limit?: number;
  excludeUserIds?: string[];
}

export interface GraphKernelRecentEngagerRequest {
  userId: string;
  limit?: number;
  excludeUserIds?: string[];
}

export interface GraphKernelCoEngagerRequest {
  userId: string;
  limit?: number;
  excludeUserIds?: string[];
}

export interface GraphKernelContentAffinityNeighborRequest {
  userId: string;
  limit?: number;
  excludeUserIds?: string[];
}

export interface GraphKernelBridgeUserRequest {
  userId: string;
  limit?: number;
  maxDepth?: number;
  excludeUserIds?: string[];
}

export interface GraphKernelOverlapRequest {
  userAId: string;
  userBId: string;
  limit?: number;
}

const DEFAULT_GRAPH_KERNEL_URL = 'http://graph_kernel:4300';
const DEFAULT_TIMEOUT_MS = 1200;

export class GraphKernelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async authorCandidates(
    request: GraphKernelAuthorCandidateRequest,
  ): Promise<GraphKernelAuthorCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelAuthorCandidate[] }>(
      '/graph/author-candidates',
      request,
    );
    return payload.candidates || [];
  }

  async neighbors(request: GraphKernelNeighborRequest): Promise<GraphKernelNeighborCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelNeighborCandidate[] }>(
      '/graph/neighbors',
      request,
    );
    return payload.candidates || [];
  }

  async socialNeighbors(
    request: GraphKernelNeighborRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelNeighborCandidate[] }>(
      '/graph/social-neighbors',
      request,
    );
    return payload.candidates || [];
  }

  async recentEngagers(
    request: GraphKernelRecentEngagerRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelNeighborCandidate[] }>(
      '/graph/recent-engagers',
      request,
    );
    return payload.candidates || [];
  }

  async coEngagers(
    request: GraphKernelCoEngagerRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelNeighborCandidate[] }>(
      '/graph/co-engagers',
      request,
    );
    return payload.candidates || [];
  }

  async contentAffinityNeighbors(
    request: GraphKernelContentAffinityNeighborRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelNeighborCandidate[] }>(
      '/graph/content-affinity-neighbors',
      request,
    );
    return payload.candidates || [];
  }

  async bridgeUsers(
    request: GraphKernelBridgeUserRequest,
  ): Promise<GraphKernelBridgeCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelBridgeCandidate[] }>(
      '/graph/bridge-users',
      request,
    );
    return payload.candidates || [];
  }

  async overlap(request: GraphKernelOverlapRequest): Promise<GraphKernelOverlapCandidate[]> {
    const payload = await this.post<{ candidates?: GraphKernelOverlapCandidate[] }>(
      '/graph/overlap',
      request,
    );
    return payload.candidates || [];
  }

  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
        headers: {
          'x-internal-ops-client': 'node-backend',
        },
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-internal-ops-client': 'node-backend',
        },
        body: JSON.stringify(body),
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as { success?: boolean; data?: T; error?: { message?: string } }) : {};

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error?.message || `graph kernel ${response.status}`);
      }

      return (payload.data || {}) as T;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('graph kernel timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let graphKernelClientInstance: GraphKernelClient | null = null;

export function isGraphKernelEnabled(): boolean {
  const value = String(process.env.CPP_GRAPH_KERNEL_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

export function getGraphKernelClient(): GraphKernelClient | null {
  if (!isGraphKernelEnabled()) {
    return null;
  }

  if (!graphKernelClientInstance) {
    graphKernelClientInstance = new GraphKernelClient(
      String(process.env.CPP_GRAPH_KERNEL_URL || DEFAULT_GRAPH_KERNEL_URL).trim(),
      Number.parseInt(String(process.env.CPP_GRAPH_KERNEL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS,
    );
  }

  return graphKernelClientInstance;
}
