import type { Message } from '../../../types/chat';
import { LruCache } from './lru';

export interface SeqMergeOps {
  mergeSortedUnique(existing: number[], incoming: number[]): number[];
  diffSortedUnique?(existing: number[], incoming: number[]): number[];
  mergeAndDiffSortedUnique?(
    existing: number[],
    incoming: number[],
  ): { merged: number[]; added: number[] };
}

export interface ChatCacheState {
  chatId: string;
  isGroup: boolean;
  retentionAnchor: 'latest' | 'history';

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
  // 记录每位群成员的非本人最大已读 seq，用于按消息精确计算群聊 readCount
  memberReadSeq: Map<string, number>;

  // Paging state (unified cursor API).
  hasMore: boolean;
  nextBeforeSeq: number | null;
}

export class ChatCoreStore {
  private readonly chats: LruCache<string, ChatCacheState>;
  private seqMergeOps: SeqMergeOps | null = null;
  private onChatEvicted: ((chat: ChatCacheState) => void) | null = null;
  private currentUserId: string | null = null;

  activeChatId: string | null = null;
  activeIsGroup = false;
  activeLoadSeq = 0;

  constructor(limit: number) {
    this.chats = new LruCache(limit);
  }

  setCurrentUserId(userId: string | null): void {
    this.currentUserId = userId ? String(userId) : null;
  }

  setSeqMergeOps(ops: SeqMergeOps | null): void {
    this.seqMergeOps = ops;
  }

  setOnChatEvicted(cb: ((chat: ChatCacheState) => void) | null): void {
    this.onChatEvicted = cb;
  }

  getOrCreate(chatId: string, isGroup: boolean): ChatCacheState {
    const cached = this.chats.get(chatId);
    if (cached) return cached;

    const next: ChatCacheState = {
      chatId,
      isGroup,
      retentionAnchor: 'latest',
      messages: [],
      entityById: new Map(),
      ids: new Set(),
      seqSet: new Set(),
      seqList: [],
      minSeq: null,
      maxSeq: null,
      readReceiptSeq: 0,
      readReceiptReadCount: 0,
      memberReadSeq: new Map(),
      hasMore: true,
      nextBeforeSeq: null,
    };
    const evicted = this.chats.set(chatId, next);
    if (evicted.length && this.onChatEvicted) {
      for (const item of evicted) {
        this.onChatEvicted(item.value);
      }
    }
    return next;
  }

  setActive(chatId: string, isGroup: boolean, loadSeq: number): ChatCacheState {
    this.activeChatId = chatId;
    this.activeIsGroup = isGroup;
    this.activeLoadSeq = loadSeq;
    const chat = this.getOrCreate(chatId, isGroup);
    chat.isGroup = isGroup;
    chat.retentionAnchor = 'latest';
    return chat;
  }

  getActive(): ChatCacheState | null {
    if (!this.activeChatId) return null;
    return this.getOrCreate(this.activeChatId, this.activeIsGroup);
  }

  /**
   * 仅读取已缓存的会话状态，不触发 LRU 创建新占位项
   */
  getChat(chatId: string): ChatCacheState | undefined {
    return this.chats.get(chatId);
  }

  private applyKnownReadWatermarksToMessage(chat: ChatCacheState, raw: Message): Message {
    const seq = normalizePositiveSeq(raw?.seq);
    if (seq === null) return raw;
    if (this.currentUserId && raw.senderId !== this.currentUserId) return raw;

    const isGroup = chat.isGroup || Boolean(raw.isGroupChat);
    if (isGroup) {
      const mappedCount = chat.memberReadSeq.size > 0
        ? this.countReadersAtOrAbove(chat.memberReadSeq, seq)
        : 0;
      const fallbackCount = seq <= chat.readReceiptSeq ? chat.readReceiptReadCount : 0;
      const candidateCount = Math.max(mappedCount, fallbackCount, raw.readCount ?? 0);
      if (candidateCount > 0 && (raw.status !== 'read' || raw.readCount !== candidateCount)) {
        return { ...raw, status: 'read', readCount: candidateCount };
      }
      return raw;
    }

    let maxPartnerSeq = chat.readReceiptSeq;
    for (const [readerId, readerSeq] of chat.memberReadSeq.entries()) {
      if (raw.senderId && readerId === raw.senderId) continue;
      if (readerSeq > maxPartnerSeq) maxPartnerSeq = readerSeq;
    }
    // 未显式注入 currentUserId 时，跳过已知读者本人发出的消息
    if (!this.currentUserId && raw.senderId && chat.memberReadSeq.has(raw.senderId) && maxPartnerSeq === chat.readReceiptSeq) {
      return raw;
    }
    if (seq <= maxPartnerSeq && raw.status !== 'read') {
      return { ...raw, status: 'read' };
    }
    return raw;
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

    const deduped: Message[] = [];
    for (const rawMsg of messages) {
      if (!rawMsg?.id) continue;
      if (chat.ids.has(rawMsg.id)) continue;
      const seq = normalizePositiveSeq(rawMsg.seq);
      if (seq !== null && chat.seqSet.has(seq)) continue;
      const m = this.applyKnownReadWatermarksToMessage(chat, rawMsg);
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
    const canUseSeqPlan =
      !!(ops?.mergeAndDiffSortedUnique || ops?.diffSortedUnique) &&
      incoming.length >= 32 &&
      chat.messages.length >= 64;

    const incomingSeqs = extractSortedPositiveSeqs(incoming);

    let newSeqSet: Set<number> | null = null;
    let seqPlan: { merged: number[]; added: number[] } | null = null;
    if (canUseSeqPlan) {
      try {
        const existingSeqs = chat.seqList;
        if (incomingSeqs.length) {
          if (ops?.mergeAndDiffSortedUnique) {
            seqPlan = ops.mergeAndDiffSortedUnique(existingSeqs, incomingSeqs);
          } else if (ops?.diffSortedUnique) {
            seqPlan = {
              merged: [],
              added: ops.diffSortedUnique(existingSeqs, incomingSeqs),
            };
          }
          if (seqPlan) {
            newSeqSet = new Set(seqPlan.added);
          }
        }
      } catch {
        // ignore and fallback to Set-based dedupe below.
      }
    }

    const added: Message[] = [];
    for (const rawMsg of incoming) {
      if (!rawMsg?.id) continue;
      if (chat.ids.has(rawMsg.id)) continue;

      const seq = normalizePositiveSeq(rawMsg.seq);
      if (seq !== null) {
        // Fast path for large batches: rely on wasm diff result when available.
        if (newSeqSet) {
          if (!newSeqSet.has(seq)) continue;
        } else if (chat.seqSet.has(seq)) {
          continue;
        }
      }

      const m = this.applyKnownReadWatermarksToMessage(chat, rawMsg);
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
    const seqPlanMerged = resolveMergedSeqPlan(seqPlan, addedSorted);
    const addedRange = computeSeqRange(addedSorted);

    if (!chat.messages.length) {
      chat.messages = addedSorted;
      chat.minSeq = addedRange.minSeq;
      chat.maxSeq = addedRange.maxSeq;
      chat.seqList = seqPlanMerged || extractSortedPositiveSeqs(addedSorted);
      return { added: addedSorted };
    }

    if (addedRange.maxSeq !== null && currentRange.minSeq !== null && addedRange.maxSeq <= currentRange.minSeq) {
      // Incoming is entirely older (or equal) to the current head => prepend.
      chat.messages = addedSorted.concat(chat.messages);
      chat.minSeq = addedRange.minSeq ?? chat.minSeq;
      updateSeqList(chat, addedSorted, ops, seqPlanMerged);
      // maxSeq unchanged
      return { added: addedSorted };
    }

    if (addedRange.minSeq !== null && currentRange.maxSeq !== null && addedRange.minSeq >= currentRange.maxSeq) {
      // Incoming is entirely newer (or equal) to current tail => append.
      chat.messages = chat.messages.concat(addedSorted);
      chat.maxSeq = addedRange.maxSeq ?? chat.maxSeq;
      updateSeqList(chat, addedSorted, ops, seqPlanMerged);
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
    updateSeqList(chat, addedSorted, ops, seqPlanMerged);

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

  trimNewest(chatId: string, maxMessages: number): { removedIds: string[] } {
    const chat = this.chats.get(chatId);
    if (!chat) return { removedIds: [] };
    if (maxMessages <= 0) return { removedIds: [] };
    if (chat.messages.length <= maxMessages) return { removedIds: [] };

    const excess = chat.messages.length - maxMessages;
    const keepUntil = Math.max(0, chat.messages.length - excess);
    const removed = chat.messages.slice(keepUntil);
    const removedIds = removed.map((m) => m?.id).filter(Boolean) as string[];

    chat.messages = chat.messages.slice(0, keepUntil);
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

  private countReadersAtOrAbove(memberReadSeq: Map<string, number>, seq: number): number {
    let count = 0;
    for (const readerSeq of memberReadSeq.values()) {
      if (readerSeq >= seq) count += 1;
    }
    return count;
  }

  /**
   * 应用服务端权威 readState 摘要，校准内存及缓存消息的已读状态与群聊 readCount。
   */
  applyServerReadState(
    chatId: string,
    readState: {
      partnerLastReadSeq?: number | null;
      readWatermarks?: Array<{ userId: string; lastReadSeq: number }>;
    } | null | undefined,
    currentUserId: string,
  ): Array<{ id: string; status?: Message['status']; readCount?: number }> {
    const chat = this.chats.get(chatId);
    if (!chat || !readState || !currentUserId) return [];

    const hasWatermarks = Array.isArray(readState.readWatermarks);
    if (hasWatermarks) {
      chat.memberReadSeq.clear();
      for (const watermark of readState.readWatermarks!) {
        const uid = typeof watermark?.userId === 'string' ? watermark.userId : '';
        const lastReadSeq = typeof watermark?.lastReadSeq === 'number' ? Math.floor(watermark.lastReadSeq) : 0;
        if (!uid || uid === currentUserId || lastReadSeq <= 0) continue;
        const prev = chat.memberReadSeq.get(uid) ?? 0;
        if (lastReadSeq > prev) {
          chat.memberReadSeq.set(uid, lastReadSeq);
        }
      }
    }

    const updates: Array<{ id: string; status?: Message['status']; readCount?: number }> = [];
    const firstSeqIndex = findFirstPositiveSeqIndex(chat.messages);
    const partnerSeq = typeof readState.partnerLastReadSeq === 'number' && Number.isFinite(readState.partnerLastReadSeq)
      ? Math.max(0, Math.floor(readState.partnerLastReadSeq))
      : null;

    let maxWatermarkSeq = partnerSeq ?? 0;
    for (const readerSeq of chat.memberReadSeq.values()) {
      if (readerSeq > maxWatermarkSeq) maxWatermarkSeq = readerSeq;
    }

    if (firstSeqIndex < chat.messages.length) {
      for (let i = firstSeqIndex; i < chat.messages.length; i += 1) {
        const msg = chat.messages[i];
        const msgSeq = msg.seq ?? 0;
        if (!msgSeq || msg.senderId !== currentUserId) continue;

        const isGroup = chat.isGroup || Boolean(msg.isGroupChat);
        let nextStatus: Message['status'] = msg.status;
        let nextReadCount = msg.readCount;

        if (isGroup) {
          if (hasWatermarks || chat.memberReadSeq.size > 0) {
            const count = this.countReadersAtOrAbove(chat.memberReadSeq, msgSeq);
            if (count > 0) {
              nextStatus = 'read';
              nextReadCount = count;
            } else if (hasWatermarks && (msg.status === 'read' || (typeof msg.readCount === 'number' && msg.readCount > 0))) {
              // 纠正早期因自读 Bug 写入 IndexedDB 的误判已读状态
              nextStatus = 'delivered';
              nextReadCount = 0;
            }
          }
        } else {
          const effectivePartnerSeq = partnerSeq ?? (maxWatermarkSeq > 0 ? maxWatermarkSeq : null);
          if (effectivePartnerSeq !== null) {
            if (msgSeq <= effectivePartnerSeq) {
              nextStatus = 'read';
            } else if (msg.status === 'read') {
              nextStatus = 'delivered';
            }
          }
        }

        if (nextStatus !== msg.status || nextReadCount !== msg.readCount) {
          chat.messages[i] = { ...msg, status: nextStatus, readCount: nextReadCount };
          chat.entityById.set(msg.id, chat.messages[i]);
          updates.push({ id: msg.id, status: nextStatus, readCount: nextReadCount });
        }
      }
    }

    if (maxWatermarkSeq > chat.readReceiptSeq) {
      chat.readReceiptSeq = maxWatermarkSeq;
    }
    if (chat.isGroup && chat.memberReadSeq.size > 0) {
      chat.readReceiptReadCount = Math.max(chat.readReceiptReadCount, chat.memberReadSeq.size);
    }

    return updates;
  }

  applyReadReceipt(
    chatId: string,
    seq: number,
    readCount: number,
    currentUserId: string,
    readerId?: string,
  ): Array<{ id: string; status?: Message['status']; readCount?: number }> {
    if (!chatId || typeof seq !== 'number' || seq <= 0) return [];
    // 忽略发送者本人或当前用户自己上报的已读回执
    if (readerId && currentUserId && readerId === currentUserId) return [];

    // 即便会话尚未加载或已被 LRU 淘汰，仍保留已读水位供后续合入消息同步升级为已读
    const chat = this.getOrCreate(chatId, chatId.startsWith('g:'));

    const normalizedReaderId = typeof readerId === 'string' && readerId.trim() ? readerId.trim() : '';
    let readerAdvanced = false;
    if (normalizedReaderId) {
      const prevReaderSeq = chat.memberReadSeq.get(normalizedReaderId) ?? 0;
      const nextReaderSeq = Math.max(prevReaderSeq, Math.floor(seq));
      if (nextReaderSeq > prevReaderSeq) {
        chat.memberReadSeq.set(normalizedReaderId, nextReaderSeq);
        readerAdvanced = true;
      }
    }

    if (chat.isGroup && readCount <= 0 && !readerAdvanced) {
      return [];
    }

    const updates: Array<{ id: string; status?: Message['status']; readCount?: number }> = [];
    const prevSeq = chat.readReceiptSeq;
    const prevReadCount = chat.readReceiptReadCount;

    if (!normalizedReaderId && seq < prevSeq) return [];

    // 群聊支持多成员在不同 seq 位点推进已读人数，需要从 seq=1 起按成员水位重算
    const usePerMemberGroupCalc = chat.isGroup && (Boolean(normalizedReaderId) || chat.memberReadSeq.size > 0);
    const shouldBackfillReadCount = chat.isGroup && readCount > prevReadCount;
    const minSeqToUpdate = usePerMemberGroupCalc ? 1 : (seq > prevSeq ? prevSeq + 1 : 1);
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
      if (!usePerMemberGroupCalc && !shouldBackfillReadCount && msgSeq < minSeqToUpdate) continue;
      if (msg.senderId !== currentUserId) continue;

      const isGroup = chat.isGroup || Boolean(msg.isGroupChat);
      if (isGroup && readCount <= 0 && !chat.memberReadSeq.size) continue;

      let nextReadCount = msg.readCount;
      if (isGroup) {
        const mappedCount = chat.memberReadSeq.size > 0
          ? this.countReadersAtOrAbove(chat.memberReadSeq, msgSeq)
          : 0;
        const candidateCount = Math.max(mappedCount, msgSeq <= seq ? readCount : 0, msg.readCount ?? 0);
        if (candidateCount <= 0) continue;
        nextReadCount = candidateCount;
      }

      const nextStatus: Message['status'] = 'read';
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

  /**
   * 原地更新内存缓存中的单条消息正文与编辑时间戳
   */
  updateMessageContent(chatId: string, messageId: string, content: string, editedAt?: string): Message | null {
    const chat = this.chats.get(chatId);
    if (!chat || !messageId) return null;
    const existing = chat.entityById.get(messageId);
    if (!existing) return null;

    const updated: Message = {
      ...existing,
      content,
      editedAt: editedAt || existing.editedAt || new Date().toISOString(),
    };
    chat.entityById.set(messageId, updated);
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      chat.messages[idx] = updated;
    }
    return updated;
  }

  /**
   * 从内存缓存中移除被撤回/删除的单条消息，并重算序号范围与最新一条消息
   */
  removeMessage(chatId: string, messageId: string): { removed: boolean; nextLastMessage: Message | null } {
    const chat = this.chats.get(chatId);
    if (!chat || !messageId) {
      return { removed: false, nextLastMessage: null };
    }
    const existing = chat.entityById.get(messageId);
    if (!existing) {
      const last = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
      return { removed: false, nextLastMessage: last };
    }

    chat.entityById.delete(messageId);
    chat.ids.delete(messageId);
    const seq = normalizePositiveSeq(existing.seq);
    if (seq !== null) {
      chat.seqSet.delete(seq);
    }
    chat.messages = chat.messages.filter((m) => m.id !== messageId);
    ({ minSeq: chat.minSeq, maxSeq: chat.maxSeq } = computeSeqRange(chat.messages));
    chat.seqList = extractSortedPositiveSeqs(chat.messages);

    const nextLastMessage = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
    return { removed: true, nextLastMessage };
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

function resolveMergedSeqPlan(
  plan: { merged: number[]; added: number[] } | null,
  addedSorted: Message[],
): number[] | null {
  if (!plan?.merged?.length) return null;
  const addedSeqs = extractSortedPositiveSeqs(addedSorted);
  if (addedSeqs.length !== plan.added.length) return null;
  for (let i = 0; i < addedSeqs.length; i += 1) {
    if (addedSeqs[i] !== plan.added[i]) return null;
  }
  return plan.merged;
}

function updateSeqList(
  chat: ChatCacheState,
  addedSorted: Message[],
  ops: SeqMergeOps | null,
  mergedSeqPlan?: number[] | null,
): void {
  if (Array.isArray(mergedSeqPlan) && mergedSeqPlan.length >= chat.seqList.length) {
    chat.seqList = mergedSeqPlan.slice();
    return;
  }

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
