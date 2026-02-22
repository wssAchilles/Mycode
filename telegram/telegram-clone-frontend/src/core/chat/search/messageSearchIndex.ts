import type { Message } from '../../../types/chat';

const DEFAULT_MAX_INDEXED_MESSAGES = 6_000;
const DEFAULT_RECENT_MAX_INDEXED_MESSAGES = 1_200;
const MAX_TOKENS_PER_MESSAGE = 64;

let TOKEN_RE: RegExp;
try {
  TOKEN_RE = /[\p{L}\p{N}_]+/gu;
} catch {
  TOKEN_RE = /[A-Za-z0-9_\u4e00-\u9fff]+/g;
}

type IndexedMessage = {
  message: Message;
  haystack: string;
  tokens: string[];
  seq: number;
  timestampMs: number;
};

function normalizeSeq(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeTimestampMs(value: unknown): number {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function buildHaystack(message: Message): string {
  const chunks: string[] = [];
  if (message.content) chunks.push(message.content);
  if (message.fileName) chunks.push(message.fileName);
  if (message.senderUsername) chunks.push(message.senderUsername);
  if (Array.isArray(message.attachments) && message.attachments.length) {
    for (const item of message.attachments) {
      if (item?.fileName) chunks.push(item.fileName);
    }
  }
  return chunks.join(' ').toLowerCase();
}

function tokenizeText(text: string): string[] {
  if (!text) return [];
  const set = new Set<string>();
  const matches = text.match(TOKEN_RE);
  if (!matches) return [];

  for (const token of matches) {
    const next = token.trim().toLowerCase();
    if (!next) continue;
    set.add(next);
    if (set.size >= MAX_TOKENS_PER_MESSAGE) break;
  }
  return Array.from(set.values());
}

function tokenizeQuery(query: string): string[] {
  const terms = tokenizeText(query.trim().toLowerCase());
  if (terms.length <= 1) return terms;
  return terms.slice(0, 8);
}

function compareAsc(a: IndexedMessage, b: IndexedMessage): number {
  if (a.seq && b.seq && a.seq !== b.seq) return a.seq - b.seq;
  if (a.seq && !b.seq) return 1;
  if (!a.seq && b.seq) return -1;
  if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
  return (a.message.id || '').localeCompare(b.message.id || '');
}

function calcSignature(messages: Message[]): string {
  if (!messages.length) return '0';
  const first = messages[0];
  const last = messages[messages.length - 1];
  return `${messages.length}:${first?.id || ''}:${last?.id || ''}:${last?.seq || 0}`;
}

class ChatMessageSearchIndex {
  private readonly maxIndexedMessages: number;
  private readonly entriesById = new Map<string, IndexedMessage>();
  private readonly postings = new Map<string, Set<string>>();
  private orderAsc: string[] = [];
  private orderDirty = false;
  private signature = '0';

  constructor(maxIndexedMessages: number) {
    this.maxIndexedMessages = Math.max(500, maxIndexedMessages || DEFAULT_MAX_INDEXED_MESSAGES);
  }

  clear() {
    this.entriesById.clear();
    this.postings.clear();
    this.orderAsc = [];
    this.orderDirty = false;
    this.signature = '0';
  }

  replace(messages: Message[]) {
    this.clear();
    if (!messages.length) return;

    const start = messages.length > this.maxIndexedMessages ? messages.length - this.maxIndexedMessages : 0;
    for (let i = start; i < messages.length; i += 1) {
      this.upsertOne(messages[i]);
    }
    this.signature = calcSignature(messages);
    this.compactToBudget();
  }

  ensure(messages: Message[]) {
    if (this.signature === 'dirty' && this.entriesById.size > 0) return;
    const nextSignature = calcSignature(messages);
    if (this.signature === nextSignature) return;
    this.replace(messages);
  }

  upsert(messages: Message[]) {
    if (!messages.length) return;
    for (const message of messages) {
      this.upsertOne(message);
    }
    this.compactToBudget();
    this.signature = 'dirty';
  }

  remove(ids: string[]) {
    if (!ids.length) return;
    for (const id of ids) {
      this.removeOne(id);
    }
    this.signature = 'dirty';
  }

  query(query: string, limit: number): Message[] {
    const terms = tokenizeQuery(query);
    if (!terms.length) return [];
    const max = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;

    const matchedIds = this.intersectTerms(terms);
    if (!matchedIds || matchedIds.size === 0) return [];

    this.ensureOrder();
    const out: Message[] = [];

    for (let i = this.orderAsc.length - 1; i >= 0; i -= 1) {
      if (out.length >= max) break;
      const id = this.orderAsc[i];
      if (!matchedIds.has(id)) continue;
      const entry = this.entriesById.get(id);
      if (!entry) continue;
      out.push(entry.message);
    }

    return out;
  }

  private upsertOne(message: Message) {
    if (!message?.id) return;

    const haystack = buildHaystack(message);
    const tokens = tokenizeText(haystack);
    const next: IndexedMessage = {
      message,
      haystack,
      tokens,
      seq: normalizeSeq(message.seq),
      timestampMs: normalizeTimestampMs(message.timestamp),
    };

    const prev = this.entriesById.get(message.id);
    if (prev) {
      this.detachPostings(message.id, prev.tokens);
    }

    this.entriesById.set(message.id, next);
    this.attachPostings(message.id, tokens);

    if (!prev) {
      this.orderAsc.push(message.id);
    }
    this.orderDirty = true;
  }

  private removeOne(id: string) {
    const prev = this.entriesById.get(id);
    if (!prev) return;
    this.detachPostings(id, prev.tokens);
    this.entriesById.delete(id);
    this.orderDirty = true;
  }

  private attachPostings(id: string, tokens: string[]) {
    for (const token of tokens) {
      const bucket = this.postings.get(token);
      if (bucket) {
        bucket.add(id);
      } else {
        this.postings.set(token, new Set([id]));
      }
    }
  }

  private detachPostings(id: string, tokens: string[]) {
    for (const token of tokens) {
      const bucket = this.postings.get(token);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) {
        this.postings.delete(token);
      }
    }
  }

  private ensureOrder() {
    if (!this.orderDirty) return;

    const alive = Array.from(this.entriesById.values());
    alive.sort(compareAsc);

    this.orderAsc = alive.map((entry) => entry.message.id);
    this.orderDirty = false;
  }

  private compactToBudget() {
    if (this.entriesById.size <= this.maxIndexedMessages) return;

    this.ensureOrder();
    const overflow = this.entriesById.size - this.maxIndexedMessages;
    if (overflow <= 0) return;

    const toRemove = this.orderAsc.slice(0, overflow);
    for (const id of toRemove) {
      this.removeOne(id);
    }
    this.ensureOrder();
  }

  private intersectTerms(terms: string[]): Set<string> | null {
    const postingSets: Set<string>[] = [];

    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting || posting.size === 0) {
        return null;
      }
      postingSets.push(posting);
    }

    postingSets.sort((a, b) => a.size - b.size);
    const [base, ...rest] = postingSets;
    if (!base) return null;

    const matched = new Set<string>();
    outer: for (const id of base.values()) {
      const entry = this.entriesById.get(id);
      if (!entry) continue;

      for (const posting of rest) {
        if (!posting.has(id)) {
          continue outer;
        }
      }

      // Defensive check for tokenization edge cases.
      for (const term of terms) {
        if (!entry.haystack.includes(term)) {
          continue outer;
        }
      }

      matched.add(id);
    }

    return matched;
  }
}

export class WorkerMessageSearchService {
  private readonly fullMaxIndexedMessages: number;
  private readonly recentMaxIndexedMessages: number;
  private readonly fullIndexByChat = new Map<string, ChatMessageSearchIndex>();
  private readonly recentIndexByChat = new Map<string, ChatMessageSearchIndex>();

  constructor(maxIndexedMessages = DEFAULT_MAX_INDEXED_MESSAGES) {
    this.fullMaxIndexedMessages = Math.max(500, maxIndexedMessages || DEFAULT_MAX_INDEXED_MESSAGES);
    this.recentMaxIndexedMessages = Math.min(
      this.fullMaxIndexedMessages,
      Math.max(300, Math.floor(this.fullMaxIndexedMessages * 0.22), DEFAULT_RECENT_MAX_INDEXED_MESSAGES),
    );
  }

  clearAll() {
    this.fullIndexByChat.clear();
    this.recentIndexByChat.clear();
  }

  clearChat(chatId: string) {
    this.fullIndexByChat.delete(chatId);
    this.recentIndexByChat.delete(chatId);
  }

  replaceChat(chatId: string, messages: Message[]) {
    if (!chatId) return;
    const full = this.getOrCreateFull(chatId);
    full.replace(messages);
    const recent = this.getOrCreateRecent(chatId);
    recent.replace(messages);
  }

  ensureChat(chatId: string, messages: Message[]) {
    if (!chatId) return;
    const full = this.getOrCreateFull(chatId);
    full.ensure(messages);
    const recent = this.getOrCreateRecent(chatId);
    recent.ensure(messages);
  }

  upsert(chatId: string, messages: Message[]) {
    if (!chatId || !messages.length) return;
    const full = this.getOrCreateFull(chatId);
    full.upsert(messages);
    const recent = this.getOrCreateRecent(chatId);
    recent.upsert(messages);
  }

  remove(chatId: string, ids: string[]) {
    if (!chatId || !ids.length) return;
    const full = this.fullIndexByChat.get(chatId);
    if (full) {
      full.remove(ids);
    }
    const recent = this.recentIndexByChat.get(chatId);
    if (recent) {
      recent.remove(ids);
    }
  }

  query(chatId: string, query: string, limit: number): Message[] {
    if (!chatId) return [];
    const index = this.fullIndexByChat.get(chatId);
    if (!index) return [];
    return index.query(query, limit);
  }

  queryLayered(chatId: string, query: string, limit: number): Message[] {
    if (!chatId) return [];
    const max = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    const recent = this.recentIndexByChat.get(chatId)?.query(query, Math.min(240, Math.max(max, max * 2))) || [];
    if (recent.length >= max) {
      return recent.slice(0, max);
    }

    const full = this.fullIndexByChat.get(chatId)?.query(query, Math.min(360, Math.max(max, max * 3))) || [];
    if (!full.length) return recent.slice(0, max);
    if (!recent.length) return full.slice(0, max);

    const out: Message[] = [];
    const seen = new Set<string>();
    for (const source of [recent, full]) {
      for (const item of source) {
        const id = item?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
        if (out.length >= max) {
          return out;
        }
      }
    }
    return out;
  }

  private getOrCreateFull(chatId: string): ChatMessageSearchIndex {
    const existing = this.fullIndexByChat.get(chatId);
    if (existing) return existing;
    const next = new ChatMessageSearchIndex(this.fullMaxIndexedMessages);
    this.fullIndexByChat.set(chatId, next);
    return next;
  }

  private getOrCreateRecent(chatId: string): ChatMessageSearchIndex {
    const existing = this.recentIndexByChat.get(chatId);
    if (existing) return existing;
    const next = new ChatMessageSearchIndex(this.recentMaxIndexedMessages);
    this.recentIndexByChat.set(chatId, next);
    return next;
  }
}
