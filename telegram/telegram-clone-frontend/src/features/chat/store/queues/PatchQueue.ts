/**
 * PatchQueue — patch queuing, priority scheduling, and budget control.
 *
 * Single responsibility: patch queue management and dispatch.
 * No projection management, no entity caching, no Zustand state.
 */

import type { ChatPatch } from '../../../../core/chat/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PatchPriority = 'p0' | 'p1' | 'p2';

export interface PatchQueueConfig {
  hardMax: number;
  patchesPerDispatch: number;
  opsPerDispatch: number;
  priorityQuota: Record<PatchPriority, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PatchQueueConfig = {
  hardMax: 600,
  patchesPerDispatch: 12,
  opsPerDispatch: 120,
  priorityQuota: { p0: 4, p1: 4, p2: 4 },
};

const PRIORITY_ORDER: PatchPriority[] = ['p0', 'p1', 'p2'];

// ---------------------------------------------------------------------------
// Patch queue
// ---------------------------------------------------------------------------

export class PatchQueue {
  private readonly queues: Record<PatchPriority, ChatPatch[]> = {
    p0: [],
    p1: [],
    p2: [],
  };
  private readonly config: PatchQueueConfig;
  private droppedCount = 0;

  constructor(config: Partial<PatchQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  enqueue(patch: ChatPatch): boolean {
    const priority = this.getPriority(patch);

    // Drop low-priority patches if queue is full
    if (priority === 'p2' && this.totalSize() > this.config.hardMax) {
      this.droppedCount += 1;
      return false;
    }

    this.queues[priority].push(patch);
    this.trimBackpressure();
    return true;
  }

  // -------------------------------------------------------------------------
  // Dequeue
  // -------------------------------------------------------------------------

  dequeueBatch(): ChatPatch[] {
    const quotas: Record<PatchPriority, number> = { ...this.config.priorityQuota };
    const batch: ChatPatch[] = [];
    let ops = 0;

    while (batch.length < this.config.patchesPerDispatch) {
      let progressed = false;

      for (const priority of PRIORITY_ORDER) {
        const queue = this.queues[priority];
        if (!queue.length) continue;

        const quotaLeft = quotas[priority];
        if (quotaLeft <= 0 && batch.length > 0) continue;

        const next = queue[0];
        const nextOps = this.estimateOps(next);
        if (batch.length > 0 && ops + nextOps > this.config.opsPerDispatch) continue;

        queue.shift();
        batch.push(next);
        ops += nextOps;
        quotas[priority] = Math.max(0, quotaLeft - 1);
        progressed = true;

        if (batch.length >= this.config.patchesPerDispatch) break;
      }

      if (!progressed) break;
    }

    // If no batch formed, take one patch from highest priority queue
    if (!batch.length) {
      for (const priority of PRIORITY_ORDER) {
        const queue = this.queues[priority];
        if (!queue.length) continue;
        const next = queue.shift();
        if (next) batch.push(next);
        break;
      }
    }

    return batch;
  }

  dequeueAll(): ChatPatch[] {
    const out: ChatPatch[] = [];
    for (const priority of PRIORITY_ORDER) {
      const queue = this.queues[priority];
      if (!queue.length) continue;
      out.push(...queue);
      queue.length = 0;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  totalSize(): number {
    return this.queues.p0.length + this.queues.p1.length + this.queues.p2.length;
  }

  sizeByPriority(): Record<PatchPriority, number> {
    return {
      p0: this.queues.p0.length,
      p1: this.queues.p1.length,
      p2: this.queues.p2.length,
    };
  }

  isEmpty(): boolean {
    return this.totalSize() === 0;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  resetDroppedCount(): void {
    this.droppedCount = 0;
  }

  // -------------------------------------------------------------------------
  // Priority classification
  // -------------------------------------------------------------------------

  private getPriority(patch: ChatPatch): PatchPriority {
    if (patch.kind === 'reset' || patch.kind === 'delete' || patch.kind === 'sync') return 'p0';
    if (patch.kind === 'append' || patch.kind === 'prepend' || patch.kind === 'update') return 'p1';
    return 'p2';
  }

  private canDrop(patch: ChatPatch): boolean {
    if (patch.kind === 'reset' || patch.kind === 'delete') return false;
    return true;
  }

  // -------------------------------------------------------------------------
  // Ops estimation
  // -------------------------------------------------------------------------

  private estimateOps(patch: ChatPatch): number {
    if (patch.kind === 'reset' || patch.kind === 'append' || patch.kind === 'prepend') return patch.messages.length;
    if (patch.kind === 'delete') return patch.ids.length;
    if (patch.kind === 'update') return patch.updates.length;
    if (patch.kind === 'meta') {
      return (
        (patch.lastMessages?.length || 0) +
        (patch.unreadDeltas?.length || 0) +
        (patch.onlineUpdates?.length || 0) +
        (patch.aiMessages?.length || 0) +
        (patch.chatUpserts?.length || 0) +
        (patch.chatRemovals?.length || 0)
      );
    }
    return 1;
  }

  // -------------------------------------------------------------------------
  // Backpressure
  // -------------------------------------------------------------------------

  private trimBackpressure(): void {
    let total = this.totalSize();
    if (total <= this.config.hardMax) return;

    let dropped = 0;
    while (total > this.config.hardMax) {
      // Drop lower-priority patches first
      if (this.dropOldestFromQueue(this.queues.p2)) {
        dropped += 1;
        total -= 1;
        continue;
      }
      if (this.dropOldestFromQueue(this.queues.p1)) {
        dropped += 1;
        total -= 1;
        continue;
      }
      if (this.dropOldestFromQueue(this.queues.p0)) {
        dropped += 1;
        total -= 1;
        continue;
      }
      break;
    }

    this.droppedCount += dropped;
  }

  private dropOldestFromQueue(queue: ChatPatch[]): boolean {
    for (let i = 0; i < queue.length; i += 1) {
      if (this.canDrop(queue[i])) {
        queue.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------------

  clear(): void {
    this.queues.p0.length = 0;
    this.queues.p1.length = 0;
    this.queues.p2.length = 0;
  }
}
