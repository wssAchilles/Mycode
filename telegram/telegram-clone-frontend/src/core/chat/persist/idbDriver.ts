import type { Message } from '../../../types/chat';
import { messageCache, syncStateCache, type HotChatMeta } from '../../../services/db';
import type { ChatPersistenceDriver, HotChatCandidate } from './contracts';

export const idbChatPersistenceDriver: ChatPersistenceDriver = {
  name: 'dexie-indexeddb',
  capabilities: {
    localSearch: true,
    hotChats: true,
    syncPts: true,
    opfsBacked: false,
  },
  async loadRecentMessages(chatId: string, limit = 50): Promise<Message[]> {
    return messageCache.getMessages(chatId, limit);
  },
  async loadMessagesBeforeSeq(
    chatId: string,
    beforeSeq: number | null | undefined,
    limit = 50,
  ): Promise<Message[]> {
    return messageCache.getMessagesBeforeSeq(chatId, beforeSeq, limit);
  },
  async loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]> {
    return messageCache.getMessagesByIds(chatId, ids);
  },
  async saveMessages(messages: Message[]): Promise<void> {
    await messageCache.saveMessages(messages);
  },
  async saveMessage(message: Message): Promise<void> {
    await messageCache.saveMessage(message);
  },
  async loadHotChatCandidates(limit = 12): Promise<HotChatCandidate[]> {
    const rows: HotChatMeta[] = await messageCache.getHotChats(limit);
    return rows.map((row) => ({
      chatId: row.chatId,
      isGroup: row.isGroup,
      lastFetched: row.lastFetched,
      lastSeq: row.lastSeq,
    }));
  },
  async loadSyncPts(userId: string): Promise<number> {
    return syncStateCache.getPts(userId);
  },
  async saveSyncPts(userId: string, pts: number): Promise<void> {
    await syncStateCache.setPts(userId, pts);
  },
};
