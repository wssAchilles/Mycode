import { beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '../../types/chat';
import {
  clearChatScrollMemory,
  readChatScrollState,
  saveChatScrollState,
} from './state/chatScrollMemory';
import { useChatUiPrefsStore } from './state/chatUiPrefsStore';
import { formatMergedMessagesForCopy } from './components/history/MessageSelectionUtils';

describe('Wave 2 Chat productivity features', () => {
  beforeEach(() => {
    localStorage.clear();
    clearChatScrollMemory();
    useChatUiPrefsStore.getState().resetPrefs();
  });

  it('persists chat scroll position per chatId and respects LRU cap', () => {
    saveChatScrollState('chat-1', { scrollTop: 420.4, wasAtBottom: false });
    expect(readChatScrollState('chat-1')).toMatchObject({
      scrollTop: 420,
      wasAtBottom: false,
    });

    for (let i = 0; i < 65; i += 1) {
      saveChatScrollState(`chat-lru-${i}`, { scrollTop: i * 10, wasAtBottom: i % 2 === 0 });
    }
    expect(readChatScrollState('chat-1')).toBeNull();
    expect(readChatScrollState('chat-lru-64')).not.toBeNull();
  });

  it('pins and unpins chat messages per user and persists to localStorage', () => {
    const store = useChatUiPrefsStore.getState();
    store.hydrateForUser('user-42');

    store.pinMessageInChat('group:g1', {
      id: 'm1',
      content: '今晚 8 点发布会评审',
      senderName: 'Alice',
      pinnedAt: 1000,
    });

    expect(useChatUiPrefsStore.getState().pinnedMessageByChatId['group:g1']?.content).toBe(
      '今晚 8 点发布会评审',
    );

    // 模拟重载恢复
    useChatUiPrefsStore.getState().resetPrefs();
    useChatUiPrefsStore.getState().hydrateForUser('user-42');
    expect(useChatUiPrefsStore.getState().pinnedMessageByChatId['group:g1']?.id).toBe('m1');

    useChatUiPrefsStore.getState().unpinMessageInChat('group:g1');
    expect(useChatUiPrefsStore.getState().pinnedMessageByChatId['group:g1']).toBeUndefined();
  });

  it('formats merged selected messages in chronological order', () => {
    const msgs: Message[] = [
      {
        id: 'm2',
        chatId: 'c1',
        userId: 'u2',
        senderId: 'u2',
        senderUsername: 'Bob',
        content: '收到，马上看',
        timestamp: '2026-11-26T08:05:00.000Z',
        type: 'text',
        status: 'read',
      },
      {
        id: 'm1',
        chatId: 'c1',
        userId: 'me',
        senderId: 'me',
        content: '文档发你了',
        timestamp: '2026-11-26T08:01:00.000Z',
        type: 'text',
        status: 'read',
      },
    ];

    const formatted = formatMergedMessagesForCopy(msgs, 'me');
    const lines = formatted.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[我 ');
    expect(lines[0]).toContain('文档发你了');
    expect(lines[1]).toContain('[Bob ');
    expect(lines[1]).toContain('收到，马上看');
  });
});
