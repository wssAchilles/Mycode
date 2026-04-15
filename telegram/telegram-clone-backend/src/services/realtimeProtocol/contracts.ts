export const REALTIME_PROTOCOL_VERSION = 1;
export const SYNC_PROTOCOL_VERSION = 2;
export const SYNC_WATERMARK_FIELD = 'updateId';

export const SOCKET_IO_COMPAT_TRANSPORT = 'socket_io_compat';
export const SYNC_V2_LONG_POLL_TRANSPORT = 'sync_v2_long_poll';

export type RealtimeTransportName =
  | typeof SOCKET_IO_COMPAT_TRANSPORT
  | typeof SYNC_V2_LONG_POLL_TRANSPORT;

export interface RealtimeTransportCatalog {
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
}

export interface RealtimeCapabilities {
  realtimeBatch: boolean;
  presence: boolean;
  readReceipts: boolean;
  groupUpdates: boolean;
  requestTrace: boolean;
}

export interface RealtimeHealthPayload {
  protocolVersion: number;
  transport: RealtimeTransportCatalog;
  capabilities: RealtimeCapabilities;
}

export interface RealtimeSessionSnapshot {
  userId: string;
  username: string | null;
  online: boolean;
  connectedSockets: number;
  authenticatedSockets: number;
  roomSubscriptions: number;
  socketIds: string[];
  rooms: string[];
}

export interface RealtimeBootstrapPayload extends RealtimeHealthPayload {
  sync: {
    protocolVersion: number;
    watermarkField: string;
    serverPts: number;
    ackPts: number;
    lagPts: number;
  };
  session: RealtimeSessionSnapshot;
}

export function buildRealtimeTransportCatalog(): RealtimeTransportCatalog {
  return {
    preferred: SOCKET_IO_COMPAT_TRANSPORT,
    available: [SOCKET_IO_COMPAT_TRANSPORT, SYNC_V2_LONG_POLL_TRANSPORT],
    socketIoCompat: {
      enabled: true,
      path: '/socket.io/',
    },
    syncLongPoll: {
      enabled: true,
      path: '/api/sync/updates',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      watermarkField: SYNC_WATERMARK_FIELD,
    },
  };
}

export function buildRealtimeCapabilities(): RealtimeCapabilities {
  return {
    realtimeBatch: true,
    presence: true,
    readReceipts: true,
    groupUpdates: true,
    requestTrace: true,
  };
}
