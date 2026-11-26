/**
 * 聊天会话滚动位置记忆（按 chatId 隔离，内存 LRU 上限 60 条）
 * 支持切换会话再切回时，若离开前未在底部，则精准回到当时的历史阅读位
 */
export interface ChatScrollSnapshot {
  scrollTop: number;
  wasAtBottom: boolean;
  updatedAt: number;
}

const MAX_CHAT_SCROLL_ENTRIES = 60;
const scrollMemoryMap = new Map<string, ChatScrollSnapshot>();

export function readChatScrollState(chatId?: string | null): ChatScrollSnapshot | null {
  if (!chatId) return null;
  const key = String(chatId).trim();
  if (!key) return null;
  return scrollMemoryMap.get(key) ?? null;
}

export function saveChatScrollState(
  chatId: string | null | undefined,
  snapshot: { scrollTop: number; wasAtBottom: boolean },
  nowMs: number = Date.now(),
): void {
  if (!chatId) return;
  const key = String(chatId).trim();
  if (!key) return;

  if (scrollMemoryMap.has(key)) {
    scrollMemoryMap.delete(key);
  } else if (scrollMemoryMap.size >= MAX_CHAT_SCROLL_ENTRIES) {
    const oldest = scrollMemoryMap.keys().next().value;
    if (oldest) scrollMemoryMap.delete(oldest);
  }

  scrollMemoryMap.set(key, {
    scrollTop: Number.isFinite(snapshot.scrollTop) && snapshot.scrollTop > 0
      ? Math.round(snapshot.scrollTop)
      : 0,
    wasAtBottom: Boolean(snapshot.wasAtBottom),
    updatedAt: nowMs,
  });
}

export function clearChatScrollMemory(): void {
  scrollMemoryMap.clear();
}
