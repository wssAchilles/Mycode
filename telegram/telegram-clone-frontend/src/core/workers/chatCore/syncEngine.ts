/**
 * Sync engine — pts management, gap detection, difference fetching, sync ACK.
 *
 * Single responsibility: sync protocol state machine.
 * No socket, no persistence writes, no message normalization.
 */

import type { ChatSyncPhase } from '../../chat/types';
import type { RawSyncMessage, RawSyncUpdate } from './messageAssembler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncEngineContext {
  getApiBaseUrl: () => string;
  getSyncPts: () => number;
  setSyncPts: (pts: number) => void;
  getSyncPhase: () => ChatSyncPhase;
  setSyncPhase: (phase: ChatSyncPhase, reason?: string) => void;
  telemetry: Record<string, number>;
  markTelemetryUpdate: () => void;
}

export interface SyncDifferenceResult {
  updates: RawSyncUpdate[];
  messages: RawSyncMessage[];
  statePts: number;
  isLatest: boolean;
}

export interface SyncUpdatesResult {
  updates: RawSyncUpdate[];
  messages: RawSyncMessage[];
  statePts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYNC_POLL_TIMEOUT_MS = 30_000;
const SYNC_DIFF_LIMIT = 100;
const SYNC_PROTOCOL_VERSION = 2;
const SYNC_WATERMARK_FIELD = 'updateId';
const SYNC_HEADER_SERVER_PTS = 'x-sync-server-pts';
const SYNC_HEADER_STATE_PTS = 'x-sync-state-pts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAuthErrorStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function unwrapSuccessData<T = Record<string, unknown>>(json: Record<string, unknown> | null | undefined): T {
  if (!json) return {} as T;
  const data = json.data ?? json;
  return data as T;
}

function readSyncProtocolVersion(input: unknown): number | null {
  if (input == null) return null;
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return v > 0 ? v : null;
}

function readSyncWatermarkField(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  return v || null;
}

function readSyncPts(input: unknown): number | null {
  if (input == null) return null;
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return v >= 0 ? v : null;
}

function raiseSyncContractError(code: string, detail: string): never {
  throw new Error(`SYNC_CONTRACT_VIOLATION:${code}:${detail}`);
}

function assertSyncContract(res: Response, data: Record<string, unknown> | undefined): void {
  const headerVersion = readSyncProtocolVersion(res.headers.get('x-sync-protocol-version'));
  const bodyVersion = readSyncProtocolVersion(data?.protocolVersion);
  const version = headerVersion ?? bodyVersion;
  if (version !== SYNC_PROTOCOL_VERSION) {
    raiseSyncContractError('protocol_version', String(version ?? 'missing'));
  }

  const headerField = readSyncWatermarkField(res.headers.get('x-sync-watermark-field'));
  const bodyField = readSyncWatermarkField(data?.watermarkField);
  const field = headerField ?? bodyField;
  if (field && field !== SYNC_WATERMARK_FIELD) {
    raiseSyncContractError('watermark_field', field);
  }
}

function assertSyncPtsContract(
  scope: string,
  statePts: number | null,
  fromPts: number | null,
  serverPts: number | null,
): void {
  if (statePts == null) {
    raiseSyncContractError('pts_missing', scope);
  }
  if (fromPts != null && statePts < fromPts) {
    raiseSyncContractError('pts_regression', `${scope}:statePts=${statePts}<fromPts=${fromPts}`);
  }
  if (serverPts != null && statePts > serverPts) {
    raiseSyncContractError('pts_ahead', `${scope}:statePts=${statePts}>serverPts=${serverPts}`);
  }
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<{ res: Response; json: Record<string, unknown> | null }> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  return { res, json };
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private syncAckInFlight = false;
  private syncAckPendingPts = 0;
  private syncAckLastSentPts = 0;
  private syncAckLastSentAt = 0;
  private syncAckRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncAckRetryAttempts = 0;
  private syncAckServerLagPts = 0;
  private syncAckAdaptiveMinStep = 8;
  private syncAckAdaptiveMinIntervalMs = 1_500;

  private readonly SYNC_ACK_RETRY_BASE_MS = 1_500;
  private readonly SYNC_ACK_RETRY_MAX_MS = 30_000;
  private readonly SYNC_ACK_RETRY_JITTER_MS = 180;

  constructor(private readonly ctx: SyncEngineContext) {}

  // -------------------------------------------------------------------------
  // Sync state fetch
  // -------------------------------------------------------------------------

  async fetchSyncState(signal: AbortSignal): Promise<number | null> {
    const apiBaseUrl = this.ctx.getApiBaseUrl();
    if (!apiBaseUrl) return null;

    const url = `${apiBaseUrl}/api/sync/state`;
    const { res, json } = await fetchJson(url, { signal });
    if (res.status === 404) return null;
    if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
    if (!res.ok) throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
    const data = unwrapSuccessData(json);
    assertSyncContract(res, data);
    const headerServerPts = readSyncPts(res.headers.get(SYNC_HEADER_SERVER_PTS));
    const headerStatePts = readSyncPts(res.headers.get(SYNC_HEADER_STATE_PTS));
    const bodyPts = readSyncPts(data?.pts ?? data?.updateId);
    const serverPts = headerServerPts ?? bodyPts ?? headerStatePts ?? 0;
    const statePts = headerStatePts ?? bodyPts ?? serverPts;
    assertSyncPtsContract('state', statePts, null, serverPts);
    return statePts;
  }

  // -------------------------------------------------------------------------
  // Sync difference
  // -------------------------------------------------------------------------

  async fetchSyncDifference(fromPts: number, signal: AbortSignal): Promise<SyncDifferenceResult | null> {
    const apiBaseUrl = this.ctx.getApiBaseUrl();
    if (!apiBaseUrl) return null;

    const url = `${apiBaseUrl}/api/sync/difference`;
    const { res, json } = await fetchJson(url, {
      method: 'POST',
      body: JSON.stringify({ pts: fromPts, limit: SYNC_DIFF_LIMIT }),
      signal,
    });
    if (res.status === 404) return null;
    if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
    if (!res.ok) throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
    const data = unwrapSuccessData(json);
    assertSyncContract(res, data);
    const headerServerPts = readSyncPts(res.headers.get(SYNC_HEADER_SERVER_PTS));
    const headerStatePts = readSyncPts(res.headers.get(SYNC_HEADER_STATE_PTS));
    const bodyServerPts = readSyncPts(data?.serverPts);
    const bodyStatePts = readSyncPts(data?.state?.pts ?? data?.state?.updateId);

    const updates = Array.isArray(data?.updates) ? data.updates : [];
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const serverPts = headerServerPts ?? bodyServerPts ?? bodyStatePts ?? fromPts;
    const statePts = headerStatePts ?? bodyStatePts ?? serverPts;
    assertSyncPtsContract('difference', statePts, fromPts, serverPts);
    const isLatest = !!data?.isLatest || statePts >= serverPts;
    return { updates, messages, statePts, isLatest };
  }

  // -------------------------------------------------------------------------
  // Sync updates (long poll)
  // -------------------------------------------------------------------------

  async fetchSyncUpdates(fromPts: number, signal: AbortSignal): Promise<SyncUpdatesResult | null> {
    const apiBaseUrl = this.ctx.getApiBaseUrl();
    if (!apiBaseUrl) return null;

    const params = new URLSearchParams({
      pts: String(fromPts),
      timeout: String(SYNC_POLL_TIMEOUT_MS),
    });
    const url = `${apiBaseUrl}/api/sync/updates?${params.toString()}`;
    const { res, json } = await fetchJson(url, { signal });
    if (res.status === 404) return null;
    if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
    if (!res.ok) throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
    const data = unwrapSuccessData(json);
    assertSyncContract(res, data);
    const headerServerPts = readSyncPts(res.headers.get(SYNC_HEADER_SERVER_PTS));
    const headerStatePts = readSyncPts(res.headers.get(SYNC_HEADER_STATE_PTS));
    const bodyServerPts = readSyncPts(data?.serverPts);
    const bodyStatePts = readSyncPts(data?.state?.pts ?? data?.state?.updateId);

    const updates = Array.isArray(data?.updates) ? data.updates : [];
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const serverPts = headerServerPts ?? bodyServerPts ?? bodyStatePts ?? fromPts;
    const statePts = headerStatePts ?? bodyStatePts ?? serverPts;
    assertSyncPtsContract('updates', statePts, fromPts, serverPts);
    return { updates, messages, statePts };
  }

  // -------------------------------------------------------------------------
  // Sync ACK
  // -------------------------------------------------------------------------

  async commitSyncPts(nextPts: number): Promise<void> {
    const currentPts = this.ctx.getSyncPts();
    if (!Number.isFinite(nextPts)) return;
    if (nextPts < currentPts) {
      this.ctx.telemetry.syncPtsRegressionBlocked += 1;
      this.ctx.markTelemetryUpdate();
      return;
    }
    if (nextPts === currentPts) return;

    this.ctx.setSyncPts(nextPts);
    this.scheduleSyncAck(nextPts);
  }

  cancelSyncAckRetryTimer(): void {
    if (!this.syncAckRetryTimer) return;
    clearTimeout(this.syncAckRetryTimer);
    this.syncAckRetryTimer = null;
  }

  nextSyncAckRetryDelay(attempt: number, overrideDelayMs?: number): number {
    const base = overrideDelayMs ?? this.SYNC_ACK_RETRY_BASE_MS;
    const exponential = base * Math.pow(2, attempt);
    const capped = Math.min(exponential, this.SYNC_ACK_RETRY_MAX_MS);
    const jitter = Math.random() * this.SYNC_ACK_RETRY_JITTER_MS;
    return capped + jitter;
  }

  scheduleSyncAckRetry(delayMs?: number): void {
    this.cancelSyncAckRetryTimer();
    const delay = delayMs ?? this.nextSyncAckRetryDelay(this.syncAckRetryAttempts);
    this.syncAckRetryTimer = setTimeout(() => {
      this.syncAckRetryTimer = null;
      void this.flushSyncAck();
    }, delay);
  }

  refreshSyncAckAdaptivePacing(): void {
    const lag = this.syncAckServerLagPts;
    if (lag >= 128) {
      this.syncAckAdaptiveMinStep = 1;
      this.syncAckAdaptiveMinIntervalMs = 240;
    } else if (lag >= 32) {
      this.syncAckAdaptiveMinStep = 2;
      this.syncAckAdaptiveMinIntervalMs = 700;
    } else {
      this.syncAckAdaptiveMinStep = 8;
      this.syncAckAdaptiveMinIntervalMs = 1_500;
    }
  }

  canFlushSyncAck(targetPts: number, force = false): boolean {
    if (force) return true;
    if (this.syncAckInFlight) return false;

    const now = Date.now();
    const ptsDelta = targetPts - this.syncAckLastSentPts;
    const timeDelta = now - this.syncAckLastSentAt;

    if (ptsDelta >= this.syncAckAdaptiveMinStep) return true;
    if (timeDelta >= this.syncAckAdaptiveMinIntervalMs) return true;
    return false;
  }

  scheduleSyncAck(nextPts: number, force = false): void {
    this.syncAckPendingPts = Math.max(this.syncAckPendingPts, nextPts);
    if (this.canFlushSyncAck(this.syncAckPendingPts, force)) {
      void this.flushSyncAck(force);
    } else if (!this.syncAckRetryTimer) {
      this.scheduleSyncAckRetry(this.syncAckAdaptiveMinIntervalMs);
    }
  }

  async flushSyncAck(force = false): Promise<void> {
    const targetPts = this.syncAckPendingPts;
    if (targetPts <= 0) return;
    if (!this.canFlushSyncAck(targetPts, force)) return;

    this.syncAckInFlight = true;
    try {
      const result = await this.postSyncAck(targetPts);
      if (result.success) {
        this.syncAckLastSentPts = targetPts;
        this.syncAckLastSentAt = Date.now();
        this.syncAckRetryAttempts = 0;
        this.syncAckServerLagPts = result.serverPts != null ? Math.max(0, result.serverPts - targetPts) : 0;
        this.refreshSyncAckAdaptivePacing();
      } else {
        this.syncAckRetryAttempts += 1;
        this.scheduleSyncAckRetry();
      }
    } catch {
      this.syncAckRetryAttempts += 1;
      this.scheduleSyncAckRetry();
    } finally {
      this.syncAckInFlight = false;
    }
  }

  private async postSyncAck(pts: number): Promise<{ success: boolean; serverPts?: number }> {
    const apiBaseUrl = this.ctx.getApiBaseUrl();
    if (!apiBaseUrl) return { success: false };

    const url = `${apiBaseUrl}/api/sync/ack`;
    try {
      const { res, json } = await fetchJson(url, {
        method: 'POST',
        body: JSON.stringify({ pts }),
      });
      if (!res.ok) return { success: false };
      const data = unwrapSuccessData(json);
      const serverPts = readSyncPts(data?.serverPts ?? data?.pts);
      return { success: true, serverPts: serverPts ?? undefined };
    } catch {
      return { success: false };
    }
  }

  // -------------------------------------------------------------------------
  // State accessors
  // -------------------------------------------------------------------------

  getSyncAckLastSentPts(): number {
    return this.syncAckLastSentPts;
  }

  isSyncAckInFlight(): boolean {
    return this.syncAckInFlight;
  }
}
