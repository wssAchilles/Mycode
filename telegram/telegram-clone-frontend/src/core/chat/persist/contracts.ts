import type { Message } from '../../../types/chat';

export type ChatPersistencePhase = 'idle' | 'ready' | 'degraded';
export type ChatPersistenceBackendPreference = 'auto' | 'idb' | 'sqlite-opfs';
export type ChatPersistenceMigrationPhase = 'idle' | 'pending' | 'running' | 'completed' | 'degraded';

export interface HotChatCandidate {
  chatId: string;
  isGroup: boolean;
  lastFetched: number;
  lastSeq: number;
}

export interface ChatPersistenceSyncStateRecord {
  userId: string;
  pts: number;
}

export interface ChatPersistenceMigrationStats {
  messageCount: number;
  syncStateCount: number;
}

export interface ChatPersistenceMigrationRecord {
  version: number;
  source: string;
  phase: ChatPersistenceMigrationPhase;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  importedMessages: number;
  totalMessages: number;
  importedSyncStates: number;
  totalSyncStates: number;
  lastError: string | null;
}

export interface ChatPersistenceMigrationInfo extends ChatPersistenceMigrationRecord {}

export interface ChatPersistenceMigrationSource {
  getMigrationStats(): Promise<ChatPersistenceMigrationStats>;
  getMigrationMessages(offset: number, limit: number): Promise<Message[]>;
  getMigrationSyncStates(offset: number, limit: number): Promise<ChatPersistenceSyncStateRecord[]>;
}

export interface ChatPersistenceSelectionInfo {
  requested: ChatPersistenceBackendPreference;
  selected: string;
  configuredAt: number;
  fallbackReason: string | null;
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
  selection: ChatPersistenceSelectionInfo;
  capabilities: ChatPersistenceCapabilities;
  migration: ChatPersistenceMigrationInfo;
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
  readonly migrationSource?: ChatPersistenceMigrationSource;
  inspectRuntime?(): {
    migration?: ChatPersistenceMigrationInfo;
  };
}
