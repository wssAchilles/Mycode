/**
 * EntityCache — LRU cache for Message entities with deferred update support.
 *
 * Single responsibility: entity caching and deferred update merging.
 * No projection management, no patch processing, no Zustand state.
 */

import type { Message } from '../../../../types/chat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeferredUpdate {
  status?: Message['status'];
  readCount?: number;
}

// ---------------------------------------------------------------------------
// Entity cache
// ---------------------------------------------------------------------------

export class EntityCache {
  private readonly cache = new Map<string, Message>();
  private readonly deferred = new Map<string, DeferredUpdate>();
  private readonly limit: number;

  constructor(limit: number = 1800) {
    this.limit = Math.max(100, limit);
  }

  // -------------------------------------------------------------------------
  // Core CRUD
  // -------------------------------------------------------------------------

  get(id: string): Message | undefined {
    const cached = this.cache.get(id);
    if (!cached) return undefined;

    // Move to end (most recently used)
    this.cache.delete(id);
    this.cache.set(id, cached);
    return cached;
  }

  set(message: Message): void {
    if (!message?.id) return;

    // Apply deferred updates
    const deferred = this.deferred.get(message.id);
    let next = message;
    if (deferred) {
      next = {
        ...message,
        status: deferred.status ?? message.status,
        readCount: deferred.readCount ?? message.readCount,
      };
      this.deferred.delete(message.id);
    }

    // Move to end if exists
    if (this.cache.has(next.id)) {
      this.cache.delete(next.id);
    }
    this.cache.set(next.id, next);

    // Evict oldest if over limit
    while (this.cache.size > this.limit) {
      const oldestId = this.cache.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.cache.delete(oldestId);
    }
  }

  delete(id: string): boolean {
    this.deferred.delete(id);
    return this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
    this.deferred.clear();
  }

  // -------------------------------------------------------------------------
  // Deferred updates
  // -------------------------------------------------------------------------

  deferUpdate(id: string, update: DeferredUpdate): void {
    const prev = this.deferred.get(id);
    this.deferred.set(id, {
      status: update.status ?? prev?.status,
      readCount: update.readCount ?? prev?.readCount,
    });
  }

  getDeferred(id: string): DeferredUpdate | undefined {
    return this.deferred.get(id);
  }

  deleteDeferred(id: string): boolean {
    return this.deferred.delete(id);
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  has(id: string): boolean {
    return this.cache.has(id);
  }

  size(): number {
    return this.cache.size;
  }

  deferredSize(): number {
    return this.deferred.size;
  }

  // -------------------------------------------------------------------------
  // Batch operations
  // -------------------------------------------------------------------------

  setMany(messages: Message[]): void {
    for (const msg of messages) {
      this.set(msg);
    }
  }

  deleteMany(ids: string[]): void {
    for (const id of ids) {
      this.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Iteration
  // -------------------------------------------------------------------------

  *entries(): IterableIterator<[string, Message]> {
    yield* this.cache.entries();
  }

  *values(): IterableIterator<Message> {
    yield* this.cache.values();
  }

  *ids(): IterableIterator<string> {
    yield* this.cache.keys();
  }
}
