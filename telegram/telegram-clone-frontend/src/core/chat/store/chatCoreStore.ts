import type { Message } from '../../../types/chat';
import { LruCache } from './lru';

export interface SeqMergeOps {
  mergeSortedUnique(existing: number[], incoming: number[]): number[];
  diffSortedUnique?(existing: number[], incoming: number[]): number[];
}

export interface ChatCacheState {
  chatId: string;
  isGroup: boolean;

  // Ascending by (seq, timestamp) for stable rendering.
  messages: Message[];
  entityById: Map<string, Message>;
  ids: Set<string>;
  seqSet: Set<number>;
  seqList: number[];
  minSeq: number | null;
  maxSeq: number | null;
  readReceiptSeq: number;
  readReceiptReadCount: number;

  // Paging state (unified cursor API).
  hasMore: boolean;
  nextBeforeSeq: number | null;
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
      entityById: new Map(),
      ids: new Set(),
      seqSet: new Set(),
      seqList: [],
      minSeq: null,
      maxSeq: null,
      readReceiptSeq: 0,
      readReceiptReadCount: 0,
      hasMore: true,
      nextBeforeSeq: null,
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
    chat.entityById.clear();
    chat.ids.clear();
    chat.seqSet.clear();
    chat.seqList = [];
    chat.minSeq = null;
    chat.maxSeq = null;
    chat.readReceiptSeq = 0;
    chat.readReceiptReadCount = 0;

    const deduped: Message[] = [];
    for (const m of messages) {
      if (!m?.id) continue;
      if (chat.ids.has(m.id)) continue;
      const seq = normalizePositiveSeq(m.seq);
      if (seq !== null && chat.seqSet.has(seq)) continue;
      chat.ids.add(m.id);
      chat.entityById.set(m.id, m);
      if (seq !== null) chat.seqSet.add(seq);
      deduped.push(m);
    }

    chat.messages = sortMessages(deduped);
    ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));
    chat.seqList = extractSortedPositiveSeqs(chat.messages);
    return { added: chat.messages };
  }

  mergeMessages(chatId: string, isGroup: boolean, incoming: Message[]): { added: Message[] } {
    const chat = this.getOrCreate(chatId, isGroup);
    chat.isGroup = isGroup;

    const ops = this.seqMergeOps;
    const canUseSeqDiff =
      !!ops?.diffSortedUnique && incoming.length >= 32 && chat.messages.length >= 64;

    const incomingSeqs = extractSortedPositiveSeqs(incoming);

    let newSeqSet: Set<number> | null = null;
    if (canUseSeqDiff) {
      try {
        const existingSeqs = chat.seqList;
        if (incomingSeqs.length) {
          const nextSeqs = ops!.diffSortedUnique!(existingSeqs, incomingSeqs);
          newSeqSet = new Set(nextSeqs);
        }
      } catch {
        // ignore and fallback to Set-based dedupe below.
      }
    }

    const added: Message[] = [];
    for (const m of incoming) {
      if (!m?.id) continue;
      if (chat.ids.has(m.id)) continue;

      const seq = normalizePositiveSeq(m.seq);
      if (seq !== null) {
        // Fast path for large batches: rely on wasm diff result when available.
        if (newSeqSet) {
          if (!newSeqSet.has(seq)) continue;
        } else if (chat.seqSet.has(seq)) {
          continue;
        }
      }

      chat.ids.add(m.id);
      chat.entityById.set(m.id, m);
      if (seq !== null) chat.seqSet.add(seq);
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
      chat.seqList = extractSortedPositiveSeqs(addedSorted);
      return { added: addedSorted };
    }

    if (addedRange.maxSeq !== null && currentRange.minSeq !== null && addedRange.maxSeq <= currentRange.minSeq) {
      // Incoming is entirely older (or equal) to the current head => prepend.
      chat.messages = addedSorted.concat(chat.messages);
      chat.minSeq = addedRange.minSeq ?? chat.minSeq;
      updateSeqList(chat, addedSorted, ops);
      // maxSeq unchanged
      return { added: addedSorted };
    }

    if (addedRange.minSeq !== null && currentRange.maxSeq !== null && addedRange.minSeq >= currentRange.maxSeq) {
      // Incoming is entirely newer (or equal) to current tail => append.
      chat.messages = chat.messages.concat(addedSorted);
      chat.maxSeq = addedRange.maxSeq ?? chat.maxSeq;
      updateSeqList(chat, addedSorted, ops);
      // minSeq unchanged
      return { added: addedSorted };
    }

    // Mixed/out-of-order:
    // Prefer an O(n+m) merge for seq-backed messages when wasm is available.
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
          chat.seqList = mergedSeqs;
          return { added: addedSorted };
        } catch {
          // ignore and fallback to full sort below
        }
      }
    }

    // Fallback: full merge+sort (seq-missing or wasm unavailable).
    chat.messages = sortMessages(chat.messages.concat(addedSorted));
    ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));
    updateSeqList(chat, addedSorted, ops);

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
    for (const m of removed) {
      if (m?.id) chat.ids.delete(m.id);
      if (m?.id) chat.entityById.delete(m.id);
      const seq = normalizePositiveSeq(m?.seq);
      if (seq !== null) chat.seqSet.delete(seq);
    }

    ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));
    chat.seqList = extractSortedPositiveSeqs(chat.messages);
    return { removedIds };
  }

  applyReadReceipt(chatId: string, seq: number, readCount: number, currentUserId: string): Array<{ id: string; status?: Message['status']; readCount?: number }> {
    const chat = this.chats.get(chatId);
    if (!chat) return [];
    if (typeof seq !== 'number' || seq <= 0) return [];

    const updates: Array<{ id: string; status?: Message['status']; readCount?: number }> = [];
    const prevSeq = chat.readReceiptSeq;
    const prevReadCount = chat.readReceiptReadCount;

    if (seq < prevSeq) return [];

    // Group read-count changes can require backfilling already-read messages.
    const shouldBackfillReadCount = chat.isGroup && readCount > prevReadCount;
    const minSeqToUpdate = seq > prevSeq ? prevSeq + 1 : 1;
    const firstSeqIndex = findFirstPositiveSeqIndex(chat.messages);
    if (firstSeqIndex >= chat.messages.length) {
      chat.readReceiptSeq = Math.max(prevSeq, seq);
      if (chat.isGroup) {
        chat.readReceiptReadCount = Math.max(prevReadCount, readCount);
      }
      return [];
    }

    const startIdx = lowerBoundSeq(chat.messages, firstSeqIndex, minSeqToUpdate);
    const endIdxExclusive = upperBoundSeq(chat.messages, firstSeqIndex, seq);
    if (startIdx >= endIdxExclusive) {
      chat.readReceiptSeq = Math.max(prevSeq, seq);
      if (chat.isGroup) {
        chat.readReceiptReadCount = Math.max(prevReadCount, readCount);
      }
      return [];
    }

    for (let i = startIdx; i < endIdxExclusive; i += 1) {
      const msg = chat.messages[i];
      const msgSeq = msg.seq ?? 0;
      if (!msgSeq) continue;
      if (!shouldBackfillReadCount && msgSeq < minSeqToUpdate) continue;
      if (msg.senderId !== currentUserId) continue;

      const nextStatus: Message['status'] = 'read';
      const nextReadCount = msg.isGroupChat ? readCount : msg.readCount;

      if (msg.status !== nextStatus || (typeof nextReadCount === 'number' && msg.readCount !== nextReadCount)) {
        chat.messages[i] = { ...msg, status: nextStatus, readCount: nextReadCount };
        chat.entityById.set(msg.id, chat.messages[i]);
        updates.push({ id: msg.id, status: nextStatus, readCount: nextReadCount });
      }
    }

    chat.readReceiptSeq = Math.max(prevSeq, seq);
    if (chat.isGroup) {
      chat.readReceiptReadCount = Math.max(prevReadCount, readCount);
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

  getMessagesByIds(chatId: string, ids: string[]): Message[] {
    const chat = this.chats.get(chatId);
    if (!chat || !Array.isArray(ids) || ids.length === 0) return [];
    const out: Message[] = [];
    for (const id of ids) {
      const hit = chat.entityById.get(id);
      if (hit) out.push(hit);
    }
    return out;
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

function normalizePositiveSeq(seq: Message['seq']): number | null {
  return typeof seq === 'number' && seq > 0 ? seq : null;
}

function extractSortedPositiveSeqs(messages: Message[]): number[] {
  const set = new Set<number>();
  for (const m of messages) {
    const seq = normalizePositiveSeq(m.seq);
    if (seq !== null) set.add(seq);
  }
  return Array.from(set.values()).sort((a, b) => a - b);
}

function seqValue(message: Message): number {
  return typeof message.seq === 'number' && message.seq > 0 ? message.seq : 0;
}

function findFirstPositiveSeqIndex(messages: Message[]): number {
  let lo = 0;
  let hi = messages.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seqValue(messages[mid]) > 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

function lowerBoundSeq(messages: Message[], fromIndex: number, target: number): number {
  let lo = fromIndex;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seqValue(messages[mid]) >= target) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

function upperBoundSeq(messages: Message[], fromIndex: number, target: number): number {
  let lo = fromIndex;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seqValue(messages[mid]) > target) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

function updateSeqList(chat: ChatCacheState, addedSorted: Message[], ops: SeqMergeOps | null): void {
  const addedSeqs = extractSortedPositiveSeqs(addedSorted);
  if (!addedSeqs.length) return;
  if (!chat.seqList.length) {
    chat.seqList = addedSeqs;
    return;
  }

  if (ops) {
    try {
      chat.seqList = ops.mergeSortedUnique(chat.seqList, addedSeqs);
      return;
    } catch {
      // ignore and fallback
    }
  }

  chat.seqList = mergeSortedUniqueNumbers(chat.seqList, addedSeqs);
}

function mergeSortedUniqueNumbers(existing: number[], incoming: number[]): number[] {
  if (!existing.length) return incoming.slice();
  if (!incoming.length) return existing.slice();

  const out: number[] = [];
  let i = 0;
  let j = 0;
  let last: number | null = null;

  while (i < existing.length || j < incoming.length) {
    let next: number;

    if (j >= incoming.length) {
      next = existing[i];
      i += 1;
    } else if (i >= existing.length) {
      next = incoming[j];
      j += 1;
    } else if (existing[i] <= incoming[j]) {
      next = existing[i];
      i += 1;
    } else {
      next = incoming[j];
      j += 1;
    }

    if (last !== null && next === last) continue;
    out.push(next);
    last = next;
  }

  return out;
}
