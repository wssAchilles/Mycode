export type RealtimeTransportName = 'socket_io_compat' | 'sync_v2_long_poll';

export interface RealtimeBootstrapContract {
  protocolVersion: number;
  transport: {
    preferred: RealtimeTransportName;
    available: RealtimeTransportName[];
    socketIoCompat: {
      enabled: boolean;
      path: string;
    };
    syncLongPoll: {
      enabled: boolean;
      path: string;
      protocolVersion: number;
      watermarkField: string;
    };
  };
  capabilities: {
    realtimeBatch: boolean;
    presence: boolean;
    readReceipts: boolean;
    groupUpdates: boolean;
    requestTrace: boolean;
  };
  sync: {
    serverPts: number;
    ackPts: number;
    lagPts: number;
    protocolVersion: number;
    watermarkField: string;
  };
  session: {
    userId: string;
    authenticatedSockets: number;
    roomSubscriptions: number;
  };
}

function readPositiveInt(input: unknown, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function readString(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  const trimmed = input.trim();
  return trimmed || fallback;
}

function readTransportName(input: unknown, fallback: RealtimeTransportName): RealtimeTransportName {
  return input === 'sync_v2_long_poll' ? 'sync_v2_long_poll' : fallback;
}

function readTransportNames(input: unknown): RealtimeTransportName[] {
  if (!Array.isArray(input)) return [];
  const names = new Set<RealtimeTransportName>();
  for (const item of input) {
    if (item === 'socket_io_compat' || item === 'sync_v2_long_poll') {
      names.add(item);
    }
  }
  return Array.from(names);
}

export function createDefaultRealtimeBootstrap(): RealtimeBootstrapContract {
  return {
    protocolVersion: 1,
    transport: {
      preferred: 'socket_io_compat',
      available: ['socket_io_compat', 'sync_v2_long_poll'],
      socketIoCompat: {
        enabled: true,
        path: '/socket.io/',
      },
      syncLongPoll: {
        enabled: true,
        path: '/api/sync/updates',
        protocolVersion: 2,
        watermarkField: 'updateId',
      },
    },
    capabilities: {
      realtimeBatch: true,
      presence: true,
      readReceipts: true,
      groupUpdates: true,
      requestTrace: true,
    },
    sync: {
      serverPts: 0,
      ackPts: 0,
      lagPts: 0,
      protocolVersion: 2,
      watermarkField: 'updateId',
    },
    session: {
      userId: '',
      authenticatedSockets: 0,
      roomSubscriptions: 0,
    },
  };
}

export function normalizeRealtimeBootstrap(raw: unknown): RealtimeBootstrapContract {
  const fallback = createDefaultRealtimeBootstrap();
  const value = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const transport = value.transport && typeof value.transport === 'object' ? value.transport : {};
  const capabilities = value.capabilities && typeof value.capabilities === 'object' ? value.capabilities : {};
  const sync = value.sync && typeof value.sync === 'object' ? value.sync : {};
  const session = value.session && typeof value.session === 'object' ? value.session : {};
  const available = readTransportNames(transport.available);

  return {
    protocolVersion: readPositiveInt(value.protocolVersion, fallback.protocolVersion),
    transport: {
      preferred: readTransportName(transport.preferred, fallback.transport.preferred),
      available: available.length ? available : fallback.transport.available,
      socketIoCompat: {
        enabled: transport.socketIoCompat?.enabled !== false,
        path: readString(transport.socketIoCompat?.path, fallback.transport.socketIoCompat.path),
      },
      syncLongPoll: {
        enabled: transport.syncLongPoll?.enabled !== false,
        path: readString(transport.syncLongPoll?.path, fallback.transport.syncLongPoll.path),
        protocolVersion: readPositiveInt(
          transport.syncLongPoll?.protocolVersion,
          fallback.transport.syncLongPoll.protocolVersion,
        ),
        watermarkField: readString(
          transport.syncLongPoll?.watermarkField,
          fallback.transport.syncLongPoll.watermarkField,
        ),
      },
    },
    capabilities: {
      realtimeBatch: capabilities.realtimeBatch !== false,
      presence: capabilities.presence !== false,
      readReceipts: capabilities.readReceipts !== false,
      groupUpdates: capabilities.groupUpdates !== false,
      requestTrace: capabilities.requestTrace !== false,
    },
    sync: {
      serverPts: readPositiveInt(sync.serverPts, fallback.sync.serverPts),
      ackPts: readPositiveInt(sync.ackPts, fallback.sync.ackPts),
      lagPts: readPositiveInt(sync.lagPts, fallback.sync.lagPts),
      protocolVersion: readPositiveInt(sync.protocolVersion, fallback.sync.protocolVersion),
      watermarkField: readString(sync.watermarkField, fallback.sync.watermarkField),
    },
    session: {
      userId: readString(session.userId, fallback.session.userId),
      authenticatedSockets: readPositiveInt(session.authenticatedSockets, fallback.session.authenticatedSockets),
      roomSubscriptions: readPositiveInt(session.roomSubscriptions, fallback.session.roomSubscriptions),
    },
  };
}

export function shouldUseSocketIoCompat(contract: RealtimeBootstrapContract): boolean {
  if (!contract.transport.socketIoCompat.enabled) return false;
  return (
    contract.transport.preferred === 'socket_io_compat'
    || contract.transport.available.includes('socket_io_compat')
  );
}
