import { describe, expect, it } from 'vitest';
import type { Message } from '../types/chat';
import { compactMessagePatches, type MessagePatch } from '../features/chat/store/patchCompactor';

const chatId = 'p:a:b';
const loadSeq = 7;

function m(id: string, seq: number): Message {
  return {
    id,
    chatId,
    chatType: 'private',
    seq,
    content: id,
    senderId: 'a',
    senderUsername: 'a',
    userId: 'a',
    username: 'a',
    timestamp: new Date().toISOString(),
    type: 'text',
    isGroupChat: false,
    status: 'delivered',
  };
}

describe('patchCompactor', () => {
  it('keeps only the segment after the last reset', () => {
    const patches: MessagePatch[] = [
      { kind: 'append', chatId, loadSeq, messages: [m('a1', 1)] },
      { kind: 'reset', chatId, loadSeq, messages: [m('r1', 2)], hasMore: true, nextBeforeSeq: 1 },
      { kind: 'append', chatId, loadSeq, messages: [m('a2', 3)] },
      { kind: 'reset', chatId, loadSeq, messages: [m('r2', 4)], hasMore: false, nextBeforeSeq: null },
      { kind: 'append', chatId, loadSeq, messages: [m('a3', 5)] },
    ];

    const compacted = compactMessagePatches(patches);
    expect(compacted).toHaveLength(1);
    expect(compacted[0].kind).toBe('reset');
    const reset = compacted[0] as Extract<MessagePatch, { kind: 'reset' }>;
    expect(reset.messages.map((x) => x.id)).toEqual(['r2', 'a3']);
    expect(reset.hasMore).toBe(false);
    expect(reset.nextBeforeSeq).toBeNull();
  });

  it('merges prepend chunks with correct order', () => {
    const patches: MessagePatch[] = [
      { kind: 'prepend', chatId, loadSeq, messages: [m('p3', 3), m('p4', 4)], hasMore: true, nextBeforeSeq: 2 },
      { kind: 'prepend', chatId, loadSeq, messages: [m('p1', 1), m('p2', 2)], hasMore: false, nextBeforeSeq: null },
    ];

    const compacted = compactMessagePatches(patches);
    expect(compacted).toHaveLength(1);
    const prep = compacted[0] as Extract<MessagePatch, { kind: 'prepend' }>;
    expect(prep.messages.map((x) => x.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(prep.hasMore).toBe(false);
    expect(prep.nextBeforeSeq).toBeNull();
  });

  it('merges update/delete bursts and dedupes delete ids', () => {
    const patches: MessagePatch[] = [
      {
        kind: 'update',
        chatId,
        loadSeq,
        updates: [{ id: 'x1', status: 'delivered' }, { id: 'x2', status: 'sent' }],
      },
      {
        kind: 'update',
        chatId,
        loadSeq,
        updates: [{ id: 'x2', status: 'read', readCount: 2 }],
      },
      { kind: 'delete', chatId, loadSeq, ids: ['d1', 'd2'] },
      { kind: 'delete', chatId, loadSeq, ids: ['d2', 'd3'] },
    ];

    const compacted = compactMessagePatches(patches);
    expect(compacted).toHaveLength(2);

    const upd = compacted[0] as Extract<MessagePatch, { kind: 'update' }>;
    const byId = new Map(upd.updates.map((u) => [u.id, u]));
    expect(byId.get('x2')?.status).toBe('read');
    expect(byId.get('x2')?.readCount).toBe(2);

    const del = compacted[1] as Extract<MessagePatch, { kind: 'delete' }>;
    expect(del.ids.sort()).toEqual(['d1', 'd2', 'd3']);
  });
});

