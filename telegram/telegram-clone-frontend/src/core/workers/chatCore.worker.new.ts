/**
 * ChatCore Worker — refactored entry point using modular architecture.
 *
 * This file demonstrates how the original 4894-line worker can be reduced to
 * ~200 lines by delegating to the extracted modules:
 * - messageAssembler.ts
 * - socketBridge.ts
 * - persistenceBridge.ts
 * - syncEngine.ts
 * - searchBridge.ts
 * - realtimeIngest.ts
 *
 * NOTE: This is a reference implementation. The original chatCore.worker.ts
 * should be refactored incrementally with proper testing.
 */

import * as Comlink from 'comlink';
import type {
  ChatCoreApi,
  ChatCoreInit,
  ChatPatch,
  ChatPrefetchTarget,
  ChatCoreRuntimeInfo,
  ChatSyncPhase,
  LoadSeq,
  SocketMessageSendAck,
  SocketMessageSendPayload,
} from '../chat/types';
import type { Message } from '../../types/chat';
import type { SocketRealtimeEvent } from '../chat/realtime';
import {
  createDefaultRealtimeBootstrap,
  normalizeRealtimeBootstrap,
  shouldUseSocketIoCompat,
  type RealtimeBootstrapContract,
} from '../chat/realtimeBootstrap';
import { runtimeFlags } from '../chat/runtimeFlags';

// Import new modules
import { SocketBridge, type SocketBridgeContext } from './chatCore/socketBridge';
import { PersistenceBridge, type PersistenceBridgeContext } from './chatCore/persistenceBridge';
import { SyncEngine, type SyncEngineContext } from './chatCore/syncEngine';
import { SearchBridge, type SearchBridgeContext } from './chatCore/searchBridge';
import { RealtimeIngest, type RealtimeIngestContext } from './chatCore/realtimeIngest';
import { normalizeSyncMessages } from './chatCore/messageAssembler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FetchPaging = { hasMore: boolean; nextBeforeSeq: number | null; nextAfterSeq?: number | null };
type FetchCursor = { beforeSeq?: number; afterSeq?: number; limit?: number };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_CACHE_LIMIT = 30;
const PREFETCH_NETWORK_COOLDOWN_MS = 25_000;
const PREFETCH_MAX_IN_FLIGHT = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let apiBaseUrl = '';
let accessToken: string | null = null;
let currentUserId: string | null = null;
let isInited = false;

let socketConnected = true;
let syncPts = 0;
let syncPhase: ChatSyncPhase = 'idle';

let realtimeBootstrap: RealtimeBootstrapContract = createDefaultRealtimeBootstrap();

const telemetry = {
  updatedAt: Date.now(),
  patchQueuePeak: 0,
  patchDispatchCount: 0,
  patchDroppedAsStale: 0,
  patchDroppedByBackpressure: 0,
  realtimeQueuePeak: 0,
  realtimeBatchesEnqueued: 0,
  realtimeBatchesProcessed: 0,
  realtimeEventsProcessed: 0,
  realtimeQueueDropped: 0,
  socketConnects: 0,
  socketConnectErrors: 0,
  connectivityTransitions: 0,
  connectivityFlapEvents: 0,
  gapRecoverSkippedInFlight: 0,
  gapRecoverSkippedFlapping: 0,
  gapRecoverSkippedBudget: 0,
  gapRecoverSkippedCooldown: 0,
  syncPtsRegressionBlocked: 0,
};

function markTelemetryUpdate() {
  telemetry.updatedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Module instances
// ---------------------------------------------------------------------------

// Create context objects for each module
const socketBridgeCtx: SocketBridgeContext = {
  getAccessToken: () => accessToken,
  getApiBaseUrl: () => apiBaseUrl,
  getIsInited: () => isInited,
  getCurrentUserId: () => currentUserId,
  getWorkerSocketEnabled: () => runtimeFlags.workerSocketEnabled,
  telemetry,
  markTelemetryUpdate,
  setSyncPhase: (phase, reason) => {
    syncPhase = phase as ChatSyncPhase;
  },
  stopSyncLoop: () => {
    // TODO: Implement
  },
  requestReadSyncFlush: (delayMs) => {
    // TODO: Implement
  },
  setConnectivityFromSocket: (connected, reason) => {
    socketConnected = connected;
  },
  enqueueRealtimeEventsForIngest: (events, source) => {
    realtimeIngest.enqueueRealtimeEventsForIngest(events, source);
  },
  desiredJoinedRooms: new Set(),
  setSyncAuthError: (error) => {
    // TODO: Implement
  },
  setSocketConnected: (connected) => {
    socketConnected = connected;
  },
  setWorkerSocketAuthBlocked: (blocked) => {
    // TODO: Implement
  },
};

const persistenceBridgeCtx: PersistenceBridgeContext = {
  getApiBaseUrl: () => apiBaseUrl,
  getCurrentUserId: () => currentUserId,
  getStorageBackendPreference: () => runtimeFlags.storageBackend,
  getStorageShadowIdbEnabled: () => runtimeFlags.storageShadowIdb,
  getStorageShadowReadCompareEnabled: () => runtimeFlags.storageShadowReadCompare,
  getStorageShadowReadCompareSampleRate: () => runtimeFlags.storageShadowReadCompareSampleRate,
  getStorageMigrationEnabled: () => runtimeFlags.storageMigrationEnabled,
  getStorageMigrationBatchSize: () => runtimeFlags.storageMigrationBatchSize,
};

const syncEngineCtx: SyncEngineContext = {
  getApiBaseUrl: () => apiBaseUrl,
  getSyncPts: () => syncPts,
  setSyncPts: (pts) => {
    syncPts = pts;
  },
  getSyncPhase: () => syncPhase,
  setSyncPhase: (phase, reason) => {
    syncPhase = phase;
  },
  telemetry,
  markTelemetryUpdate,
};

const searchBridgeCtx: SearchBridgeContext = {
  getApiBaseUrl: () => apiBaseUrl,
  getCurrentUserId: () => currentUserId,
  getWasmApiRef: () => null, // TODO: Implement
  telemetry,
  markTelemetryUpdate,
};

const realtimeIngestCtx: RealtimeIngestContext = {
  telemetry,
  markTelemetryUpdate,
  emitPatch: (patch) => {
    // TODO: Implement patch dispatch
  },
  processSyncPayload: async (updates, messages, pts) => {
    // TODO: Implement
  },
  applyReadReceipt: (chatId, seq, readCount, senderUserId) => {
    // TODO: Implement
  },
  processGroupUpdateEvent: async (raw) => {
    // TODO: Implement
  },
};

// Create module instances
const socketBridge = new SocketBridge(socketBridgeCtx);
const persistenceBridge = new PersistenceBridge(persistenceBridgeCtx);
const syncEngine = new SyncEngine(syncEngineCtx);
const searchBridge = new SearchBridge(searchBridgeCtx);
const realtimeIngest = new RealtimeIngest(realtimeIngestCtx);

// ---------------------------------------------------------------------------
// API implementation
// ---------------------------------------------------------------------------

const api: ChatCoreApi = {
  async init(options: ChatCoreInit) {
    apiBaseUrl = options.apiBaseUrl;
    accessToken = options.accessToken;
    currentUserId = options.userId;
    isInited = true;

    // Initialize persistence
    await persistenceBridge.init();

    // Load sync pts
    syncPts = await persistenceBridge.loadSyncPts(currentUserId);

    // Connect socket if enabled
    if (options.enableWorkerSocket) {
      await socketBridge.connectWorkerSocketInternal();
    }
  },

  async subscribePresence(userIds: string[]) {
    await socketBridge.subscribePresence(userIds);
  },

  async subscribe(patchHandler: (patches: ChatPatch[]) => void) {
    // TODO: Implement patch subscription
  },

  async loadChat(chatId: string, isGroup: boolean, cursor?: FetchCursor) {
    // TODO: Implement using persistenceBridge
    return { messages: [], paging: { hasMore: false, nextBeforeSeq: null } };
  },

  async sendMessage(payload: SocketMessageSendPayload): Promise<SocketMessageSendAck> {
    // TODO: Implement using socketBridge
    return { success: false, error: 'NOT_IMPLEMENTED' };
  },

  async searchMessages(chatId: string, isGroup: boolean, query: string, limit: number): Promise<Message[]> {
    // TODO: Implement using searchBridge
    return [];
  },

  async resolveMessages(chatId: string, isGroup: boolean, ids: string[]): Promise<Message[]> {
    return persistenceBridge.loadByIds(ids);
  },

  async getRuntimeInfo(): Promise<ChatCoreRuntimeInfo> {
    return {
      isInited,
      socketConnected,
      syncPts,
      syncPhase,
      telemetry: { ...telemetry },
    };
  },

  async prefetchChats(targets: ChatPrefetchTarget[]) {
    // TODO: Implement
  },

  async disconnect() {
    socketBridge.detachWorkerSocket();
    isInited = false;
  },
};

// ---------------------------------------------------------------------------
// Comlink exposure
// ---------------------------------------------------------------------------

Comlink.expose(api);
