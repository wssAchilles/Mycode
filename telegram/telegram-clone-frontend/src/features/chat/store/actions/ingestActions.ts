import type { SocketRealtimeEvent } from '../../../../core/chat/realtime';
import type { MessageState } from '../messageTypes';
import type { SetState, GetState, MessageStoreDeps } from './types';

export function createIngestActions(
  set: SetState,
  get: GetState,
  deps: MessageStoreDeps,
): Pick<
  MessageState,
  | 'ingestSocketMessage'
  | 'ingestSocketMessages'
  | 'ingestRealtimeEvents'
  | 'ingestPresenceEvent'
  | 'ingestPresenceEvents'
  | 'ingestReadReceiptEvent'
  | 'ingestReadReceiptEvents'
  | 'ingestGroupUpdateEvent'
  | 'ingestGroupUpdateEvents'
  | 'applyReadReceipt'
> {
  return {
    ingestSocketMessage: (raw) => {
      // Always forward socket messages to worker so its caches stay warm even when UI is in AI mode.
      if (!raw) return;
      deps.enqueueRealtimeEvent({ type: 'message', payload: raw });
    },

    ingestSocketMessages: (rawMessages) => {
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) return;
      deps.enqueueRealtimeBatch(rawMessages.map((payload) => ({ type: 'message', payload } as SocketRealtimeEvent)));
    },

    ingestRealtimeEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      deps.enqueueRealtimeBatch(events);
    },

    ingestPresenceEvent: (event) => {
      if (!event?.userId) return;
      deps.enqueueRealtimeEvent({
        type: 'presence',
        payload: { userId: event.userId, isOnline: !!event.isOnline, lastSeen: event.lastSeen },
      });
    },

    ingestPresenceEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      const batch: SocketRealtimeEvent[] = [];
      for (const event of events) {
        if (!event?.userId) continue;
        batch.push({
          type: 'presence',
          payload: { userId: event.userId, isOnline: !!event.isOnline, lastSeen: event.lastSeen },
        });
      }
      if (!batch.length) return;
      deps.enqueueRealtimeBatch(batch);
    },

    ingestReadReceiptEvent: (event) => {
      if (!event?.chatId || typeof event.seq !== 'number') return;
      const readCount = typeof event.readCount === 'number' ? event.readCount : 1;
      deps.enqueueRealtimeEvent({
        type: 'readReceipt',
        payload: { chatId: event.chatId, seq: event.seq, readCount },
      });
    },

    ingestReadReceiptEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      const batch: SocketRealtimeEvent[] = [];
      for (const event of events) {
        if (!event?.chatId || typeof event.seq !== 'number') continue;
        const readCount = typeof event.readCount === 'number' ? event.readCount : 1;
        batch.push({
          type: 'readReceipt',
          payload: { chatId: event.chatId, seq: event.seq, readCount },
        });
      }
      if (!batch.length) return;
      deps.enqueueRealtimeBatch(batch);
    },

    ingestGroupUpdateEvent: (event) => {
      if (!event) return;
      deps.enqueueRealtimeEvent({ type: 'groupUpdate', payload: event });
    },

    ingestGroupUpdateEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      const batch: SocketRealtimeEvent[] = [];
      for (const event of events) {
        if (!event) continue;
        batch.push({ type: 'groupUpdate', payload: event });
      }
      if (!batch.length) return;
      deps.enqueueRealtimeBatch(batch);
    },

    applyReadReceipt: (chatId, seq, readCount, currentUserId) => {
      // Worker owns the authoritative state for regular chats.
      void currentUserId;
      deps.enqueueRealtimeEvent({
        type: 'readReceipt',
        payload: { chatId, seq, readCount: typeof readCount === 'number' ? readCount : 1 },
      });
    },
  };
}
