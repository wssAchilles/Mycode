/**
 * RealtimeQueue — batch processing queue for realtime events on main thread.
 *
 * Single responsibility: queue and batch realtime events for processing.
 * No patch processing, no entity caching, no Zustand state.
 */

import type { SocketRealtimeEvent } from '../../../../core/chat/realtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealtimeBatch {
  events: SocketRealtimeEvent[];
  enqueuedAt: number;
}

export interface RealtimeQueueConfig {
  hardMax: number;
  batchSize: number;
  warnAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RealtimeQueueConfig = {
  hardMax: 6_000,
  batchSize: 260,
  warnAt: 2_000,
};

// ---------------------------------------------------------------------------
// Realtime queue
// ---------------------------------------------------------------------------

export class RealtimeQueue {
  private readonly queue: RealtimeBatch[] = [];
  private totalEvents = 0;
  private droppedCount = 0;
  private pressureWarned = false;
  private readonly config: RealtimeQueueConfig;

  constructor(config: Partial<RealtimeQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  enqueue(events: SocketRealtimeEvent[]): boolean {
    if (!events.length) return true;

    // Check if we need to drop
    if (this.totalEvents + events.length > this.config.hardMax) {
      const overflow = this.totalEvents + events.length - this.config.hardMax;
      const dropped = events.slice(0, overflow);
      this.droppedCount += dropped.length;

      // Keep only events that fit
      const remaining = events.slice(overflow);
      if (!remaining.length) return false;

      this.queue.push({
        events: remaining,
        enqueuedAt: Date.now(),
      });
      this.totalEvents += remaining.length;
    } else {
      this.queue.push({
        events,
        enqueuedAt: Date.now(),
      });
      this.totalEvents += events.length;
    }

    // Check pressure
    if (this.totalEvents >= this.config.warnAt) {
      if (!this.pressureWarned) {
        this.pressureWarned = true;
        console.warn('[realtimeQueue] pressure warning', { totalEvents: this.totalEvents });
      }
    } else if (this.pressureWarned && this.totalEvents < Math.floor(this.config.warnAt / 2)) {
      this.pressureWarned = false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Dequeue
  // -------------------------------------------------------------------------

  dequeueBatch(): SocketRealtimeEvent[] {
    if (this.queue.length === 0) return [];

    const batch: SocketRealtimeEvent[] = [];
    let remaining = this.config.batchSize;

    while (remaining > 0 && this.queue.length > 0) {
      const head = this.queue[0];
      if (head.events.length <= remaining) {
        batch.push(...head.events);
        remaining -= head.events.length;
        this.totalEvents -= head.events.length;
        this.queue.shift();
      } else {
        batch.push(...head.events.slice(0, remaining));
        head.events.splice(0, remaining);
        this.totalEvents -= remaining;
        remaining = 0;
      }
    }

    return batch;
  }

  dequeueAll(): SocketRealtimeEvent[] {
    const all: SocketRealtimeEvent[] = [];
    for (const batch of this.queue) {
      all.push(...batch.events);
    }
    this.queue.length = 0;
    this.totalEvents = 0;
    return all;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  size(): number {
    return this.totalEvents;
  }

  batchCount(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.totalEvents === 0;
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
    this.totalEvents = 0;
    this.droppedCount = 0;
    this.pressureWarned = false;
  }

  pruneStale(maxAgeMs: number = 30_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    while (this.queue.length > 0 && this.queue[0].enqueuedAt < cutoff) {
      const batch = this.queue.shift()!;
      this.totalEvents -= batch.events.length;
      pruned += batch.events.length;
    }

    return pruned;
  }
}
