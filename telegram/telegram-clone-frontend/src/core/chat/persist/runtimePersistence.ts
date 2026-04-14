import type { Message } from '../../../types/chat';
import type {
  ChatPersistenceBackendPreference,
  ChatPersistenceDriver,
  ChatPersistenceMigrationInfo,
  ChatPersistenceSelectionInfo,
  ChatPersistenceRuntimeInfo,
  HotChatCandidate,
} from './contracts';
import { idbChatPersistenceDriver } from './idbDriver';

type DriverOperation<T> = (driver: ChatPersistenceDriver) => Promise<T>;

export class ChatPersistenceRuntime {
  private driver: ChatPersistenceDriver;
  private selection: ChatPersistenceSelectionInfo;
  private operations = 0;
  private failures = 0;
  private consecutiveFailures = 0;
  private lastSuccessAt = 0;
  private lastFailureAt = 0;
  private lastError: string | null = null;

  constructor(driver: ChatPersistenceDriver) {
    this.driver = driver;
    this.selection = {
      requested: 'idb',
      selected: driver.name,
      configuredAt: 0,
      fallbackReason: null,
    };
  }

  private defaultMigrationInfo(): ChatPersistenceMigrationInfo {
    return {
      version: 1,
      source: this.driver.name,
      phase: 'idle',
      startedAt: 0,
      updatedAt: 0,
      completedAt: null,
      importedMessages: 0,
      totalMessages: 0,
      importedSyncStates: 0,
      totalSyncStates: 0,
      lastError: null,
    };
  }

  setDriver(driver: ChatPersistenceDriver) {
    this.configure(driver, {
      requested: this.selection.requested,
      selected: driver.name,
      configuredAt: Date.now(),
      fallbackReason: null,
    });
  }

  configure(driver: ChatPersistenceDriver, selection: ChatPersistenceSelectionInfo) {
    this.driver = driver;
    this.selection = { ...selection };
    this.operations = 0;
    this.failures = 0;
    this.consecutiveFailures = 0;
    this.lastSuccessAt = 0;
    this.lastFailureAt = 0;
    this.lastError = null;
  }

  getRuntimeInfo(): ChatPersistenceRuntimeInfo {
    const migration = this.driver.inspectRuntime?.().migration ?? this.defaultMigrationInfo();
    return {
      driver: this.driver.name,
      phase: this.consecutiveFailures > 0 ? 'degraded' : (this.lastSuccessAt > 0 ? 'ready' : 'idle'),
      selection: { ...this.selection },
      capabilities: { ...this.driver.capabilities },
      migration,
      telemetry: {
        operations: this.operations,
        failures: this.failures,
        consecutiveFailures: this.consecutiveFailures,
        lastSuccessAt: this.lastSuccessAt,
        lastFailureAt: this.lastFailureAt,
        lastError: this.lastError,
      },
    };
  }

  private async run<T>(operation: DriverOperation<T>): Promise<T> {
    this.operations += 1;
    try {
      const result = await operation(this.driver);
      this.consecutiveFailures = 0;
      this.lastSuccessAt = Date.now();
      this.lastError = null;
      return result;
    } catch (error) {
      this.failures += 1;
      this.consecutiveFailures += 1;
      this.lastFailureAt = Date.now();
      this.lastError = String((error as Error)?.message || error || 'unknown persistence error');
      throw error;
    }
  }

  async loadRecentMessages(chatId: string, limit = 50): Promise<Message[]> {
    return this.run((driver) => driver.loadRecentMessages(chatId, limit));
  }

  async loadMessagesBeforeSeq(
    chatId: string,
    beforeSeq: number | null | undefined,
    limit = 50,
  ): Promise<Message[]> {
    return this.run((driver) => driver.loadMessagesBeforeSeq(chatId, beforeSeq, limit));
  }

  async loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]> {
    return this.run((driver) => driver.loadMessagesByIds(chatId, ids));
  }

  async saveMessages(messages: Message[]): Promise<void> {
    await this.run((driver) => driver.saveMessages(messages));
  }

  async saveMessage(message: Message): Promise<void> {
    await this.run((driver) => driver.saveMessage(message));
  }

  async loadHotChatCandidates(limit = 12): Promise<HotChatCandidate[]> {
    return this.run((driver) => driver.loadHotChatCandidates(limit));
  }

  async loadSyncPts(userId: string): Promise<number> {
    return this.run((driver) => driver.loadSyncPts(userId));
  }

  async saveSyncPts(userId: string, pts: number): Promise<void> {
    await this.run((driver) => driver.saveSyncPts(userId, pts));
  }
}

export const chatPersistence = new ChatPersistenceRuntime(idbChatPersistenceDriver);

export async function configureChatPersistence(config: {
  driver: ChatPersistenceDriver;
  requested: ChatPersistenceBackendPreference;
  fallbackReason?: string | null;
}): Promise<ChatPersistenceSelectionInfo> {
  const selection: ChatPersistenceSelectionInfo = {
    requested: config.requested,
    selected: config.driver.name,
    configuredAt: Date.now(),
    fallbackReason: config.fallbackReason ?? null,
  };
  chatPersistence.configure(config.driver, selection);
  return selection;
}

export async function loadRecentMessages(chatId: string, limit = 50): Promise<Message[]> {
  return chatPersistence.loadRecentMessages(chatId, limit);
}

export async function loadMessagesBeforeSeq(
  chatId: string,
  beforeSeq: number | null | undefined,
  limit = 50,
): Promise<Message[]> {
  return chatPersistence.loadMessagesBeforeSeq(chatId, beforeSeq, limit);
}

export async function loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]> {
  return chatPersistence.loadMessagesByIds(chatId, ids);
}

export async function saveMessages(messages: Message[]): Promise<void> {
  await chatPersistence.saveMessages(messages);
}

export async function saveMessage(message: Message): Promise<void> {
  await chatPersistence.saveMessage(message);
}

export async function loadHotChatCandidates(limit = 12): Promise<HotChatCandidate[]> {
  return chatPersistence.loadHotChatCandidates(limit);
}

export async function loadSyncPts(userId: string): Promise<number> {
  return chatPersistence.loadSyncPts(userId);
}

export async function saveSyncPts(userId: string, pts: number): Promise<void> {
  await chatPersistence.saveSyncPts(userId, pts);
}
