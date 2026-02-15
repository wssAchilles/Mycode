import { describe, expect, it } from 'vitest';
import { ChatCoreStore } from '../core/chat/store/chatCoreStore';
import type { Message } from '../types/chat';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'chatId' | 'senderId' | 'senderUsername'>): Message {
  const chatType: Message['chatType'] = partial.chatId.startsWith('g:') ? 'group' : 'private';
  return {
    id: partial.id,
    chatId: partial.chatId,
    chatType,
    content: partial.content ?? '',
    senderId: partial.senderId,
    senderUsername: partial.senderUsername,
    userId: partial.userId ?? partial.senderId,
    username: partial.username ?? partial.senderUsername,
    receiverId: partial.receiverId,
    groupId: partial.groupId,
    timestamp: partial.timestamp ?? new Date().toISOString(),
    type: partial.type ?? 'text',
    isGroupChat: partial.isGroupChat ?? chatType === 'group',
    status: partial.status ?? 'delivered',
    seq: partial.seq,
    readCount: partial.readCount,
    attachments: partial.attachments,
    fileUrl: partial.fileUrl,
    fileName: partial.fileName,
    fileSize: partial.fileSize,
    mimeType: partial.mimeType,
    thumbnailUrl: partial.thumbnailUrl,
  };
}

describe('ChatCoreStore', () => {
  it('dedupes by id on mergeMessages', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'p:me:you';

    const m1 = msg({ id: '1', chatId, senderId: 'me', senderUsername: 'me', seq: 1, content: 'a' });
    const m1Dup = msg({ id: '1', chatId, senderId: 'me', senderUsername: 'me', seq: 1, content: 'a2' });

    const r1 = store.mergeMessages(chatId, false, [m1]);
    expect(r1.added.map((m) => m.id)).toEqual(['1']);

    const r2 = store.mergeMessages(chatId, false, [m1Dup]);
    expect(r2.added).toEqual([]);

    const chat = store.getOrCreate(chatId, false);
    expect(chat.messages.map((m) => m.id)).toEqual(['1']);
  });

  it('keeps messages sorted by seq ascending', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'p:me:you';

    const m2 = msg({ id: '2', chatId, senderId: 'me', senderUsername: 'me', seq: 2, content: 'b' });
    const m1 = msg({ id: '1', chatId, senderId: 'me', senderUsername: 'me', seq: 1, content: 'a' });

    store.mergeMessages(chatId, false, [m2, m1]);
    const chat = store.getOrCreate(chatId, false);
    expect(chat.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('trimOldest removes oldest messages and ids', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'p:me:you';

    const msgs = [1, 2, 3, 4, 5].map((seq) =>
      msg({ id: String(seq), chatId, senderId: 'me', senderUsername: 'me', seq, content: `m${seq}` }),
    );
    store.mergeMessages(chatId, false, msgs);

    const { removedIds } = store.trimOldest(chatId, 3);
    expect(removedIds).toEqual(['1', '2']);

    const chat = store.getOrCreate(chatId, false);
    expect(chat.messages.map((m) => m.id)).toEqual(['3', '4', '5']);
    expect(chat.ids.has('1')).toBe(false);
    expect(chat.ids.has('2')).toBe(false);
  });

  it('applyReadReceipt updates only my messages up to seq', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'g:group1';
    const me = 'me';

    const m1 = msg({ id: '1', chatId, senderId: me, senderUsername: 'me', seq: 1, content: 'a', isGroupChat: true });
    const m2 = msg({ id: '2', chatId, senderId: 'other', senderUsername: 'o', seq: 2, content: 'b', isGroupChat: true });
    const m3 = msg({ id: '3', chatId, senderId: me, senderUsername: 'me', seq: 3, content: 'c', isGroupChat: true });

    store.mergeMessages(chatId, true, [m1, m2, m3]);

    const updates = store.applyReadReceipt(chatId, 3, 2, me);
    expect(updates.map((u) => u.id).sort()).toEqual(['1', '3']);

    const chat = store.getOrCreate(chatId, true);
    const byId = new Map(chat.messages.map((m) => [m.id, m]));

    expect(byId.get('1')?.status).toBe('read');
    expect(byId.get('1')?.readCount).toBe(2);
    expect(byId.get('2')?.status).toBe('delivered');
    expect(byId.get('3')?.status).toBe('read');
    expect(byId.get('3')?.readCount).toBe(2);
  });
});

