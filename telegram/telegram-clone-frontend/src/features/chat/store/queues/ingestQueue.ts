/**
 * IngestQueue — batch processing queue for message ingestion on main thread.
 *
 * Single responsibility: queue and batch messages for ingestion into the store.
 * No patch processing, no entity caching, no Zustand state.
 */

import type { Message } from '../../../../types/chat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestBatch {
  messages: Message[];
  enqueuedAt: number;
}

export interface IngestQueueConfig {
  hardMax: number;
  batchSize: number;
  warnAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: IngestQueueConfig = {
  hardMax: 4_800,
  batchSize: 160,
  warnAt: 3_200,
};

// ---------------------------------------------------------------------------
// Ingest queue
// ---------------------------------------------------------------------------

export class IngestQueue {
  private readonly queue: IngestBatch[] = [];
  private totalMessages = 0;
  private droppedCount = 0;
  private pressureWarned = false;
  private readonly config: IngestQueueConfig;

  constructor(config: Partial<IngestQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  enqueue(messages: Message[]): boolean {
    if (!messages.length) return true;

    // Check if we need to drop
    if (this.totalMessages + messages.length > this.config.hardMax) {
      const overflow = this.totalMessages + messages.length - this.config.hardMax;
      const dropped = messages.slice(0, overflow);
      this.droppedCount += dropped.length;

      // Keep only messages that fit
      const remaining = messages.slice(overflow);
      if (!remaining.length) return false;

      this.queue.push({
        messages: remaining,
        enqueuedAt: Date.now(),
      });
      this.totalMessages += remaining.length;
    } else {
      this.queue.push({
        messages,
        enqueuedAt: Date.now(),
      });
      this.totalMessages += messages.length;
    }

    // Check pressure
    if (this.totalMessages >= this.config.warnAt) {
      if (!this.pressureWarned) {
        this.pressureWarned = true;
        console.warn('[ingestQueue] pressure warning', { totalMessages: this.totalMessages });
      }
    } else if (this.pressureWarned && this.totalMessages < Math.floor(this.config.warnAt / 2)) {
      this.pressureWarned = false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Dequeue
  // -------------------------------------------------------------------------

  dequeueBatch(): Message[] {
    if (this.queue.length === 0) return [];

    const batch: Message[] = [];
    let remaining = this.config.batchSize;

    while (remaining > 0 && this.queue.length > 0) {
      const head = this.queue[0];
      if (head.messages.length <= remaining) {
        batch.push(...head.messages);
        remaining -= head.messages.length;
        this.totalMessages -= head.messages.length;
        this.queue.shift();
      } else {
        batch.push(...head.messages.slice(0, remaining));
        head.messages.splice(0, remaining);
        this.totalMessages -= remaining;
        remaining = 0;
      }
    }

    return batch;
  }

  dequeueAll(): Message[] {
    const all: Message[] = [];
    for (const batch of this.queue) {
      all.push(...batch.messages);
    }
    this.queue.length = 0;
    this.totalMessages = 0;
    return all;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  size(): number {
    return this.totalMessages;
  }

  batchCount(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.totalMessages === 0;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  isPressureWarned(): boolean {
    return this.pressureWarned;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  clear(): void {
    this.queue.length = 0;
    this.totalMessages = 0;
    this.droppedCount = 0;
    this.pressureWarned = false;
  }

  pruneStale(maxAgeMs: number = 30_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    while (this.queue.length > 0 && this.queue[0].enqueuedAt < cutoff) {
      const batch = this.queue.shift()!;
      this.totalMessages -= batch.messages.length;
      pruned += batch.messages.length;
    }

    return pruned;
  }

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  deduplicate(): number {
    const seen = new Set<string>();
    let deduped = 0;

    for (const batch of this.queue) {
      const before = batch.messages.length;
      batch.messages = batch.messages.filter(msg => {
        if (!msg?.id || seen.has(msg.id)) {
          deduped += 1;
          return false;
        }
        seen.add(msg.id);
        return true;
      });
      this.totalMessages -= before - batch.messages.length;
    }

    return deduped;
  }
}
