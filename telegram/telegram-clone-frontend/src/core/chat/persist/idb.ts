import type { Message } from '../../../types/chat';
import { messageCache, syncStateCache, type HotChatMeta } from '../../../services/db';

export async function loadRecentMessages(chatId: string, limit = 50): Promise<Message[]> {
  return messageCache.getMessages(chatId, limit);
}

export async function loadMessagesBeforeSeq(
  chatId: string,
  beforeSeq: number | null | undefined,
  limit = 50,
): Promise<Message[]> {
  return messageCache.getMessagesBeforeSeq(chatId, beforeSeq, limit);
}

export async function loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]> {
  return messageCache.getMessagesByIds(chatId, ids);
}

export async function saveMessages(messages: Message[]): Promise<void> {
  // Bulk write with chatMeta update.
  await messageCache.saveMessages(messages);
}

export async function saveMessage(message: Message): Promise<void> {
  await messageCache.saveMessage(message);
}

export async function loadHotChatCandidates(limit = 12): Promise<Array<{ chatId: string; isGroup: boolean; lastFetched: number; lastSeq: number }>> {
  const rows: HotChatMeta[] = await messageCache.getHotChats(limit);
  if (!rows.length) return [];
  return rows.map((row) => ({
    chatId: row.chatId,
    isGroup: row.isGroup,
    lastFetched: row.lastFetched,
    lastSeq: row.lastSeq,
  }));
}

export async function loadSyncPts(userId: string): Promise<number> {
  return syncStateCache.getPts(userId);
}

export async function saveSyncPts(userId: string, pts: number): Promise<void> {
  await syncStateCache.setPts(userId, pts);
}
