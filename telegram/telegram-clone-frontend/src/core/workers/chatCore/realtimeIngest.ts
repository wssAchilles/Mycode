/**
 * Realtime ingest — event normalization, batch queue, patch generation.
 *
 * Single responsibility: realtime event processing pipeline.
 * No socket, no sync, no persistence, no search.
 */

import type { ChatPatch } from '../../chat/types';
import type { SocketRealtimeEvent } from '../../chat/realtime';
import type { Message } from '../../../types/chat';
import type { RawSyncMessage, RawGroupEvent } from './messageAssembler';
import { normalizeSyncMessages } from './messageAssembler';
import { compactMessagePatchesWithRuntime, type MessagePatch } from '../../../features/chat/store/patchCompactor';
import { throttleWithTickEnd } from '../schedulers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PatchPriority = 'p0' | 'p1' | 'p2';

export interface RealtimeIngestContext {
  telemetry: Record<string, number>;
  markTelemetryUpdate: () => void;
  emitPatch: (patch: ChatPatch) => void;
  processSyncPayload: (updates: any[], messages: RawSyncMessage[], pts: number) => Promise<void>;
  applyReadReceipt: (chatId: string, seq: number, readCount: number, senderUserId: string) => void;
  processGroupUpdateEvent: (raw: RawGroupEvent) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REALTIME_QUEUE_HARD_MAX = 600;
const REALTIME_QUEUE_WARN_AT = 200;
const REALTIME_EVENTS_PER_INGEST_SLICE = 40;
const PATCH_QUEUE_HARD_MAX = 600;
const PATCHES_PER_DISPATCH = 12;
const PATCH_OPS_PER_DISPATCH = 120;
const PATCH_PRIORITY_QUOTA: Record<PatchPriority, number> = { p0: 4, p1: 4, p2: 4 };
const PATCH_PRIORITY_ORDER: PatchPriority[] = ['p0', 'p1', 'p2'];
const PATCH_COMPACT_SOFT_MAX = 40;
const PATCH_COMPACT_HARD_MAX = 80;
const PATCH_COMPACT_OPS_BUDGET = 800;
const REALTIME_QUEUE_BACKPRESSURE_FLUSH_INTERVAL_MS = 40;

// ---------------------------------------------------------------------------
// Realtime ingest
// ---------------------------------------------------------------------------

export class RealtimeIngest {
  private readonly realtimeIngestQueue: SocketRealtimeEvent[][] = [];
  private realtimeIngestQueueEvents = 0;
  private realtimeIngestInFlight = false;
  private realtimeIngestGeneration = 0;
  private realtimeQueuePressureWarned = false;

  private readonly patchQueues: Record<PatchPriority, ChatPatch[]> = {
    p0: [],
    p1: [],
    p2: [],
  };
  private patchCompactionInFlight = false;
  private patchCompactionGeneration = 0;

  private metaLastMessages: Array<{ chatId: string; message: Message }> = [];
  private metaUnreadDeltas: Array<{ chatId: string; delta: number }> = [];
  private metaOnlineUpdates: Array<{ userId: string; isOnline: boolean; lastSeen?: string }> = [];
  private metaAiMessages: Message[] = [];
  private metaChatUpserts: Array<{ chatId: string; isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }> = [];
  private metaChatRemovals: string[] = [];

  constructor(private readonly ctx: RealtimeIngestContext) {}

  // -------------------------------------------------------------------------
  // Realtime event normalization
  // -------------------------------------------------------------------------

  normalizeRealtimeBatch(events: SocketRealtimeEvent[]): SocketRealtimeEvent[] {
    if (!Array.isArray(events) || events.length === 0) return [];
    const out: SocketRealtimeEvent[] = [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (
        event.type !== 'message'
        && event.type !== 'presence'
        && event.type !== 'readReceipt'
        && event.type !== 'groupUpdate'
      ) {
        continue;
      }
      out.push(event);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Realtime event queue
  // -------------------------------------------------------------------------

  private trimRealtimeIngestQueueBackpressure(): void {
    if (this.realtimeIngestQueueEvents <= REALTIME_QUEUE_HARD_MAX) return;

    let dropped = 0;
    while (this.realtimeIngestQueueEvents > REALTIME_QUEUE_HARD_MAX && this.realtimeIngestQueue.length > 0) {
      const oldest = this.realtimeIngestQueue.shift();
      if (!oldest?.length) continue;
      dropped += oldest.length;
      this.realtimeIngestQueueEvents = Math.max(0, this.realtimeIngestQueueEvents - oldest.length);
    }

    if (dropped > 0) {
      this.ctx.telemetry.realtimeQueueDropped += dropped;
      this.ctx.markTelemetryUpdate();
      console.warn('[chat-core] realtime ingest queue hard-limit drop', dropped);
    }
  }

  enqueueRealtimeEventsForIngest(events: SocketRealtimeEvent[], source: 'socket' | 'api' = 'api'): void {
    const normalized = this.normalizeRealtimeBatch(events);
    if (!normalized.length) return;

    const chunks =
      normalized.length > REALTIME_EVENTS_PER_INGEST_SLICE
        ? this.chunkArray(normalized, REALTIME_EVENTS_PER_INGEST_SLICE)
        : [normalized];

    for (const chunk of chunks) {
      if (!chunk.length) continue;
      this.realtimeIngestQueue.push(chunk);
      this.realtimeIngestQueueEvents += chunk.length;
    }

    this.ctx.telemetry.realtimeBatchesEnqueued += chunks.length;
    this.noteRealtimeQueuePeak(this.realtimeIngestQueueEvents);
    this.ctx.markTelemetryUpdate();

    this.trimRealtimeIngestQueueBackpressure();

    if (this.realtimeIngestQueueEvents >= REALTIME_QUEUE_WARN_AT) {
      if (!this.realtimeQueuePressureWarned) {
        this.realtimeQueuePressureWarned = true;
        console.warn('[chat-core] realtime ingest queue pressure', {
          source,
          queuedEvents: this.realtimeIngestQueueEvents,
        });
      }
    } else if (this.realtimeQueuePressureWarned && this.realtimeIngestQueueEvents < Math.floor(REALTIME_QUEUE_WARN_AT / 2)) {
      this.realtimeQueuePressureWarned = false;
    }

    this.flushRealtimeIngestQueue();
  }

  private flushRealtimeIngestQueue = throttleWithTickEnd(() => {
    if (this.realtimeIngestInFlight || this.realtimeIngestQueueEvents <= 0 || this.realtimeIngestQueue.length <= 0) return;

    this.realtimeIngestInFlight = true;
    const generation = this.realtimeIngestGeneration;
    void (async () => {
      try {
        while (generation === this.realtimeIngestGeneration && this.realtimeIngestQueue.length > 0) {
          const batch = this.realtimeIngestQueue.shift();
          if (!batch?.length) continue;

          this.realtimeIngestQueueEvents = Math.max(0, this.realtimeIngestQueueEvents - batch.length);
          if (this.realtimeQueuePressureWarned && this.realtimeIngestQueueEvents < Math.floor(REALTIME_QUEUE_WARN_AT / 2)) {
            this.realtimeQueuePressureWarned = false;
          }

          this.ctx.telemetry.realtimeBatchesProcessed += 1;
          this.ctx.telemetry.realtimeEventsProcessed += batch.length;
          this.ctx.markTelemetryUpdate();

          try {
            await this.processRealtimeEventsInternal(batch);
          } catch {
            // Keep draining to avoid wedging the queue after one malformed payload.
          }
        }
      } finally {
        this.realtimeIngestInFlight = false;
        if (generation === this.realtimeIngestGeneration && this.realtimeIngestQueue.length > 0) {
          this.flushRealtimeIngestQueue();
        }
      }
    })();
  });

  private async processRealtimeEventsInternal(events: SocketRealtimeEvent[]): Promise<void> {
    if (!Array.isArray(events) || events.length === 0) return;

    const rawMessages: RawSyncMessage[] = [];
    const presenceByUser = new Map<string, { userId: string; isOnline: boolean; lastSeen?: string }>();
    const readByChatSeq = new Map<string, { chatId: string; seq: number; readCount: number }>();
    const groupEvents: RawGroupEvent[] = [];

    for (const event of events) {
      if (!event) continue;

      if (event.type === 'message') {
        if (event.payload) rawMessages.push(event.payload as RawSyncMessage);
        continue;
      }

      if (event.type === 'presence') {
        const userId = event.payload?.userId ? String(event.payload.userId) : '';
        if (!userId) continue;
        presenceByUser.set(userId, {
          userId,
          isOnline: !!event.payload.isOnline,
          lastSeen: event.payload.lastSeen,
        });
        continue;
      }

      if (event.type === 'readReceipt') {
        const chatId = event.payload?.chatId ? String(event.payload.chatId) : '';
        const seq = event.payload?.seq;
        if (!chatId || typeof seq !== 'number') continue;
        const key = `${chatId}:${seq}`;
        const readCount = typeof event.payload.readCount === 'number' ? event.payload.readCount : 1;
        const cur = readByChatSeq.get(key);
        if (!cur || readCount >= cur.readCount) {
          readByChatSeq.set(key, { chatId, seq, readCount });
        }
        continue;
      }

      if (event.type === 'groupUpdate') {
        if (event.payload) groupEvents.push(event.payload as RawGroupEvent);
      }
    }

    if (rawMessages.length) {
      const messages = normalizeSyncMessages(rawMessages);
      if (messages.length) {
        await this.ctx.processSyncPayload([], rawMessages, 0);
      }
    }

    if (presenceByUser.size) {
      for (const presence of presenceByUser.values()) {
        this.ctx.emitPatch({
          kind: 'meta',
          onlineUpdates: [{ userId: presence.userId, isOnline: presence.isOnline, lastSeen: presence.lastSeen }],
        } as ChatPatch);
      }
    }

    if (readByChatSeq.size) {
      for (const receipt of readByChatSeq.values()) {
        this.ctx.applyReadReceipt(receipt.chatId, receipt.seq, receipt.readCount, '');
      }
    }

    if (groupEvents.length) {
      for (const event of groupEvents) {
        await this.ctx.processGroupUpdateEvent(event);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Patch queue
  // -------------------------------------------------------------------------

  enqueuePatch(patch: ChatPatch): void {
    const priority = this.getPatchPriority(patch);
    if (priority === 'p2' && this.queuedPatchCount() > PATCH_QUEUE_HARD_MAX) {
      this.ctx.telemetry.patchDroppedByBackpressure += 1;
      this.ctx.markTelemetryUpdate();
      return;
    }

    this.patchQueues[priority].push(patch);
    this.notePatchQueuePeak(this.queuedPatchCount());
    this.trimPatchQueueBackpressure();
  }

  private isProjectionPatch(
    patch: ChatPatch,
  ): patch is Extract<ChatPatch, { kind: 'reset' | 'append' | 'prepend' | 'delete' | 'update' }> {
    return (
      patch.kind === 'reset' ||
      patch.kind === 'append' ||
      patch.kind === 'prepend' ||
      patch.kind === 'delete' ||
      patch.kind === 'update'
    );
  }

  private isStaleProjectionPatch(patch: ChatPatch): boolean {
    if (!this.isProjectionPatch(patch)) return false;
    // This check requires access to store state — delegated to caller
    return false;
  }

  private getPatchPriority(patch: ChatPatch): PatchPriority {
    if (patch.kind === 'reset' || patch.kind === 'delete' || patch.kind === 'sync') return 'p0';
    if (patch.kind === 'append' || patch.kind === 'prepend' || patch.kind === 'update') return 'p1';
    return 'p2';
  }

  private estimatePatchOps(patch: ChatPatch): number {
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

  queuedPatchCount(): number {
    return this.patchQueues.p0.length + this.patchQueues.p1.length + this.patchQueues.p2.length;
  }

  private canDropPatchFromQueue(patch: ChatPatch): boolean {
    if (patch.kind === 'reset' || patch.kind === 'delete') return false;
    return true;
  }

  private dropOldestDroppablePatch(queue: ChatPatch[]): boolean {
    for (let i = 0; i < queue.length; i += 1) {
      const patch = queue[i];
      if (!this.canDropPatchFromQueue(patch)) continue;
      queue.splice(i, 1);
      return true;
    }
    return false;
  }

  private trimPatchQueueBackpressure(): void {
    let total = this.queuedPatchCount();
    if (total <= PATCH_QUEUE_HARD_MAX) return;

    let dropped = 0;
    while (total > PATCH_QUEUE_HARD_MAX) {
      if (this.dropOldestDroppablePatch(this.patchQueues.p2)) {
        dropped += 1;
        total -= 1;
        continue;
      }
      if (this.dropOldestDroppablePatch(this.patchQueues.p1)) {
        dropped += 1;
        total -= 1;
        continue;
      }
      if (this.dropOldestDroppablePatch(this.patchQueues.p0)) {
        dropped += 1;
        total -= 1;
        continue;
      }
      break;
    }

    if (dropped > 0) {
      this.ctx.telemetry.patchDroppedByBackpressure += dropped;
      this.ctx.markTelemetryUpdate();
      console.warn('[chat-core] patch queue hard-limit drop', dropped);
    }
  }

  dequeuePatchBatch(): ChatPatch[] {
    const quotas: Record<PatchPriority, number> = {
      p0: PATCH_PRIORITY_QUOTA.p0,
      p1: PATCH_PRIORITY_QUOTA.p1,
      p2: PATCH_PRIORITY_QUOTA.p2,
    };

    const batch: ChatPatch[] = [];
    let ops = 0;

    while (batch.length < PATCHES_PER_DISPATCH) {
      let progressed = false;

      for (const priority of PATCH_PRIORITY_ORDER) {
        const queue = this.patchQueues[priority];
        while (queue.length > 0 && this.isStaleProjectionPatch(queue[0])) {
          queue.shift();
        }
        if (!queue.length) continue;

        const quotaLeft = quotas[priority];
        if (quotaLeft <= 0 && batch.length > 0) continue;

        const next = queue[0];
        const nextOps = this.estimatePatchOps(next);
        if (batch.length > 0 && ops + nextOps > PATCH_OPS_PER_DISPATCH) continue;

        queue.shift();
        batch.push(next);
        ops += nextOps;
        quotas[priority] = Math.max(0, quotaLeft - 1);
        progressed = true;

        if (batch.length >= PATCHES_PER_DISPATCH) break;
      }

      if (!progressed) break;
    }

    if (!batch.length) {
      for (const priority of PATCH_PRIORITY_ORDER) {
        const queue = this.patchQueues[priority];
        while (queue.length > 0 && this.isStaleProjectionPatch(queue[0])) {
          queue.shift();
        }
        if (!queue.length) continue;
        const next = queue.shift();
        if (next) {
          batch.push(next);
        }
        break;
      }
    }

    return batch;
  }

  dequeueAllPatches(): ChatPatch[] {
    if (this.queuedPatchCount() === 0) return [];
    const out: ChatPatch[] = [];
    for (const priority of PATCH_PRIORITY_ORDER) {
      const queue = this.patchQueues[priority];
      if (!queue.length) continue;
      for (const patch of queue) {
        if (this.isStaleProjectionPatch(patch)) continue;
        out.push(patch);
      }
      queue.length = 0;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Meta queues
  // -------------------------------------------------------------------------

  queueLastMessageMeta(listId: string, message: Message): void {
    this.metaLastMessages.push({ chatId: listId, message });
  }

  queueUnreadDeltaMeta(listId: string, delta: number): void {
    this.metaUnreadDeltas.push({ chatId: listId, delta });
  }

  queueOnlineMeta(userId: string, isOnline: boolean, lastSeen?: string): void {
    this.metaOnlineUpdates.push({ userId, isOnline, lastSeen });
  }

  queueAiMessageMeta(message: Message): void {
    this.metaAiMessages.push(message);
  }

  queueChatUpsertMeta(chatId: string, patch: { isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }): void {
    this.metaChatUpserts.push({ chatId, ...patch });
  }

  queueChatRemovalMeta(chatId: string): void {
    this.metaChatRemovals.push(chatId);
  }

  flushMetaPatch(): void {
    const hasMeta =
      this.metaLastMessages.length > 0 ||
      this.metaUnreadDeltas.length > 0 ||
      this.metaOnlineUpdates.length > 0 ||
      this.metaAiMessages.length > 0 ||
      this.metaChatUpserts.length > 0 ||
      this.metaChatRemovals.length > 0;

    if (!hasMeta) return;

    const patch: ChatPatch = {
      kind: 'meta',
      lastMessages: this.metaLastMessages.length ? [...this.metaLastMessages] : undefined,
      unreadDeltas: this.metaUnreadDeltas.length ? [...this.metaUnreadDeltas] : undefined,
      onlineUpdates: this.metaOnlineUpdates.length ? [...this.metaOnlineUpdates] : undefined,
      aiMessages: this.metaAiMessages.length ? [...this.metaAiMessages] : undefined,
      chatUpserts: this.metaChatUpserts.length ? [...this.metaChatUpserts] : undefined,
      chatRemovals: this.metaChatRemovals.length ? [...this.metaChatRemovals] : undefined,
    } as ChatPatch;

    this.metaLastMessages = [];
    this.metaUnreadDeltas = [];
    this.metaOnlineUpdates = [];
    this.metaAiMessages = [];
    this.metaChatUpserts = [];
    this.metaChatRemovals = [];

    this.ctx.emitPatch(patch);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private chunkArray<T>(arr: T[], chunkSize: number): T[][] {
    if (arr.length <= chunkSize) return [arr];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
      out.push(arr.slice(i, i + chunkSize));
    }
    return out;
  }

  private notePatchQueuePeak(size: number): void {
    if (size > this.ctx.telemetry.patchQueuePeak) {
      this.ctx.telemetry.patchQueuePeak = size;
    }
  }

  private noteRealtimeQueuePeak(size: number): void {
    if (size > (this.ctx.telemetry.realtimeQueuePeak || 0)) {
      this.ctx.telemetry.realtimeQueuePeak = size;
    }
  }

  // -------------------------------------------------------------------------
  // State accessors
  // -------------------------------------------------------------------------

  getRealtimeIngestQueueEvents(): number {
    return this.realtimeIngestQueueEvents;
  }

  isRealtimeIngestInFlight(): boolean {
    return this.realtimeIngestInFlight;
  }

  getPatchQueues(): Record<PatchPriority, ChatPatch[]> {
    return this.patchQueues;
  }
}
