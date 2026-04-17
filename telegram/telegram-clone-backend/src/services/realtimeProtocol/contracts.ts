export const REALTIME_PROTOCOL_VERSION = 1;
export const SYNC_PROTOCOL_VERSION = 2;
export const SYNC_WATERMARK_FIELD = 'updateId';

export const SOCKET_IO_COMPAT_TRANSPORT = 'socket_io_compat';
export const RUST_SOCKET_IO_COMPAT_TRANSPORT = 'rust_socket_io_compat';
export const NODE_SOCKET_IO_COMPAT_TRANSPORT = 'node_socket_io_compat';
export const SYNC_V2_LONG_POLL_TRANSPORT = 'sync_v2_long_poll';

export type RealtimeTransportName =
  | typeof RUST_SOCKET_IO_COMPAT_TRANSPORT
  | typeof NODE_SOCKET_IO_COMPAT_TRANSPORT
  | typeof SOCKET_IO_COMPAT_TRANSPORT
  | typeof SYNC_V2_LONG_POLL_TRANSPORT;

export type RealtimeCatalogTransportName =
  | typeof RUST_SOCKET_IO_COMPAT_TRANSPORT
  | typeof NODE_SOCKET_IO_COMPAT_TRANSPORT
  | typeof SYNC_V2_LONG_POLL_TRANSPORT;

export type RealtimeRolloutStage = 'shadow' | 'compat_primary' | 'rust_edge_primary';

export interface RealtimeTransportCatalog {
  preferred: RealtimeCatalogTransportName;
  fallback: RealtimeCatalogTransportName;
  available: RealtimeCatalogTransportName[];
  socketIoCompat: {
    enabled: boolean;
    path: string;
    owner: 'rust' | 'node';
    fallbackOwner: 'rust' | 'node';
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

export function readRealtimeRolloutStage(): RealtimeRolloutStage {
  const raw = String(process.env.GATEWAY_REALTIME_ROLLOUT_STAGE || 'compat_primary')
    .trim()
    .toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (raw === 'rust_edge_primary') return 'rust_edge_primary';
  return 'compat_primary';
}

export function isRustRealtimeEdgePrimary(stage = readRealtimeRolloutStage()): boolean {
  return stage === 'rust_edge_primary';
}

export function buildRealtimeTransportCatalog(
  stage = readRealtimeRolloutStage(),
): RealtimeTransportCatalog {
  const preferred = isRustRealtimeEdgePrimary(stage)
    ? RUST_SOCKET_IO_COMPAT_TRANSPORT
    : NODE_SOCKET_IO_COMPAT_TRANSPORT;
  const fallback = isRustRealtimeEdgePrimary(stage)
    ? NODE_SOCKET_IO_COMPAT_TRANSPORT
    : RUST_SOCKET_IO_COMPAT_TRANSPORT;

  return {
    preferred,
    fallback,
    available: [preferred, fallback, SYNC_V2_LONG_POLL_TRANSPORT],
    socketIoCompat: {
      enabled: true,
      path: '/socket.io/',
      owner: preferred === RUST_SOCKET_IO_COMPAT_TRANSPORT ? 'rust' : 'node',
      fallbackOwner: fallback === RUST_SOCKET_IO_COMPAT_TRANSPORT ? 'rust' : 'node',
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
