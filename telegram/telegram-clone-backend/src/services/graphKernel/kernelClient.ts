import type {
  GraphKernelAuthorCandidate,
  GraphKernelBridgeCandidate,
  GraphKernelCandidateResponse,
  GraphKernelDiagnostics,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readOptionalBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function parseGraphKernelDiagnostics(payload: unknown): GraphKernelDiagnostics | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const diagnostics: GraphKernelDiagnostics = {};
  const stringKeys: Array<keyof Pick<GraphKernelDiagnostics, 'kernel' | 'snapshotVersion'>> = [
    'kernel',
    'snapshotVersion',
  ];
  const numberKeys: Array<
    keyof Pick<
      GraphKernelDiagnostics,
      | 'queryDurationMs'
      | 'candidateCount'
      | 'requestedLimit'
      | 'availableCount'
      | 'truncatedCount'
      | 'snapshotLoadedAtMs'
      | 'prunedCount'
      | 'frontierMaxSize'
    >
  > = [
    'queryDurationMs',
    'candidateCount',
    'requestedLimit',
    'availableCount',
    'truncatedCount',
    'snapshotLoadedAtMs',
    'prunedCount',
    'frontierMaxSize',
  ];
  const booleanKeys: Array<keyof Pick<GraphKernelDiagnostics, 'budgetExhausted' | 'empty'>> = [
    'budgetExhausted',
    'empty',
  ];

  for (const key of stringKeys) {
    const value = readOptionalString(payload, key);
    if (value !== undefined) {
      diagnostics[key] = value;
    }
  }
  for (const key of numberKeys) {
    const value = readOptionalNumber(payload, key);
    if (value !== undefined) {
      diagnostics[key] = value;
    }
  }
  for (const key of booleanKeys) {
    const value = readOptionalBoolean(payload, key);
    if (value !== undefined) {
      diagnostics[key] = value;
    }
  }

  if (payload.emptyReason === null) {
    diagnostics.emptyReason = null;
  } else {
    const emptyReason = readOptionalString(payload, 'emptyReason');
    if (emptyReason !== undefined) {
      diagnostics.emptyReason = emptyReason;
    }
  }

  if (Array.isArray(payload.relationKinds)) {
    diagnostics.relationKinds = payload.relationKinds
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
  }

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

export function parseGraphKernelCandidateResponse<TCandidate = unknown>(
  payload: unknown,
): GraphKernelCandidateResponse<TCandidate> {
  const source = isRecord(payload) ? payload : {};
  return {
    candidates: Array.isArray(source.candidates)
      ? (source.candidates as TCandidate[])
      : [],
    diagnostics: parseGraphKernelDiagnostics(source.diagnostics),
  };
}

export class GraphKernelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async authorCandidates(
    request: GraphKernelAuthorCandidateRequest,
  ): Promise<GraphKernelAuthorCandidate[]> {
    return (await this.authorCandidatesWithDiagnostics(request)).candidates;
  }

  async authorCandidatesWithDiagnostics(
    request: GraphKernelAuthorCandidateRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelAuthorCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/author-candidates',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelAuthorCandidate>(payload);
  }

  async neighbors(request: GraphKernelNeighborRequest): Promise<GraphKernelNeighborCandidate[]> {
    return (await this.neighborsWithDiagnostics(request)).candidates;
  }

  async neighborsWithDiagnostics(
    request: GraphKernelNeighborRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelNeighborCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/neighbors',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelNeighborCandidate>(payload);
  }

  async socialNeighbors(
    request: GraphKernelNeighborRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    return (await this.socialNeighborsWithDiagnostics(request)).candidates;
  }

  async socialNeighborsWithDiagnostics(
    request: GraphKernelNeighborRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelNeighborCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/social-neighbors',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelNeighborCandidate>(payload);
  }

  async recentEngagers(
    request: GraphKernelRecentEngagerRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    return (await this.recentEngagersWithDiagnostics(request)).candidates;
  }

  async recentEngagersWithDiagnostics(
    request: GraphKernelRecentEngagerRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelNeighborCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/recent-engagers',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelNeighborCandidate>(payload);
  }

  async coEngagers(
    request: GraphKernelCoEngagerRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    return (await this.coEngagersWithDiagnostics(request)).candidates;
  }

  async coEngagersWithDiagnostics(
    request: GraphKernelCoEngagerRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelNeighborCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/co-engagers',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelNeighborCandidate>(payload);
  }

  async contentAffinityNeighbors(
    request: GraphKernelContentAffinityNeighborRequest,
  ): Promise<GraphKernelNeighborCandidate[]> {
    return (await this.contentAffinityNeighborsWithDiagnostics(request)).candidates;
  }

  async contentAffinityNeighborsWithDiagnostics(
    request: GraphKernelContentAffinityNeighborRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelNeighborCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/content-affinity-neighbors',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelNeighborCandidate>(payload);
  }

  async bridgeUsers(
    request: GraphKernelBridgeUserRequest,
  ): Promise<GraphKernelBridgeCandidate[]> {
    return (await this.bridgeUsersWithDiagnostics(request)).candidates;
  }

  async bridgeUsersWithDiagnostics(
    request: GraphKernelBridgeUserRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelBridgeCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/bridge-users',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelBridgeCandidate>(payload);
  }

  async overlap(request: GraphKernelOverlapRequest): Promise<GraphKernelOverlapCandidate[]> {
    return (await this.overlapWithDiagnostics(request)).candidates;
  }

  async overlapWithDiagnostics(
    request: GraphKernelOverlapRequest,
  ): Promise<GraphKernelCandidateResponse<GraphKernelOverlapCandidate>> {
    const payload = await this.post<unknown>(
      '/graph/overlap',
      request,
    );
    return parseGraphKernelCandidateResponse<GraphKernelOverlapCandidate>(payload);
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
