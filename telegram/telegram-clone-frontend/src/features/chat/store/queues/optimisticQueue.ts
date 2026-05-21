/**
 * OptimisticQueue — manage optimistic message mappings and pending messages.
 *
 * Single responsibility: track clientTempId → messageId mappings for optimistic updates.
 * No patch processing, no entity caching, no Zustand state.
 */

import type { Message } from '../../../../types/chat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimisticMapping {
  clientTempId: string;
  messageId: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OPTIMISTIC_AGE_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// Optimistic queue
// ---------------------------------------------------------------------------

export class OptimisticQueue {
  private readonly tempIdToMessageId = new Map<string, string>();
  private readonly messageIdToTempId = new Map<string, string>();
  private readonly createdAt = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------------

  add(clientTempId: string, messageId: string): void {
    // Remove existing mapping if any
    this.removeByTempId(clientTempId);
    this.removeByMessageId(messageId);

    this.tempIdToMessageId.set(clientTempId, messageId);
    this.messageIdToTempId.set(messageId, clientTempId);
    this.createdAt.set(clientTempId, Date.now());
  }

  removeByTempId(clientTempId: string): boolean {
    const messageId = this.tempIdToMessageId.get(clientTempId);
    if (!messageId) return false;

    this.tempIdToMessageId.delete(clientTempId);
    this.messageIdToTempId.delete(messageId);
    this.createdAt.delete(clientTempId);
    return true;
  }

  removeByMessageId(messageId: string): boolean {
    const clientTempId = this.messageIdToTempId.get(messageId);
    if (!clientTempId) return false;

    this.tempIdToMessageId.delete(clientTempId);
    this.messageIdToTempId.delete(messageId);
    this.createdAt.delete(clientTempId);
    return true;
  }

  clear(): void {
    this.tempIdToMessageId.clear();
    this.messageIdToTempId.clear();
    this.createdAt.clear();
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  getMessageId(clientTempId: string): string | undefined {
    return this.tempIdToMessageId.get(clientTempId);
  }

  getTempId(messageId: string): string | undefined {
    return this.messageIdToTempId.get(messageId);
  }

  hasTempId(clientTempId: string): boolean {
    return this.tempIdToMessageId.has(clientTempId);
  }

  hasMessageId(messageId: string): boolean {
    return this.messageIdToTempId.has(messageId);
  }

  size(): number {
    return this.tempIdToMessageId.size;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  pruneStale(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [clientTempId, createdAt] of this.createdAt.entries()) {
      if (now - createdAt > MAX_OPTIMISTIC_AGE_MS) {
        this.removeByTempId(clientTempId);
        pruned += 1;
      }
    }

    return pruned;
  }

  // -------------------------------------------------------------------------
  // Iteration
  // -------------------------------------------------------------------------

  *entries(): IterableIterator<OptimisticMapping> {
    for (const [clientTempId, messageId] of this.tempIdToMessageId.entries()) {
      yield {
        clientTempId,
        messageId,
        createdAt: this.createdAt.get(clientTempId) ?? 0,
      };
    }
  }

  *tempIds(): IterableIterator<string> {
    yield* this.tempIdToMessageId.keys();
  }

  *messageIds(): IterableIterator<string> {
    yield* this.messageIdToTempId.keys();
  }
}
