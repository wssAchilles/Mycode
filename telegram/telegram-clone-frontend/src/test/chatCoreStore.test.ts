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

  it('dedupes by seq even when ids differ', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'p:me:you';

    const first = msg({ id: 'm-1', chatId, senderId: 'me', senderUsername: 'me', seq: 10, content: 'a' });
    const dupSeqWithAnotherId = msg({
      id: 'm-2',
      chatId,
      senderId: 'me',
      senderUsername: 'me',
      seq: 10,
      content: 'a-new-id',
    });

    const r1 = store.mergeMessages(chatId, false, [first]);
    expect(r1.added.map((m) => m.id)).toEqual(['m-1']);

    const r2 = store.mergeMessages(chatId, false, [dupSeqWithAnotherId]);
    expect(r2.added).toEqual([]);

    const chat = store.getOrCreate(chatId, false);
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].id).toBe('m-1');
    expect(chat.messages[0].seq).toBe(10);
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

  it('uses seq diff op for large burst dedupe path when provided', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'p:me:you';
    let diffCalls = 0;

    store.setSeqMergeOps({
      mergeSortedUnique: (existing, incoming) => {
        const merged = Array.from(new Set([...existing, ...incoming]));
        merged.sort((a, b) => a - b);
        return merged;
      },
      diffSortedUnique: (existing, incoming) => {
        diffCalls += 1;
        const existingSet = new Set(existing);
        const out: number[] = [];
        for (const s of incoming) {
          if (!existingSet.has(s)) out.push(s);
        }
        return out;
      },
    });

    const base = Array.from({ length: 80 }, (_, i) =>
      msg({
        id: `b-${i + 1}`,
        chatId,
        senderId: 'me',
        senderUsername: 'me',
        seq: i + 1,
        content: `b-${i + 1}`,
      }),
    );
    store.mergeMessages(chatId, false, base);

    const incoming: Message[] = [];
    for (let i = 1; i <= 50; i += 1) {
      incoming.push(
        msg({
          id: `n-${i}`,
          chatId,
          senderId: 'me',
          senderUsername: 'me',
          seq: i <= 25 ? i : 80 + i,
          content: `n-${i}`,
        }),
      );
    }

    const result = store.mergeMessages(chatId, false, incoming);
    expect(diffCalls).toBeGreaterThan(0);
    // 1..25 are duplicates, 106..130 are new.
    expect(result.added).toHaveLength(25);
    expect(result.added[0].seq).toBe(106);
    expect(result.added[result.added.length - 1].seq).toBe(130);
  });

  it('emits LRU eviction callback for chat caches', () => {
    const store = new ChatCoreStore(2);
    const evicted: string[] = [];

    store.setOnChatEvicted((chat) => {
      evicted.push(chat.chatId);
    });

    store.getOrCreate('p:1:2', false);
    store.getOrCreate('p:1:3', false);
    store.getOrCreate('p:1:4', false);

    expect(evicted).toEqual(['p:1:2']);
  });

  it('忽略自己触发的群聊已读回执并按成员水位精确统计每条消息的 readCount', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'g:grp-read-1';
    const me = 'u1';
    store.replaceMessages(chatId, true, [
      msg({ id: 'm1', chatId, senderId: me, senderUsername: 'me', seq: 1, content: 'a', status: 'delivered' }),
      msg({ id: 'm2', chatId, senderId: me, senderUsername: 'me', seq: 2, content: 'b', status: 'delivered' }),
      msg({ id: 'm3', chatId, senderId: me, senderUsername: 'me', seq: 3, content: 'c', status: 'delivered' }),
    ]);

    // 自己读消息不得把自己的消息标成已读
    expect(store.applyReadReceipt(chatId, 3, 1, me, me)).toEqual([]);
    expect(store.getOrCreate(chatId, true).messages.every((m) => m.status === 'delivered')).toBe(true);

    // 成员 u2 读到 seq=3（非本人已读数=1）
    store.applyReadReceipt(chatId, 3, 1, me, 'u2');
    // 成员 u3 仅读到 seq=1（即便 seq=1 < readReceiptSeq=3，也应精确回补 m1 的已读数为 2）
    store.applyReadReceipt(chatId, 1, 2, me, 'u3');

    const msgs = store.getOrCreate(chatId, true).messages;
    expect(msgs[0]).toMatchObject({ seq: 1, status: 'read', readCount: 2 });
    expect(msgs[1]).toMatchObject({ seq: 2, status: 'read', readCount: 1 });
    expect(msgs[2]).toMatchObject({ seq: 3, status: 'read', readCount: 1 });
  });

  it('applyServerReadState 在私聊和群聊场景下正确校准缓存消息已读状态', () => {
    const store = new ChatCoreStore(10);
    const me = 'u1';

    const privateChatId = 'p:u1:u2';
    store.replaceMessages(privateChatId, false, [
      msg({ id: 'p1', chatId: privateChatId, senderId: me, senderUsername: 'me', seq: 1, content: 'hi', status: 'delivered' }),
      msg({ id: 'p2', chatId: privateChatId, senderId: me, senderUsername: 'me', seq: 2, content: 'ping', status: 'delivered' }),
      msg({ id: 'p3', chatId: privateChatId, senderId: me, senderUsername: 'me', seq: 3, content: 'latest', status: 'delivered' }),
    ]);
    const privateUpdates = store.applyServerReadState(
      privateChatId,
      { partnerLastReadSeq: 2, readWatermarks: [{ userId: 'u2', lastReadSeq: 2 }] },
      me,
    );
    expect(privateUpdates.map((u) => [u.id, u.status])).toEqual([
      ['p1', 'read'],
      ['p2', 'read'],
    ]);
    expect(store.getOrCreate(privateChatId, false).messages[2].status).toBe('delivered');

    const groupChatId = 'g:grp-calibrate';
    store.replaceMessages(groupChatId, true, [
      msg({ id: 'g1', chatId: groupChatId, senderId: me, senderUsername: 'me', seq: 1, content: 'one', status: 'delivered', readCount: 0 }),
      msg({ id: 'g2', chatId: groupChatId, senderId: me, senderUsername: 'me', seq: 2, content: 'two', status: 'read', readCount: 1 }),
    ]);
    store.applyServerReadState(
      groupChatId,
      {
        partnerLastReadSeq: null,
        readWatermarks: [
          { userId: me, lastReadSeq: 2 },
          { userId: 'u2', lastReadSeq: 1 },
        ],
      },
      me,
    );
    const groupMsgs = store.getOrCreate(groupChatId, true).messages;
    expect(groupMsgs[0]).toMatchObject({ status: 'read', readCount: 1 });
    // g2 仅本人读过，纠正早期误标的已读状态
    expect(groupMsgs[1]).toMatchObject({ status: 'delivered', readCount: 0 });
  });
});
