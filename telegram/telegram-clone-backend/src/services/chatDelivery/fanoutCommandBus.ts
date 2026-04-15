import { randomUUID } from 'node:crypto';

import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import type {
  ChatDeliveryAuditEvent,
  ChatDeliveryAuditEventKind,
  ChatDeliverySnapshot,
  MessageFanoutCommand,
  MessageFanoutDispatchResult,
  MessageFanoutProjectionResult,
} from './contracts';
import { projectMessageFanoutCommand } from './deliveryProjector';
import { planFanoutChunks } from './fanoutChunkPlanner';
import {
  chatDeliveryOutboxService,
  type ProjectionAttemptMeta,
  type QueueJobRef,
} from './outboxService';

const RECENT_EVENTS_LIMIT = 100;
const REDIS_STREAM_KEY = 'chat:delivery:events:v1';
const REDIS_STREAM_MAX_LEN = 2000;

interface QueuePublisher {
  addFanoutJobs(commands: MessageFanoutCommand[]): Promise<Array<QueueJobRef>>;
}

type ProjectionExecutor = (
  command: MessageFanoutCommand,
) => Promise<MessageFanoutProjectionResult>;

type AuditMirror = (event: ChatDeliveryAuditEvent) => Promise<void>;

interface ChatFanoutCommandBusDeps {
  queuePublisher?: QueuePublisher;
  projector?: ProjectionExecutor;
  mirror?: AuditMirror;
  outboxService?: typeof chatDeliveryOutboxService;
}

function createDefaultMirror(): AuditMirror {
  return async (event) => {
    try {
      const { redis } = await import('../../config/redis');
      await redis.xadd(
        REDIS_STREAM_KEY,
        'MAXLEN',
        '~',
        String(REDIS_STREAM_MAX_LEN),
        '*',
        'kind',
        event.kind,
        'messageId',
        event.messageId,
        'chatId',
        event.chatId,
        'chatType',
        event.chatType,
        'seq',
        String(event.seq),
        'recipientCount',
        String(event.recipientCount),
        'payload',
        JSON.stringify(event),
      );
    } catch {
      // Best-effort only; in-memory trail remains authoritative for local ops.
    }
  };
}

export class ChatFanoutCommandBus {
  private readonly queuePublisher?: QueuePublisher;
  private readonly projector?: ProjectionExecutor;
  private readonly mirror?: AuditMirror;
  private readonly outboxService?: typeof chatDeliveryOutboxService;
  private readonly recentEvents: ChatDeliveryAuditEvent[] = [];
  private readonly totals: ChatDeliverySnapshot['totals'] = {
    dispatchQueued: 0,
    dispatchFallback: 0,
    dispatchSkipped: 0,
    projectionSuccess: 0,
    projectionErrors: 0,
  };

  constructor(deps: ChatFanoutCommandBusDeps = {}) {
    this.queuePublisher = deps.queuePublisher;
    this.projector = deps.projector;
    this.mirror = deps.mirror;
    this.outboxService = deps.outboxService;
  }

  snapshot(): ChatDeliverySnapshot {
    return {
      totals: { ...this.totals },
      recentEvents: [...this.recentEvents],
    };
  }

  async buildOpsSnapshot(): Promise<ChatDeliverySnapshot> {
    return {
      totals: { ...this.totals },
      recentEvents: [...this.recentEvents],
      outbox: await this.resolveOutboxService().buildSummary(),
    };
  }

  resetForTests(): void {
    this.recentEvents.splice(0, this.recentEvents.length);
    this.totals.dispatchQueued = 0;
    this.totals.dispatchFallback = 0;
    this.totals.dispatchSkipped = 0;
    this.totals.projectionSuccess = 0;
    this.totals.projectionErrors = 0;
  }

  async dispatch(command: MessageFanoutCommand): Promise<MessageFanoutDispatchResult> {
    const recipientCount = command.recipientIds.length;
    chatRuntimeMetrics.increment('chatDelivery.dispatch.requests');
    chatRuntimeMetrics.observeValue('chatDelivery.dispatch.recipientCount', recipientCount);

    if (recipientCount === 0) {
      this.totals.dispatchSkipped += 1;
      this.recordEvent('dispatch_skipped', command, {
        skippedReason: 'no-recipient-targets',
      });
      return {
        mode: 'skipped',
        recipientCount,
        jobCount: 0,
        skippedReason: 'no-recipient-targets',
      };
    }

    const chunkCommands = planFanoutChunks(command);
    const outbox = await this.resolveOutboxService().beginDispatch(command, chunkCommands);

    try {
      const jobs = await this.resolveQueuePublisher().addFanoutJobs(outbox.chunkCommands);
      await this.resolveOutboxService().markQueued(outbox.outboxId, jobs);
      this.totals.dispatchQueued += 1;
      this.recordEvent('dispatch_queued', command, {
        jobId: jobs[0]?.id,
        jobCount: jobs.length,
      });
      return {
        mode: 'queued',
        recipientCount,
        jobId: jobs[0]?.id,
        jobCount: jobs.length,
        outboxId: outbox.outboxId,
      };
    } catch (error: any) {
      this.totals.dispatchFallback += 1;
      const projection = await this.resolveProjector()(command);
      await this.resolveOutboxService().markSyncFallbackCompleted(
        outbox.outboxId,
        projection,
        error?.message || 'queue dispatch failed',
      );
      this.recordEvent('dispatch_sync_fallback', command, {
        projection,
        errorMessage: error?.message || 'queue dispatch failed',
      });
      return {
        mode: 'sync_fallback',
        recipientCount,
        jobCount: 0,
        projection,
        outboxId: outbox.outboxId,
      };
    }
  }

  async recordProjectionStarted(command: MessageFanoutCommand, meta: ProjectionAttemptMeta): Promise<void> {
    const outboxId = command.delivery?.outboxId;
    if (!outboxId) return;
    await this.resolveOutboxService().markProjectionStarted(outboxId, meta);
  }

  async recordProjectionSuccess(
    command: MessageFanoutCommand,
    projection: MessageFanoutProjectionResult,
    meta: ProjectionAttemptMeta,
  ): Promise<void> {
    this.totals.projectionSuccess += 1;
    const outboxId = command.delivery?.outboxId;
    if (outboxId) {
      await this.resolveOutboxService().markProjectionCompleted(outboxId, meta, projection);
    }
    this.recordEvent('projection_succeeded', command, {
      projection,
    });
  }

  async recordProjectionFailure(
    command: MessageFanoutCommand,
    error: unknown,
    meta: ProjectionAttemptMeta & { terminal: boolean },
  ): Promise<void> {
    this.totals.projectionErrors += 1;
    const outboxId = command.delivery?.outboxId;
    if (outboxId) {
      await this.resolveOutboxService().markProjectionFailed(
        outboxId,
        meta,
        error instanceof Error ? error.message : String(error || 'projection failed'),
        meta.terminal,
      );
    }
    this.recordEvent('projection_failed', command, {
      errorMessage: error instanceof Error ? error.message : String(error || 'projection failed'),
    });
  }

  private recordEvent(
    kind: ChatDeliveryAuditEventKind,
    command: MessageFanoutCommand,
    extra: Partial<Omit<ChatDeliveryAuditEvent, 'id' | 'kind' | 'at' | 'messageId' | 'chatId' | 'chatType' | 'seq' | 'recipientCount' | 'topology'>> = {},
  ): void {
    const event: ChatDeliveryAuditEvent = {
      id: randomUUID(),
      kind,
      at: new Date().toISOString(),
      messageId: command.messageId,
      chatId: command.chatId,
      chatType: command.chatType,
      seq: command.seq,
      recipientCount: command.recipientIds.length,
      topology: command.metadata.topology,
      ...extra,
    };

    this.recentEvents.unshift(event);
    if (this.recentEvents.length > RECENT_EVENTS_LIMIT) {
      this.recentEvents.length = RECENT_EVENTS_LIMIT;
    }

    void this.resolveMirror()(event);
  }

  private resolveQueuePublisher(): QueuePublisher {
    if (this.queuePublisher) return this.queuePublisher;
    const { queueService } = require('../queueService') as typeof import('../queueService');
    return queueService;
  }

  private resolveProjector(): ProjectionExecutor {
    return this.projector ?? projectMessageFanoutCommand;
  }

  private resolveMirror(): AuditMirror {
    return this.mirror ?? createDefaultMirror();
  }

  private resolveOutboxService(): typeof chatDeliveryOutboxService {
    return this.outboxService ?? chatDeliveryOutboxService;
  }
}

export const chatFanoutCommandBus = new ChatFanoutCommandBus();
