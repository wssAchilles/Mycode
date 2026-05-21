import type { StoreApi } from 'zustand';
import type { Message } from '../../../../types/chat';
import type { ChatPatch, SocketMessageSendPayload } from '../../../../core/chat/types';
import type { SocketRealtimeEvent } from '../../../../core/chat/realtime';
import type { MessageState } from '../messageTypes';

export type SetState = StoreApi<MessageState>['setState'];
export type GetState = () => MessageState;

export interface MessageStoreDeps {
  // Constants
  readonly PREFETCH_COOLDOWN_MS: number;

  // Projection management
  resetProjectionCaches: () => void;
  rebuildVisibleEntities: () => void;
  insertOptimisticPendingMessage: (payload: SocketMessageSendPayload) => void;
  removeOptimisticPendingMessage: (clientTempId?: string) => void;

  // Patch queue (mutable reference)
  pendingPatches: ChatPatch[];

  // Core readiness
  ensureCoreReady: () => Promise<void>;

  // Ingest queue
  ingestQueue: Message[];
  trimIngestQueue: () => void;
  flushIngestQueue: () => void;

  // Realtime
  enqueueRealtimeEvent: (event: SocketRealtimeEvent | null | undefined) => void;
  enqueueRealtimeBatch: (events: Array<SocketRealtimeEvent | null | undefined>) => void;
  setWorkerRealtimeMode: (active: boolean) => void;
  clearRealtimeQueue: () => void;
  shouldBridgeLegacyRealtime: () => boolean;

  // Prefetch
  prefetchInFlight: Set<string>;
  prefetchLastAt: Map<string, number>;
}
