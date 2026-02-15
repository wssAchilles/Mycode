import type { Message } from '../../../types/chat';
import { LruCache } from './lru';

export interface SeqMergeOps {
  mergeSortedUnique(existing: number[], incoming: number[]): number[];
}

export interface ChatCacheState {
  chatId: string;
  isGroup: boolean;

  // Ascending by (seq, timestamp) for stable rendering.
  messages: Message[];
  ids: Set<string>;
  minSeq: number | null;
  maxSeq: number | null;

  // Paging state (cursor for groups/unified endpoint, page for legacy private paging).
  hasMore: boolean;
  nextBeforeSeq: number | null;
  currentPage: number;
}

export class ChatCoreStore {
  private readonly chats: LruCache<string, ChatCacheState>;
  private seqMergeOps: SeqMergeOps | null = null;

  activeChatId: string | null = null;
  activeIsGroup = false;
  activeLoadSeq = 0;

  constructor(limit: number) {
    this.chats = new LruCache(limit);
  }

  setSeqMergeOps(ops: SeqMergeOps | null): void {
    this.seqMergeOps = ops;
  }

  getOrCreate(chatId: string, isGroup: boolean): ChatCacheState {
    const cached = this.chats.get(chatId);
    if (cached) return cached;

    const next: ChatCacheState = {
      chatId,
      isGroup,
      messages: [],
      ids: new Set(),
      minSeq: null,
      maxSeq: null,
      hasMore: true,
      nextBeforeSeq: null,
      currentPage: 1,
    };
    this.chats.set(chatId, next);
    return next;
  }

  setActive(chatId: string, isGroup: boolean, loadSeq: number): ChatCacheState {
    this.activeChatId = chatId;
    this.activeIsGroup = isGroup;
    this.activeLoadSeq = loadSeq;
    const chat = this.getOrCreate(chatId, isGroup);
    chat.isGroup = isGroup;
    return chat;
  }

  getActive(): ChatCacheState | null {
    if (!this.activeChatId) return null;
    return this.getOrCreate(this.activeChatId, this.activeIsGroup);
  }

  replaceMessages(chatId: string, isGroup: boolean, messages: Message[]): { added: Message[] } {
    const chat = this.getOrCreate(chatId, isGroup);
    chat.isGroup = isGroup;
    chat.messages = [];
    chat.ids.clear();
    chat.minSeq = null;
    chat.maxSeq = null;

    const deduped: Message[] = [];
    for (const m of messages) {
      if (!m?.id) continue;
      if (chat.ids.has(m.id)) continue;
      chat.ids.add(m.id);
      deduped.push(m);
    }

    chat.messages = sortMessages(deduped);
    ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));
    return { added: chat.messages };
  }

  mergeMessages(chatId: string, isGroup: boolean, incoming: Message[]): { added: Message[] } {
    const chat = this.getOrCreate(chatId, isGroup);
    chat.isGroup = isGroup;

    const added: Message[] = [];
    for (const m of incoming) {
      if (!m?.id) continue;
      if (chat.ids.has(m.id)) continue;
      chat.ids.add(m.id);
      added.push(m);
    }

    if (!added.length) return { added: [] };

    // Fast paths to avoid sorting the entire chat on every ingest:
    // - prepend batch: older history load
    // - append batch: live updates
    const currentRange = { minSeq: chat.minSeq, maxSeq: chat.maxSeq };
    const addedSorted = sortMessages(added);
    const addedRange = computeSeqRange(addedSorted);

    if (!chat.messages.length) {
      chat.messages = addedSorted;
      chat.minSeq = addedRange.minSeq;
      chat.maxSeq = addedRange.maxSeq;
      return { added: addedSorted };
    }

    if (addedRange.maxSeq !== null && currentRange.minSeq !== null && addedRange.maxSeq <= currentRange.minSeq) {
      // Incoming is entirely older (or equal) to the current head => prepend.
      chat.messages = addedSorted.concat(chat.messages);
      chat.minSeq = addedRange.minSeq ?? chat.minSeq;
      // maxSeq unchanged
      return { added: addedSorted };
    }

    if (addedRange.minSeq !== null && currentRange.maxSeq !== null && addedRange.minSeq >= currentRange.maxSeq) {
      // Incoming is entirely newer (or equal) to current tail => append.
      chat.messages = chat.messages.concat(addedSorted);
      chat.maxSeq = addedRange.maxSeq ?? chat.maxSeq;
      // minSeq unchanged
      return { added: addedSorted };
    }

    // Mixed/out-of-order:
    // Prefer an O(n+m) merge for seq-backed messages when wasm is available.
    const ops = this.seqMergeOps;
    if (ops) {
      const existingOther: Message[] = [];
      const existingSeq: Message[] = [];
      for (const m of chat.messages) {
        if (typeof m.seq === 'number' && m.seq > 0) existingSeq.push(m);
        else existingOther.push(m);
      }

      const addedOther: Message[] = [];
      const addedSeq: Message[] = [];
      for (const m of addedSorted) {
        if (typeof m.seq === 'number' && m.seq > 0) addedSeq.push(m);
        else addedOther.push(m);
      }

      if (existingSeq.length || addedSeq.length) {
        try {
          const existingSeqs = existingSeq.map((m) => m.seq as number);
          const addedSeqs = addedSeq.map((m) => m.seq as number);
          const mergedSeqs = ops.mergeSortedUnique(existingSeqs, addedSeqs);

          const bySeq = new Map<number, Message>();
          for (const m of existingSeq) bySeq.set(m.seq as number, m);
          // Prefer incoming entities on conflicts.
          for (const m of addedSeq) bySeq.set(m.seq as number, m);

          const mergedSeqMessages: Message[] = [];
          for (const s of mergedSeqs) {
            const msg = bySeq.get(s);
            if (msg) mergedSeqMessages.push(msg);
          }

          const mergedOther = existingOther.length || addedOther.length
            ? sortMessages(existingOther.concat(addedOther))
            : [];

          chat.messages = mergedOther.concat(mergedSeqMessages);
          ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));
          return { added: addedSorted };
        } catch {
          // ignore and fallback to full sort below
        }
      }
    }

    // Fallback: full merge+sort (seq-missing or wasm unavailable).
    chat.messages = sortMessages(chat.messages.concat(addedSorted));
    ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));

    return { added: addedSorted };
  }

  trimOldest(chatId: string, maxMessages: number): { removedIds: string[] } {
    const chat = this.chats.get(chatId);
    if (!chat) return { removedIds: [] };
    if (maxMessages <= 0) return { removedIds: [] };
    if (chat.messages.length <= maxMessages) return { removedIds: [] };

    const excess = chat.messages.length - maxMessages;
    const removed = chat.messages.slice(0, excess);
    const removedIds = removed.map((m) => m?.id).filter(Boolean) as string[];

    chat.messages = chat.messages.slice(excess);
    for (const id of removedIds) chat.ids.delete(id);

    ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));
    return { removedIds };
  }

  applyReadReceipt(chatId: string, seq: number, readCount: number, currentUserId: string): Array<{ id: string; status?: Message['status']; readCount?: number }> {
    const chat = this.chats.get(chatId);
    if (!chat) return [];

    const updates: Array<{ id: string; status?: Message['status']; readCount?: number }> = [];
    for (let i = 0; i < chat.messages.length; i += 1) {
      const msg = chat.messages[i];
      const msgSeq = msg.seq ?? 0;
      if (!msgSeq || msgSeq > seq) continue;
      if (msg.senderId !== currentUserId) continue;

      const nextStatus: Message['status'] = 'read';
      const nextReadCount = msg.isGroupChat ? readCount : msg.readCount;

      if (msg.status !== nextStatus || (typeof nextReadCount === 'number' && msg.readCount !== nextReadCount)) {
        chat.messages[i] = { ...msg, status: nextStatus, readCount: nextReadCount };
        updates.push({ id: msg.id, status: nextStatus, readCount: nextReadCount });
      }
    }

    return updates;
  }

  clearActive(): void {
    this.activeChatId = null;
    this.activeIsGroup = false;
    this.activeLoadSeq = 0;
  }

  clearAll(): void {
    this.chats.clear();
    this.clearActive();
  }
}

function sortMessages(messages: Message[]): Message[] {
  // Prefer seq; fallback to timestamp; keep stable ordering for undefined seq.
  return messages
    .slice()
    .sort((a, b) => {
      const aSeq = a.seq ?? 0;
      const bSeq = b.seq ?? 0;
      if (aSeq && bSeq && aSeq !== bSeq) return aSeq - bSeq;
      if (aSeq && !bSeq) return 1;
      if (!aSeq && bSeq) return -1;
      const aTs = Date.parse(a.timestamp || '') || 0;
      const bTs = Date.parse(b.timestamp || '') || 0;
      if (aTs !== bTs) return aTs - bTs;
      return (a.id || '').localeCompare(b.id || '');
    });
}

function computeSeqRange(messages: Message[]): { minSeq: number | null; maxSeq: number | null } {
  let minSeq: number | null = null;
  let maxSeq: number | null = null;
  for (const m of messages) {
    const s = m.seq ?? 0;
    if (!s) continue;
    if (minSeq === null || s < minSeq) minSeq = s;
    if (maxSeq === null || s > maxSeq) maxSeq = s;
  }
  return { minSeq, maxSeq };
}
