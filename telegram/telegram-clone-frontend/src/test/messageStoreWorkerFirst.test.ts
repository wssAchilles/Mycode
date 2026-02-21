import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyChatMetaBatch: vi.fn(),
  init: vi.fn(async () => undefined),
  subscribe: vi.fn(async (_cb: any) => undefined),
  ingestRealtimeEvents: vi.fn(async (_events: any[]) => undefined),
  ingestPresenceEvents: vi.fn(async (_events: any[]) => undefined),
  ingestSocketMessages: vi.fn(async (_events: any[]) => undefined),
  applyReadReceiptsBatch: vi.fn(async (_events: any[], _userId: string) => undefined),
}));

vi.mock('../features/chat/store/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      applyChatMetaBatch: mocks.applyChatMetaBatch,
    }),
  },
}));

vi.mock('../services/apiClient', () => ({
  authUtils: {
    getCurrentUser: () => ({ id: 'u1' }),
    isAuthenticated: () => true,
    getAccessToken: () => 'access-token',
  },
  authAPI: {
    refreshToken: vi.fn(async () => ({ accessToken: 'next-access', refreshToken: 'next-refresh' })),
  },
}));

vi.mock('../utils/authStorage', () => ({
  authStorage: {
    getAccessToken: () => 'access-token',
    getRefreshToken: () => 'refresh-token',
  },
}));

vi.mock('../core/bridge/chatCoreClient', () => ({
  default: {
    init: mocks.init,
    subscribe: mocks.subscribe,
    ingestRealtimeEvents: mocks.ingestRealtimeEvents,
    ingestPresenceEvents: mocks.ingestPresenceEvents,
    ingestSocketMessages: mocks.ingestSocketMessages,
    applyReadReceiptsBatch: mocks.applyReadReceiptsBatch,
    setConnectivity: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => ({ messages: [], hasMore: true, nextBeforeSeq: null })),
    setActiveChat: vi.fn(async () => undefined),
    clearActiveChat: vi.fn(async () => undefined),
    loadMoreBefore: vi.fn(async () => undefined),
    resolveMessages: vi.fn(async () => []),
    searchMessages: vi.fn(async () => []),
    prefetchChats: vi.fn(async () => undefined),
    updateTokens: vi.fn(async () => undefined),
    ingestMessages: vi.fn(async () => undefined),
  },
}));

import { useMessageStore } from '../features/chat/store/messageStore';

async function flushAsyncTicks(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

describe('messageStore worker-first ingest path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMessageStore.setState({
      activeContactId: 'u2',
      activeChatId: 'p:u1:u2',
      isGroupChat: false,
      loadSeq: 1,
    } as any);
  });

  it('routes legacy ingest entrypoints through realtime batch only', async () => {
    const s = useMessageStore.getState();

    s.ingestSocketMessage({ id: 'm1', chatId: 'p:u1:u2', content: 'a' });
    s.ingestSocketMessages([{ id: 'm2', chatId: 'p:u1:u2', content: 'b' }]);
    s.ingestPresenceEvent({ userId: 'u2', isOnline: true });
    s.ingestPresenceEvents([{ userId: 'u3', isOnline: false }]);
    s.ingestReadReceiptEvent({ chatId: 'p:u1:u2', seq: 7, readCount: 2 });
    s.ingestReadReceiptEvents([{ chatId: 'p:u1:u2', seq: 8, readCount: 3 }]);
    s.ingestGroupUpdateEvent({ groupId: 'g1', action: 'group_updated' });
    s.ingestGroupUpdateEvents([{ groupId: 'g1', action: 'member_added' }]);
    s.applyReadReceipt('p:u1:u2', 9, 4, 'u1');

    await flushAsyncTicks();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.ingestRealtimeEvents).toHaveBeenCalled();

    const mergedPayload = mocks.ingestRealtimeEvents.mock.calls.reduce<any[]>((acc, call) => {
      const batch = call[0];
      return acc.concat(Array.isArray(batch) ? batch : []);
    }, []);

    expect(mergedPayload.some((e) => e?.type === 'message')).toBe(true);
    expect(mergedPayload.some((e) => e?.type === 'presence')).toBe(true);
    expect(mergedPayload.some((e) => e?.type === 'readReceipt')).toBe(true);
    expect(mergedPayload.some((e) => e?.type === 'groupUpdate')).toBe(true);

    // Worker-first: these legacy direct RPCs should no longer be used by messageStore.
    expect(mocks.ingestPresenceEvents).not.toHaveBeenCalled();
    expect(mocks.ingestSocketMessages).not.toHaveBeenCalled();
    expect(mocks.applyReadReceiptsBatch).not.toHaveBeenCalled();
  });
});
