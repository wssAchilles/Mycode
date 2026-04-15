import { describe, expect, it } from 'vitest';

import {
  normalizeRealtimeBootstrap,
  shouldUseSocketIoCompat,
} from '../core/chat/realtimeBootstrap';

describe('realtime bootstrap contract', () => {
  it('normalizes a valid bootstrap payload into runtime-safe metadata', () => {
    const bootstrap = normalizeRealtimeBootstrap({
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
        serverPts: 12,
        ackPts: 9,
        lagPts: 3,
        protocolVersion: 2,
        watermarkField: 'updateId',
      },
      session: {
        userId: 'user-1',
        authenticatedSockets: 2,
        roomSubscriptions: 4,
      },
    });

    expect(bootstrap.protocolVersion).toBe(1);
    expect(bootstrap.transport.preferred).toBe('socket_io_compat');
    expect(bootstrap.transport.syncLongPoll.protocolVersion).toBe(2);
    expect(bootstrap.sync.lagPts).toBe(3);
    expect(bootstrap.session.authenticatedSockets).toBe(2);
    expect(shouldUseSocketIoCompat(bootstrap)).toBe(true);
  });

  it('disables socket transport when bootstrap marks compat mode unavailable', () => {
    const bootstrap = normalizeRealtimeBootstrap({
      protocolVersion: 1,
      transport: {
        preferred: 'sync_v2_long_poll',
        available: ['sync_v2_long_poll'],
        socketIoCompat: {
          enabled: false,
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
        userId: 'user-1',
        authenticatedSockets: 0,
        roomSubscriptions: 0,
      },
    });

    expect(bootstrap.transport.preferred).toBe('sync_v2_long_poll');
    expect(shouldUseSocketIoCompat(bootstrap)).toBe(false);
  });
});
