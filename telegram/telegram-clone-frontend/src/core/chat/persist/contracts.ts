import type { Message } from '../../../types/chat';

export type ChatPersistencePhase = 'idle' | 'ready' | 'degraded';

export interface HotChatCandidate {
  chatId: string;
  isGroup: boolean;
  lastFetched: number;
  lastSeq: number;
}

export interface ChatPersistenceCapabilities {
  localSearch: boolean;
  hotChats: boolean;
  syncPts: boolean;
  opfsBacked: boolean;
}

export interface ChatPersistenceRuntimeInfo {
  driver: string;
  phase: ChatPersistencePhase;
  capabilities: ChatPersistenceCapabilities;
  telemetry: {
    operations: number;
    failures: number;
    consecutiveFailures: number;
    lastSuccessAt: number;
    lastFailureAt: number;
    lastError: string | null;
  };
}

export interface ChatPersistenceDriver {
  readonly name: string;
  readonly capabilities: ChatPersistenceCapabilities;
  loadRecentMessages(chatId: string, limit?: number): Promise<Message[]>;
  loadMessagesBeforeSeq(chatId: string, beforeSeq: number | null | undefined, limit?: number): Promise<Message[]>;
  loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]>;
  saveMessages(messages: Message[]): Promise<void>;
  saveMessage(message: Message): Promise<void>;
  loadHotChatCandidates(limit?: number): Promise<HotChatCandidate[]>;
  loadSyncPts(userId: string): Promise<number>;
  saveSyncPts(userId: string, pts: number): Promise<void>;
}
