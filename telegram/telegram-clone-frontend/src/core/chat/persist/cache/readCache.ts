/**
 * ReadCache — in-memory LRU cache for persistence reads.
 *
 * Single responsibility: cache recent DB reads to avoid repeated queries.
 * No persistence writes, no sync logic, no message processing.
 */

import type { Message } from '../../../../types/chat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
  messages: Message[];
  cachedAt: number;
}

export interface ReadCacheConfig {
  maxSize: number;
  ttlMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ReadCacheConfig = {
  maxSize: 100,
  ttlMs: 30_000, // 30 seconds
};

// ---------------------------------------------------------------------------
// Read cache
// ---------------------------------------------------------------------------

export class ReadCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly config: ReadCacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config: Partial<ReadCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------------

  get(key: string): Message[] | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.cache.delete(key);
      this.misses += 1;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits += 1;
    return entry.messages;
  }

  set(key: string, messages: Message[]): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, {
      messages: [...messages], // Defensive copy
      cachedAt: Date.now(),
    });

    // Evict oldest if over limit
    while (this.cache.size > this.config.maxSize) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  // -------------------------------------------------------------------------
  // Invalidation by prefix
  // -------------------------------------------------------------------------

  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count += 1;
      }
    }
    return count;
  }

  invalidateByChatId(chatId: string): number {
    return this.invalidateByPrefix(`${chatId}::`);
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  size(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  // -------------------------------------------------------------------------
  // Key builders
  // -------------------------------------------------------------------------

  static buildKey(chatId: string, beforeSeq: number | null, limit: number): string {
    return `${chatId}::${beforeSeq ?? 'recent'}::${limit}`;
  }

  static buildRecentKey(chatId: string, limit: number): string {
    return `${chatId}::recent::${limit}`;
  }

  static buildBeforeKey(chatId: string, beforeSeq: number, limit: number): string {
    return `${chatId}::${beforeSeq}::${limit}`;
  }
}
