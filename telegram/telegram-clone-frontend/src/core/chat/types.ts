import type { Message } from '../../types/chat';
import type { SocketRealtimeEvent } from './realtime';

export type ChatId = string;
export type LoadSeq = number;
export type ChatPrefetchTarget = { chatId: ChatId; isGroup: boolean };
export type ChatSyncPhase = 'idle' | 'disconnected' | 'catching_up' | 'live' | 'backoff' | 'auth_error';
export const CHAT_CORE_PROTOCOL_VERSION = 2;

export interface ChatCoreRuntimeInfo {
  protocolVersion: number;
  workerBuildId: string;
  runtimePolicy: {
    emergencySafeMode: boolean;
    profile: 'baseline' | 'canary' | 'safe';
    profileLocked?: boolean;
    profileSource?: 'percent_rollout' | 'manual_locked' | 'emergency_safe_mode' | 'default';
    matrixVersion?: string;
  };
  flags: {
    chatMemoryWindow: number;
    wasmSeqOps: boolean;
    wasmRequired: boolean;
    wasmSearchFallback: boolean;
    wasmShadowCompare: boolean;
    wasmShadowCompareSampleRate: number;
    searchTieredIndex: boolean;
    searchTieredWasm: boolean;
    workerSyncFallback: boolean;
    workerQosPatchQueue: boolean;
    workerSocketEnabled: boolean;
    workerSafetyChecks: boolean;
    workerRealtimeBatchSize: number;
    workerRealtimeQueueHardMax: number;
    workerRealtimeQueueWarnAt: number;
    syncDisconnectGraceMs: number;
    syncFlapWindowMs: number;
    syncFlapMaxTransitions: number;
    syncGapRecoverCooldownMs: number;
    syncGapRecoverMaxSteps: number;
    syncGapRecoverStepDelayMs: number;
    syncGapRecoverForceBudgetWindowMs: number;
    syncGapRecoverForceBudgetMax: number;
    syncReconnectMinDisconnectMs: number;
    syncReconnectMinIntervalMs: number;
  };
  wasm: {
    enabled: boolean;
    version: string | null;
    initError: string | null;
  };
  sync: {
    protocolVersion: number;
    watermarkField: string;
    authBlocked: boolean;
    contractValidatedAt: number;
    contractError: string | null;
    contractBackoffUntil: number;
  };
  telemetry: {
    updatedAt: number;
    patchQueuePeak: number;
    patchDispatchCount: number;
    patchDroppedAsStale: number;
    patchDroppedByBackpressure: number;
    realtimeQueuePeak: number;
    realtimeQueueDropped: number;
    realtimeBatchesEnqueued: number;
    realtimeBatchesProcessed: number;
    realtimeEventsProcessed: number;
    trimRuns: number;
    trimRemovedIds: number;
    trimOldestRuns: number;
    trimNewestRuns: number;
    fetchCount: number;
    fetchErrorCount: number;
    syncLoopStarts: number;
    gapRecoverRuns: number;
    gapRecoverSkippedInFlight: number;
    gapRecoverSkippedCooldown: number;
    gapRecoverSkippedSocketConnected: number;
    gapRecoverSkippedBudget: number;
    gapRecoverSkippedFlapping: number;
    syncBackoffRetries: number;
    reconnectGapRecoverRuns: number;
    reconnectGapRecoverSkippedShortDisconnect: number;
    reconnectGapRecoverSkippedMinInterval: number;
    connectivityTransitions: number;
    connectivityFlapEvents: number;
    syncAckSent: number;
    syncAckErrors: number;
    syncAckRetries: number;
    syncAckLagPts: number;
    socketConnects: number;
    socketConnectErrors: number;
    syncUpdatesDroppedStale: number;
    syncUpdatesDroppedDuplicate: number;
    syncUpdatesDroppedInvalid: number;
    syncUpdateGapEvents: number;
    syncUpdateGapMax: number;
    syncPtsRegressionBlocked: number;
    syncContractMismatchCount: number;
    wasmShadowCompareRuns: number;
    wasmShadowCompareMismatches: number;
    wasmShadowCompareFallbacks: number;
    workerRestartsHint: number;
  };
}

export interface ChatViewSnapshot {
  chatId: ChatId;
  messages: Message[];
  hasMore: boolean;
  nextBeforeSeq: number | null;
}

export interface ChatMessageContext {
  chatId: ChatId;
  seq: number;
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export type ChatPatch =
  | {
      kind: 'reset';
      chatId: ChatId;
      loadSeq: LoadSeq;
      messages: Message[];
      hasMore: boolean;
      nextBeforeSeq: number | null;
    }
  | {
      kind: 'append';
      chatId: ChatId;
      loadSeq: LoadSeq;
      messages: Message[];
    }
  | {
      kind: 'prepend';
      chatId: ChatId;
      loadSeq: LoadSeq;
      messages: Message[];
      hasMore: boolean;
      nextBeforeSeq: number | null;
    }
  | {
      kind: 'delete';
      chatId: ChatId;
      loadSeq: LoadSeq;
      ids: string[];
    }
  | {
      kind: 'update';
      chatId: ChatId;
      loadSeq: LoadSeq;
      updates: Array<{
        id: string;
        status?: Message['status'];
        readCount?: number;
      }>;
    }
  | {
      // Chat list meta updates (last message preview, unread, presence).
      // Note: `chatId` here refers to the sidebar "list id":
      // - private: other user's id
      // - group: group id (without the `g:` prefix)
      kind: 'meta';
      lastMessages?: Array<{ chatId: string; message: Message }>;
      unreadDeltas?: Array<{ chatId: string; delta: number }>;
      onlineUpdates?: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>;
      aiMessages?: Message[];
      chatUpserts?: Array<{
        chatId: string;
        isGroup: boolean;
        title?: string;
        avatarUrl?: string;
        memberCount?: number;
      }>;
      chatRemovals?: Array<{ chatId: string }>;
    }
  | {
      kind: 'sync';
      phase: ChatSyncPhase;
      pts: number;
      socketConnected: boolean;
      reason?: string;
      updatedAt: number;
    };

export interface ChatCoreInit {
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  apiBaseUrl: string;
  socketUrl?: string;
  enableWorkerSocket?: boolean;
  runtimeOverrides?: {
    workerSyncFallback?: boolean;
    workerSafetyChecks?: boolean;
    searchTieredIndex?: boolean;
    searchTieredWasm?: boolean;
    emergencySafeMode?: boolean;
    policyProfile?: 'baseline' | 'canary' | 'safe';
    policyLocked?: boolean;
    policySource?: 'percent_rollout' | 'manual_locked' | 'emergency_safe_mode' | 'default';
    policyMatrixVersion?: string;
  };
}

export interface SocketMessageSendPayload {
  content: string;
  chatType: 'private' | 'group';
  receiverId?: string;
  groupId?: string;
  type?: Message['type'];
  attachments?: Message['attachments'];
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
}

export interface SocketMessageSendAck {
  success: boolean;
  messageId?: string;
  seq?: number;
  error?: string;
}

export interface ChatCoreApi {
  getRuntimeInfo(): Promise<ChatCoreRuntimeInfo>;
  init(params: ChatCoreInit): Promise<void>;
  updateTokens(accessToken: string, refreshToken?: string | null): Promise<void>;
  setConnectivity(socketConnected: boolean): Promise<void>;
  connectRealtime(): Promise<void>;
  disconnectRealtime(): Promise<void>;

  prefetchChat(chatId: ChatId, isGroup: boolean): Promise<void>;
  prefetchChats(targets: ChatPrefetchTarget[]): Promise<void>;
  getSnapshot(chatId: ChatId, isGroup: boolean): Promise<ChatViewSnapshot>;
  getMessageContext(chatId: ChatId, seq: number, limit: number): Promise<ChatMessageContext>;
  resolveMessages(chatId: ChatId, isGroup: boolean, ids: string[]): Promise<Message[]>;
  searchMessages(chatId: ChatId, isGroup: boolean, query: string, limit: number): Promise<Message[]>;
  setActiveChat(chatId: ChatId, isGroup: boolean, loadSeq: LoadSeq): Promise<void>;
  clearActiveChat(): Promise<void>;
  loadMoreBefore(chatId: ChatId, loadSeq: LoadSeq): Promise<void>;

  ingestMessages(messages: Message[]): Promise<void>;
  // Prefer this for socket-driven ingestion so the main thread doesn't need to normalize payloads.
  ingestSocketMessages(rawMessages: any[]): Promise<void>;
  // Preferred realtime bridge: a single batched call for message/presence/read/group events.
  ingestRealtimeEvents(events: SocketRealtimeEvent[]): Promise<void>;
  ingestPresenceEvents(events: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>): Promise<void>;
  ingestGroupUpdates(events: any[]): Promise<void>;
  applyReadReceipt(chatId: ChatId, seq: number, readCount: number, currentUserId: string): Promise<void>;
  applyReadReceiptsBatch(
    receipts: Array<{ chatId: ChatId; seq: number; readCount: number }>,
    currentUserId: string,
  ): Promise<void>;
  sendSocketMessage(payload: SocketMessageSendPayload): Promise<SocketMessageSendAck>;
  joinRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  markChatRead(chatId: ChatId, seq: number): Promise<void>;

  subscribe(cb: (patches: ChatPatch[]) => void): Promise<void>;
  ping(): Promise<'pong'>;
  shutdown(): Promise<void>;
}
