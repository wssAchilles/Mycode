import ChatDeliveryOutbox, {
  type IChatDeliveryOutbox,
  type IChatDeliveryOutboxChunk,
} from '../../models/ChatDeliveryOutbox';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import type {
  ChatDeliveryDispatchMode,
  ChatDeliveryOutboxRecordSnapshot,
  ChatDeliveryOutboxStatus,
  ChatDeliveryOutboxSummary,
  MessageFanoutCommand,
  MessageFanoutProjectionResult,
} from './contracts';

export interface QueueJobRef {
  id?: string;
}

export interface ProjectionAttemptMeta {
  chunkIndex: number;
  jobId?: string;
  attemptCount?: number;
}

export interface BeginDispatchResult {
  outboxId: string;
  chunkCommands: MessageFanoutCommand[];
}

function toIso(value?: Date | null): string | undefined {
  return value instanceof Date ? value.toISOString() : undefined;
}

function mapChunk(doc: IChatDeliveryOutboxChunk) {
  return {
    chunkIndex: doc.chunkIndex,
    recipientCount: Array.isArray(doc.recipientIds) ? doc.recipientIds.length : 0,
    recipientIds: [...(doc.recipientIds || [])],
    status: doc.status,
    jobId: doc.jobId || undefined,
    attemptCount: doc.attemptCount || 0,
    lastAttemptAt: toIso(doc.lastAttemptAt),
    lastErrorMessage: doc.lastErrorMessage || undefined,
    projection: doc.projection || undefined,
  };
}

function mapOutbox(doc: IChatDeliveryOutbox): ChatDeliveryOutboxRecordSnapshot {
  const rawId = (doc as any)._id;
  return {
    id: String(rawId),
    messageId: doc.messageId,
    chatId: doc.chatId,
    chatType: doc.chatType,
    seq: doc.seq,
    senderId: doc.senderId,
    emittedAt: doc.emittedAt.toISOString(),
    topology: doc.topology,
    dispatchMode: doc.dispatchMode,
    status: doc.status,
    totalRecipientCount: doc.totalRecipientCount,
    chunkCountExpected: doc.chunkCountExpected,
    queuedChunkCount: doc.queuedChunkCount,
    completedChunkCount: doc.completedChunkCount,
    failedChunkCount: doc.failedChunkCount,
    projectedRecipientCount: doc.projectedRecipientCount,
    projectedChunkCount: doc.projectedChunkCount,
    replayCount: doc.replayCount,
    queuedJobIds: [...(doc.queuedJobIds || [])],
    lastDispatchedAt: toIso(doc.lastDispatchedAt),
    lastCompletedAt: toIso(doc.lastCompletedAt),
    lastErrorMessage: doc.lastErrorMessage || undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    chunks: (doc.chunks || []).map(mapChunk),
  };
}

function deriveOutboxStatus(doc: IChatDeliveryOutbox): ChatDeliveryOutboxStatus {
  if (doc.dispatchMode === 'sync_fallback') {
    return 'sync_fallback_completed';
  }
  const chunks = doc.chunks || [];
  if (!chunks.length) return 'pending_dispatch';
  const failed = chunks.filter((chunk) => chunk.status === 'failed').length;
  const completed = chunks.filter((chunk) => chunk.status === 'completed').length;
  const projecting = chunks.filter((chunk) => chunk.status === 'projecting').length;
  const queued = chunks.filter((chunk) => chunk.status === 'queued').length;
  if (failed > 0) return 'failed';
  if (completed === chunks.length) return 'completed';
  if (completed > 0) return 'partially_completed';
  if (projecting > 0) return 'projecting';
  if (queued > 0) return 'queued';
  return 'pending_dispatch';
}

function recomputeAggregates(doc: IChatDeliveryOutbox): void {
  const chunks = doc.chunks || [];
  doc.queuedChunkCount = chunks.filter((chunk) => chunk.status === 'queued').length;
  doc.completedChunkCount = chunks.filter((chunk) => chunk.status === 'completed').length;
  doc.failedChunkCount = chunks.filter((chunk) => chunk.status === 'failed').length;
  doc.projectedRecipientCount = chunks.reduce(
    (sum, chunk) => sum + (chunk.projection?.recipientCount || 0),
    0,
  );
  doc.projectedChunkCount = chunks.reduce(
    (sum, chunk) => sum + (chunk.projection?.chunkCount || 0),
    0,
  );
  doc.status = deriveOutboxStatus(doc);
  doc.queuedJobIds = chunks.map((chunk) => chunk.jobId).filter((value): value is string => Boolean(value));
  if (doc.status === 'completed' || doc.status === 'sync_fallback_completed') {
    doc.lastCompletedAt = new Date();
  }
}

function cloneChunks(chunkCommands: MessageFanoutCommand[]): IChatDeliveryOutboxChunk[] {
  return chunkCommands.map((command, index) => ({
    chunkIndex: command.delivery?.chunkIndex ?? index,
    recipientIds: [...command.recipientIds],
    status: 'pending',
    jobId: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastErrorMessage: null,
    projection: null,
  }));
}

export class ChatDeliveryOutboxService {
  async beginDispatch(command: MessageFanoutCommand, chunkCommands: MessageFanoutCommand[]): Promise<BeginDispatchResult> {
    const startedAt = Date.now();
    const doc = await ChatDeliveryOutbox.create({
      messageId: command.messageId,
      chatId: command.chatId,
      chatType: command.chatType,
      seq: command.seq,
      senderId: command.senderId,
      emittedAt: new Date(command.emittedAt),
      topology: command.metadata.topology,
      dispatchMode: null,
      status: 'pending_dispatch',
      totalRecipientCount: command.recipientIds.length,
      chunkCountExpected: chunkCommands.length,
      queuedChunkCount: 0,
      completedChunkCount: 0,
      failedChunkCount: 0,
      projectedRecipientCount: 0,
      projectedChunkCount: 0,
      replayCount: command.delivery?.replayCount || 0,
      queuedJobIds: [],
      chunks: cloneChunks(chunkCommands),
    });

    chatRuntimeMetrics.increment('chatDelivery.outbox.begin.success');
    chatRuntimeMetrics.observeDuration('chatDelivery.outbox.begin.latencyMs', Date.now() - startedAt);

    return {
      outboxId: doc._id.toString(),
      chunkCommands: chunkCommands.map((chunk) => ({
        ...chunk,
        delivery: {
          ...chunk.delivery,
          outboxId: doc._id.toString(),
        },
      })),
    };
  }

  async markQueued(outboxId: string, jobs: QueueJobRef[]): Promise<void> {
    const doc = await this.requireDoc(outboxId);
    doc.dispatchMode = 'queued';
    doc.lastDispatchedAt = new Date();
    doc.lastErrorMessage = null;
    for (let index = 0; index < doc.chunks.length; index += 1) {
      const chunk = doc.chunks[index];
      chunk.status = 'queued';
      chunk.jobId = jobs[index]?.id || chunk.jobId || null;
      chunk.lastErrorMessage = null;
    }
    recomputeAggregates(doc);
    await doc.save();
  }

  async markSyncFallbackCompleted(
    outboxId: string,
    projection: MessageFanoutProjectionResult,
    errorMessage?: string,
  ): Promise<void> {
    const doc = await this.requireDoc(outboxId);
    doc.dispatchMode = 'sync_fallback';
    doc.status = 'sync_fallback_completed';
    doc.lastDispatchedAt = new Date();
    doc.lastCompletedAt = new Date();
    doc.lastErrorMessage = errorMessage || null;
    doc.queuedJobIds = [];
    doc.queuedChunkCount = 0;
    doc.completedChunkCount = doc.chunks.length;
    doc.failedChunkCount = 0;
    doc.projectedRecipientCount = projection.recipientCount;
    doc.projectedChunkCount = projection.chunkCount;
    for (const chunk of doc.chunks) {
      chunk.status = 'completed';
      chunk.projection = projection;
      chunk.lastErrorMessage = null;
      chunk.lastAttemptAt = new Date();
    }
    await doc.save();
  }

  async markProjectionStarted(outboxId: string, meta: ProjectionAttemptMeta): Promise<void> {
    const doc = await this.requireDoc(outboxId);
    const chunk = doc.chunks.find((entry) => entry.chunkIndex === meta.chunkIndex);
    if (!chunk) return;
    chunk.status = 'projecting';
    chunk.jobId = meta.jobId || chunk.jobId || null;
    chunk.attemptCount = Math.max(chunk.attemptCount || 0, meta.attemptCount || 0);
    chunk.lastAttemptAt = new Date();
    chunk.lastErrorMessage = null;
    recomputeAggregates(doc);
    await doc.save();
  }

  async markProjectionCompleted(
    outboxId: string,
    meta: ProjectionAttemptMeta,
    projection: MessageFanoutProjectionResult,
  ): Promise<void> {
    const doc = await this.requireDoc(outboxId);
    const chunk = doc.chunks.find((entry) => entry.chunkIndex === meta.chunkIndex);
    if (!chunk) return;
    chunk.status = 'completed';
    chunk.jobId = meta.jobId || chunk.jobId || null;
    chunk.attemptCount = Math.max(chunk.attemptCount || 0, meta.attemptCount || 0);
    chunk.lastAttemptAt = new Date();
    chunk.lastErrorMessage = null;
    chunk.projection = projection;
    recomputeAggregates(doc);
    await doc.save();
  }

  async markProjectionFailed(
    outboxId: string,
    meta: ProjectionAttemptMeta,
    errorMessage: string,
    terminal: boolean,
  ): Promise<void> {
    const doc = await this.requireDoc(outboxId);
    const chunk = doc.chunks.find((entry) => entry.chunkIndex === meta.chunkIndex);
    if (!chunk) return;
    chunk.jobId = meta.jobId || chunk.jobId || null;
    chunk.attemptCount = Math.max(chunk.attemptCount || 0, meta.attemptCount || 0);
    chunk.lastAttemptAt = new Date();
    chunk.lastErrorMessage = errorMessage;
    if (terminal) {
      chunk.status = 'failed';
      doc.lastErrorMessage = errorMessage;
    } else {
      chunk.status = 'queued';
    }
    recomputeAggregates(doc);
    await doc.save();
  }

  async buildSummary(recentLimit = 20): Promise<ChatDeliveryOutboxSummary> {
    const [statusCounts, dispatchCounts, recentRecords] = await Promise.all([
      ChatDeliveryOutbox.aggregate<{ _id: ChatDeliveryOutboxStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      ChatDeliveryOutbox.aggregate<{ _id: ChatDeliveryDispatchMode; count: number }>([
        { $match: { dispatchMode: { $in: ['queued', 'sync_fallback'] } } },
        { $group: { _id: '$dispatchMode', count: { $sum: 1 } } },
      ]),
      ChatDeliveryOutbox.find({})
        .sort({ updatedAt: -1 })
        .limit(recentLimit)
        .lean<IChatDeliveryOutbox[]>(),
    ]);

    return {
      countsByStatus: Object.fromEntries(statusCounts.map((item) => [item._id, item.count])),
      countsByDispatchMode: Object.fromEntries(dispatchCounts.map((item) => [item._id, item.count])),
      recentRecords: recentRecords.map((doc) => mapOutbox(doc as unknown as IChatDeliveryOutbox)),
    };
  }

  async listReplayCandidates(limit: number, staleBefore: Date): Promise<ChatDeliveryOutboxRecordSnapshot[]> {
    const docs = await ChatDeliveryOutbox.find({
      $or: [
        { status: 'failed' },
        { status: 'queued', updatedAt: { $lt: staleBefore } },
        { status: 'projecting', updatedAt: { $lt: staleBefore } },
        { status: 'partially_completed', updatedAt: { $lt: staleBefore } },
      ],
    })
      .sort({ updatedAt: 1 })
      .limit(limit)
      .lean<IChatDeliveryOutbox[]>();
    return docs.map((doc) => mapOutbox(doc as unknown as IChatDeliveryOutbox));
  }

  async markReplayQueued(
    outboxId: string,
    replayedChunkIndices: number[],
    jobs: QueueJobRef[],
  ): Promise<void> {
    const doc = await this.requireDoc(outboxId);
    doc.replayCount += 1;
    doc.dispatchMode = 'queued';
    doc.lastDispatchedAt = new Date();
    replayedChunkIndices.forEach((chunkIndex, index) => {
      const chunk = doc.chunks.find((entry) => entry.chunkIndex === chunkIndex);
      if (!chunk) return;
      chunk.status = 'queued';
      chunk.jobId = jobs[index]?.id || chunk.jobId || null;
      chunk.lastErrorMessage = null;
    });
    recomputeAggregates(doc);
    await doc.save();
  }

  async requireSnapshot(outboxId: string): Promise<ChatDeliveryOutboxRecordSnapshot> {
    const doc = await this.requireDoc(outboxId);
    return mapOutbox(doc);
  }

  private async requireDoc(outboxId: string): Promise<IChatDeliveryOutbox> {
    const doc = await ChatDeliveryOutbox.findById(outboxId);
    if (!doc) {
      throw new Error(`chat delivery outbox ${outboxId} 不存在`);
    }
    return doc;
  }
}

export const chatDeliveryOutboxService = new ChatDeliveryOutboxService();
