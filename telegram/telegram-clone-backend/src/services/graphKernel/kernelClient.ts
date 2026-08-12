import type {
  GraphKernelAuthorCandidate,
  GraphKernelBatchQueryDiagnostics,
  GraphKernelBatchQueryResult,
  GraphKernelBatchResponse,
  GraphKernelBridgeCandidate,
  GraphKernelCandidateResponse,
  GraphKernelDiagnostics,
  GraphKernelNeighborCandidate,
  GraphKernelOverlapCandidate,
} from './contracts';

export type GraphKernelBatchMode = 'disabled' | 'shadow_compare';

export interface GraphKernelBatchRequest {
  userId: string;
  directLimit: number;
  bridgeLimit: number;
  maxDepth: number;
  excludeUserIds?: string[];
}

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

export function parseGraphKernelBatchMode(value: unknown): GraphKernelBatchMode {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['shadow', 'compare', 'shadow_compare'].includes(normalized)
    ? 'shadow_compare'
    : 'disabled';
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
      | 'scannedCount'
      | 'visitedCount'
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
    'scannedCount',
    'visitedCount',
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

function requireBatchString(
  source: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`graph kernel batch invalid ${context}: ${key} must be a non-empty string`);
  }
  return value;
}

function requireBatchNumber(
  source: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `graph kernel batch invalid ${context}: ${key} must be a non-negative safe integer`,
    );
  }
  return value;
}

function requireBatchSnapshotTimestamp(
  source: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = requireBatchNumber(source, key, context);
  if (value === 0) {
    throw new Error(
      `graph kernel batch invalid ${context}: ${key} must be a positive safe integer`,
    );
  }
  return value;
}

function requireBatchBoolean(
  source: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new Error(`graph kernel batch invalid ${context}: ${key} must be a boolean`);
  }
  return value;
}

function validateNeighborCandidate(candidate: unknown): candidate is GraphKernelNeighborCandidate {
  if (!isRecord(candidate)) {
    return false;
  }
  if (typeof candidate.userId !== 'string' || candidate.userId.trim().length === 0) {
    return false;
  }
  if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score)) {
    return false;
  }
  for (const key of ['interactionProbability', 'engagementScore', 'recentnessScore']) {
    const value = candidate[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      return false;
    }
  }
  return candidate.relationKinds === undefined
    || (Array.isArray(candidate.relationKinds)
      && candidate.relationKinds.every((value) => typeof value === 'string'));
}

function validateBridgeCandidate(candidate: unknown): candidate is GraphKernelBridgeCandidate {
  if (!isRecord(candidate)
    || typeof candidate.userId !== 'string'
    || candidate.userId.trim().length === 0
    || typeof candidate.score !== 'number'
    || !Number.isFinite(candidate.score)
    || !Number.isSafeInteger(candidate.depth)
    || Number(candidate.depth) < 0
    || !Number.isSafeInteger(candidate.pathCount)
    || Number(candidate.pathCount) < 0
    || !Array.isArray(candidate.viaUserIds)
    || !candidate.viaUserIds.every(
      (value) => typeof value === 'string' && value.trim().length > 0,
    )) {
    return false;
  }
  if (candidate.bridgeStrength !== undefined
    && (typeof candidate.bridgeStrength !== 'number'
      || !Number.isFinite(candidate.bridgeStrength))) {
    return false;
  }
  return candidate.viaUserCount === undefined
    || (Number.isSafeInteger(candidate.viaUserCount) && Number(candidate.viaUserCount) >= 0);
}

function parseStrictBatchDiagnostics(
  payload: unknown,
  context: string,
  expectedKernel: string,
  snapshotVersion: string,
  snapshotLoadedAtMs: number,
): GraphKernelBatchQueryDiagnostics {
  if (!isRecord(payload)) {
    throw new Error(`graph kernel batch invalid ${context}: diagnostics are required`);
  }
  const kernel = requireBatchString(payload, 'kernel', context);
  if (kernel !== expectedKernel) {
    throw new Error(`graph kernel batch invalid ${context}: kernel mismatch`);
  }
  const diagnosticsSnapshotVersion = requireBatchString(payload, 'snapshotVersion', context);
  const diagnosticsSnapshotLoadedAtMs = requireBatchSnapshotTimestamp(
    payload,
    'snapshotLoadedAtMs',
    context,
  );
  if (diagnosticsSnapshotVersion !== snapshotVersion
    || diagnosticsSnapshotLoadedAtMs !== snapshotLoadedAtMs) {
    throw new Error(`graph kernel batch invalid ${context}: snapshot identity mismatch`);
  }
  const emptyReason = payload.emptyReason;
  if (emptyReason !== null && typeof emptyReason !== 'string') {
    throw new Error(`graph kernel batch invalid ${context}: emptyReason must be string or null`);
  }
  if (!Array.isArray(payload.relationKinds)
    || !payload.relationKinds.every((value) => typeof value === 'string')) {
    throw new Error(`graph kernel batch invalid ${context}: relationKinds must be an array`);
  }

  return {
    kernel,
    queryDurationMs: requireBatchNumber(payload, 'queryDurationMs', context),
    candidateCount: requireBatchNumber(payload, 'candidateCount', context),
    requestedLimit: requireBatchNumber(payload, 'requestedLimit', context),
    availableCount: requireBatchNumber(payload, 'availableCount', context),
    truncatedCount: requireBatchNumber(payload, 'truncatedCount', context),
    scannedCount: requireBatchNumber(payload, 'scannedCount', context),
    visitedCount: requireBatchNumber(payload, 'visitedCount', context),
    snapshotVersion: diagnosticsSnapshotVersion,
    snapshotLoadedAtMs: diagnosticsSnapshotLoadedAtMs,
    prunedCount: requireBatchNumber(payload, 'prunedCount', context),
    frontierMaxSize: requireBatchNumber(payload, 'frontierMaxSize', context),
    budgetExhausted: requireBatchBoolean(payload, 'budgetExhausted', context),
    empty: requireBatchBoolean(payload, 'empty', context),
    emptyReason,
    relationKinds: payload.relationKinds as string[],
  };
}

function parseStrictBatchResult<TCandidate>(
  payload: unknown,
  context: string,
  expectedKernel: string,
  snapshotVersion: string,
  snapshotLoadedAtMs: number,
  validateCandidate: (candidate: unknown) => candidate is TCandidate,
): GraphKernelBatchQueryResult<TCandidate> {
  if (!isRecord(payload)) {
    throw new Error(`graph kernel batch missing kernel response: ${context}`);
  }
  if (!Array.isArray(payload.candidates)) {
    throw new Error(`graph kernel batch invalid ${context}: candidates must be an array`);
  }
  const candidates = payload.candidates.map((candidate, index) => {
    if (!validateCandidate(candidate)) {
      throw new Error(`graph kernel batch invalid ${context} candidate at index ${index}`);
    }
    return candidate;
  });
  const diagnostics = parseStrictBatchDiagnostics(
    payload.diagnostics,
    context,
    expectedKernel,
    snapshotVersion,
    snapshotLoadedAtMs,
  );
  if (diagnostics.candidateCount !== candidates.length) {
    throw new Error(`graph kernel batch invalid ${context}: candidateCount mismatch`);
  }
  if (diagnostics.empty !== (candidates.length === 0)) {
    throw new Error(`graph kernel batch invalid ${context}: empty state mismatch`);
  }
  if (diagnostics.candidateCount > diagnostics.requestedLimit) {
    throw new Error(`graph kernel batch invalid ${context}: candidateCount exceeds requestedLimit`);
  }
  if (diagnostics.availableCount < diagnostics.candidateCount) {
    throw new Error(`graph kernel batch invalid ${context}: availableCount below candidateCount`);
  }
  if (diagnostics.truncatedCount
    !== diagnostics.availableCount - diagnostics.candidateCount) {
    throw new Error(`graph kernel batch invalid ${context}: truncatedCount mismatch`);
  }
  return { candidates, diagnostics };
}

export function parseGraphKernelBatchResponse(
  payload: unknown,
  expectedUserId?: string,
): GraphKernelBatchResponse {
  const source = isRecord(payload) ? payload : {};
  const userId = requireBatchString(source, 'userId', 'response');
  if (expectedUserId !== undefined && userId !== expectedUserId) {
    throw new Error('graph kernel batch invalid response: userId mismatch');
  }
  const snapshotVersion = readOptionalString(source, 'snapshotVersion');
  if (!snapshotVersion || snapshotVersion.trim().length === 0) {
    throw new Error('graph kernel batch missing snapshot identity');
  }
  const snapshotLoadedAtMs = requireBatchSnapshotTimestamp(
    source,
    'snapshotLoadedAtMs',
    'response',
  );

  return {
    userId,
    snapshotVersion,
    snapshotLoadedAtMs,
    socialNeighbors: parseStrictBatchResult<GraphKernelNeighborCandidate>(
      source.socialNeighbors,
      'socialNeighbors',
      'social_neighbors',
      snapshotVersion,
      snapshotLoadedAtMs,
      validateNeighborCandidate,
    ),
    recentEngagers: parseStrictBatchResult<GraphKernelNeighborCandidate>(
      source.recentEngagers,
      'recentEngagers',
      'recent_engagers',
      snapshotVersion,
      snapshotLoadedAtMs,
      validateNeighborCandidate,
    ),
    bridgeUsers: parseStrictBatchResult<GraphKernelBridgeCandidate>(
      source.bridgeUsers,
      'bridgeUsers',
      'bridge_users',
      snapshotVersion,
      snapshotLoadedAtMs,
      validateBridgeCandidate,
    ),
    coEngagers: parseStrictBatchResult<GraphKernelNeighborCandidate>(
      source.coEngagers,
      'coEngagers',
      'co_engagers',
      snapshotVersion,
      snapshotLoadedAtMs,
      validateNeighborCandidate,
    ),
    contentAffinityNeighbors: parseStrictBatchResult<GraphKernelNeighborCandidate>(
      source.contentAffinityNeighbors,
      'contentAffinityNeighbors',
      'content_affinity_neighbors',
      snapshotVersion,
      snapshotLoadedAtMs,
      validateNeighborCandidate,
    ),
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

  async batch(request: GraphKernelBatchRequest): Promise<GraphKernelBatchResponse> {
    const payload = await this.post<unknown>('/graph/batch', request);
    return parseGraphKernelBatchResponse(payload, request.userId);
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
