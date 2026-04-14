import type {
  ChatPersistenceBackendPreference,
  ChatPersistenceDriver,
  ChatPersistenceSelectionInfo,
} from './contracts';
import { idbChatPersistenceDriver } from './idbDriver';
import { getOrCreateSqliteOpfsDriver } from './sqliteOpfsDriver';

export interface SelectChatPersistenceDriverOptions {
  requested: ChatPersistenceBackendPreference;
  idbDriver?: ChatPersistenceDriver;
  sqliteFactory?: () => Promise<ChatPersistenceDriver>;
}

export interface SelectedChatPersistenceDriver {
  driver: ChatPersistenceDriver;
  selection: ChatPersistenceSelectionInfo;
}

function selectionOf(
  requested: ChatPersistenceBackendPreference,
  driver: ChatPersistenceDriver,
  fallbackReason: string | null,
): ChatPersistenceSelectionInfo {
  return {
    requested,
    selected: driver.name,
    configuredAt: Date.now(),
    fallbackReason,
  };
}

export async function selectChatPersistenceDriver(
  options: SelectChatPersistenceDriverOptions,
): Promise<SelectedChatPersistenceDriver> {
  const requested = options.requested;
  const idbDriver = options.idbDriver ?? idbChatPersistenceDriver;
  const sqliteFactory = options.sqliteFactory ?? getOrCreateSqliteOpfsDriver;

  if (requested === 'idb') {
    return {
      driver: idbDriver,
      selection: selectionOf(requested, idbDriver, null),
    };
  }

  try {
    const sqliteDriver = await sqliteFactory();
    return {
      driver: sqliteDriver,
      selection: selectionOf(requested, sqliteDriver, null),
    };
  } catch (error) {
    return {
      driver: idbDriver,
      selection: selectionOf(
        requested,
        idbDriver,
        String((error as Error)?.message || error || 'sqlite-opfs boot failed'),
      ),
    };
  }
}
