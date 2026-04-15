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
import { mapOutbox, recomputeOutboxAggregates } from './outboxRecord';

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
    await this.markDispatchQueued(outboxId, jobs, 'queued');
  }

  async markGoPrimaryQueued(outboxId: string, jobs: QueueJobRef[]): Promise<void> {
    await this.markDispatchQueued(outboxId, jobs, 'go_primary');
  }

  private async markDispatchQueued(
    outboxId: string,
    jobs: QueueJobRef[],
    dispatchMode: Extract<ChatDeliveryDispatchMode, 'queued' | 'go_primary'>,
  ): Promise<void> {
    const doc = await this.requireDoc(outboxId);
    doc.dispatchMode = dispatchMode;
    doc.lastDispatchedAt = new Date();
    doc.lastErrorMessage = null;
    for (let index = 0; index < doc.chunks.length; index += 1) {
      const chunk = doc.chunks[index];
      chunk.status = 'queued';
      chunk.jobId = jobs[index]?.id || chunk.jobId || null;
      chunk.lastErrorMessage = null;
    }
    recomputeOutboxAggregates(doc as any);
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
    recomputeOutboxAggregates(doc as any);
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
    recomputeOutboxAggregates(doc as any);
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
    recomputeOutboxAggregates(doc as any);
    await doc.save();
  }

  async buildSummary(recentLimit = 20): Promise<ChatDeliveryOutboxSummary> {
    const [statusCounts, dispatchCounts, recentRecords] = await Promise.all([
      ChatDeliveryOutbox.aggregate<{ _id: ChatDeliveryOutboxStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      ChatDeliveryOutbox.aggregate<{ _id: ChatDeliveryDispatchMode; count: number }>([
        { $match: { dispatchMode: { $in: ['queued', 'go_primary', 'sync_fallback'] } } },
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
    recomputeOutboxAggregates(doc as any);
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
