import { describe, expect, it } from 'vitest';
import { ChatCoreStore } from '../core/chat/store/chatCoreStore';
import type { Message } from '../types/chat';

function makeMessage(chatId: string, seq: number): Message {
  return {
    id: `m-${seq}`,
    chatId,
    chatType: chatId.startsWith('g:') ? 'group' : 'private',
    content: `msg-${seq}`,
    senderId: 'u:me',
    senderUsername: 'me',
    userId: 'u:me',
    username: 'me',
    receiverId: 'u:other',
    timestamp: new Date(1_700_000_000_000 + seq).toISOString(),
    type: 'text',
    isGroupChat: chatId.startsWith('g:'),
    status: 'delivered',
    seq,
  };
}

describe('capacity boundary (10k smooth / 50k usable)', () => {
  it('retains latest 10k after merging 50k and trimming oldest', () => {
    const chatId = 'p:u:me:u:other';
    const store = new ChatCoreStore(30);
    const batchSize = 2_500;
    const total = 50_000;

    for (let start = 1; start <= total; start += batchSize) {
      const end = Math.min(total, start + batchSize - 1);
      const batch: Message[] = [];
      for (let seq = start; seq <= end; seq += 1) {
        batch.push(makeMessage(chatId, seq));
      }
      store.mergeMessages(chatId, false, batch);
    }

    const full = store.getOrCreate(chatId, false);
    expect(full.messages).toHaveLength(total);

    const trimmed = store.trimOldest(chatId, 10_000);
    expect(trimmed.removedIds).toHaveLength(40_000);

    const final = store.getOrCreate(chatId, false);
    expect(final.messages).toHaveLength(10_000);
    expect(final.messages[0].seq).toBe(40_001);
    expect(final.messages[final.messages.length - 1].seq).toBe(50_000);
    expect(final.ids.size).toBe(10_000);
    expect(final.seqList.length).toBe(10_000);
  });

  it('history anchor flow can retain older 10k via trimNewest', () => {
    const chatId = 'p:u:me:u:other';
    const store = new ChatCoreStore(30);
    const total = 50_000;
    const batchSize = 2_500;

    for (let start = 1; start <= total; start += batchSize) {
      const end = Math.min(total, start + batchSize - 1);
      const batch: Message[] = [];
      for (let seq = start; seq <= end; seq += 1) {
        batch.push(makeMessage(chatId, seq));
      }
      store.mergeMessages(chatId, false, batch);
    }

    const trimmed = store.trimNewest(chatId, 10_000);
    expect(trimmed.removedIds).toHaveLength(40_000);

    const final = store.getOrCreate(chatId, false);
    expect(final.messages).toHaveLength(10_000);
    expect(final.messages[0].seq).toBe(1);
    expect(final.messages[final.messages.length - 1].seq).toBe(10_000);
    expect(final.ids.size).toBe(10_000);
    expect(final.seqList.length).toBe(10_000);
  });

  it('sustained rolling ingest keeps 10k hot window bounded under 50k+ pressure', () => {
    const chatId = 'p:u:me:u:other';
    const store = new ChatCoreStore(30);
    const targetWindow = 10_000;
    const total = 60_000;
    const batchSize = 1_500;
    const roundDurations: number[] = [];
    const startedAt = performance.now();

    for (let start = 1; start <= total; start += batchSize) {
      const end = Math.min(total, start + batchSize - 1);
      const batch: Message[] = [];
      for (let seq = start; seq <= end; seq += 1) {
        batch.push(makeMessage(chatId, seq));
      }
      // Inject mild out-of-order pressure to mimic reconnect/diff merge patterns.
      if ((Math.floor(start / batchSize) % 3) === 1) {
        batch.reverse();
      }

      const t0 = performance.now();
      store.mergeMessages(chatId, false, batch);
      store.trimOldest(chatId, targetWindow);
      roundDurations.push(performance.now() - t0);
    }

    const totalDurationMs = performance.now() - startedAt;
    const maxRoundMs = roundDurations.length ? Math.max(...roundDurations) : 0;

    const final = store.getOrCreate(chatId, false);
    expect(final.messages).toHaveLength(targetWindow);
    expect(final.messages[0].seq).toBe(total - targetWindow + 1);
    expect(final.messages[final.messages.length - 1].seq).toBe(total);
    expect(final.ids.size).toBe(targetWindow);
    expect(final.seqList.length).toBe(targetWindow);

    // Wide guardrails for CI variance: fail only on severe algorithmic regressions.
    expect(maxRoundMs).toBeLessThan(2_500);
    expect(totalDurationMs).toBeLessThan(15_000);
  });
});
