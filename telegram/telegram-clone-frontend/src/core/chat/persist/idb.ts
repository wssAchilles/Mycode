import type { Message } from '../../../types/chat';
import { messageCache, syncStateCache } from '../../../services/db';

export async function loadRecentMessages(chatId: string, limit = 50): Promise<Message[]> {
  return messageCache.getMessages(chatId, limit);
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

export async function loadSyncPts(userId: string): Promise<number> {
  return syncStateCache.getPts(userId);
}

export async function saveSyncPts(userId: string, pts: number): Promise<void> {
  await syncStateCache.setPts(userId, pts);
}
