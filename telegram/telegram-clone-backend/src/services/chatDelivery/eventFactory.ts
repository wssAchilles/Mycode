import { randomUUID } from 'node:crypto';

import type {
  ChatDeliveryEventEnvelope,
  FanoutRequestedEventInput,
  MessagePersistedEventInput,
  ProjectionLifecycleEventInput,
} from './busContracts';
import { CHAT_DELIVERY_EVENT_SPEC_VERSION } from './busContracts';
import type { ChatDeliveryOutboxRecordSnapshot } from './contracts';
import type { QueueJobRef } from './ports';

function buildEnvelope<TPayload>(
  topic: ChatDeliveryEventEnvelope<TPayload>['topic'],
  partitionKey: string,
  payload: TPayload,
): ChatDeliveryEventEnvelope<TPayload> {
  return {
    specVersion: CHAT_DELIVERY_EVENT_SPEC_VERSION,
    producer: 'node-backend',
    eventId: randomUUID(),
    topic,
    emittedAt: new Date().toISOString(),
    partitionKey,
    payload,
  };
}

export function buildMessageWrittenEvent(
  input: MessagePersistedEventInput,
): ChatDeliveryEventEnvelope {
  return buildEnvelope('message_written', input.chatId, {
    ...input,
    recipientIds: [...input.recipientIds],
    recipientCount: input.recipientIds.length,
  });
}

export function buildFanoutRequestedEvent(
  input: FanoutRequestedEventInput,
): ChatDeliveryEventEnvelope {
  const { command, dispatch, outboxId, jobIds } = input;
  const topic =
    dispatch.mode === 'skipped'
      ? 'fanout_skipped'
      : dispatch.mode === 'sync_fallback'
        ? 'fanout_sync_fallback'
        : 'fanout_requested';

  return buildEnvelope(topic, command.chatId, {
    messageId: command.messageId,
    chatId: command.chatId,
    chatType: command.chatType,
    seq: command.seq,
    senderId: command.senderId,
    recipientIds: [...command.recipientIds],
    recipientCount: command.recipientIds.length,
    topology: command.metadata.topology,
    outboxId,
    dispatchMode: dispatch.mode,
    jobIds: [...jobIds],
    projection: dispatch.projection,
    skippedReason: dispatch.skippedReason,
  });
}

export function buildProjectionStartedEvent(
  input: ProjectionLifecycleEventInput,
): ChatDeliveryEventEnvelope {
  return buildEnvelope('fanout_projection_started', input.command.chatId, {
    messageId: input.command.messageId,
    chatId: input.command.chatId,
    chatType: input.command.chatType,
    seq: input.command.seq,
    senderId: input.command.senderId,
    recipientIds: [...input.command.recipientIds],
    recipientCount: input.command.recipientIds.length,
    topology: input.command.metadata.topology,
    outboxId: input.outboxId,
    chunkIndex: input.chunkIndex,
    chunkCount: input.chunkCount,
    totalRecipientCount: input.totalRecipientCount,
    jobId: input.jobId,
    attemptCount: input.attemptCount,
    replayCount: input.replayCount,
  });
}

export function buildProjectionCompletedEvent(
  input: ProjectionLifecycleEventInput,
): ChatDeliveryEventEnvelope {
  return buildEnvelope('fanout_projection_completed', input.command.chatId, {
    messageId: input.command.messageId,
    chatId: input.command.chatId,
    chatType: input.command.chatType,
    seq: input.command.seq,
    senderId: input.command.senderId,
    recipientIds: [...input.command.recipientIds],
    recipientCount: input.command.recipientIds.length,
    topology: input.command.metadata.topology,
    outboxId: input.outboxId,
    chunkIndex: input.chunkIndex,
    chunkCount: input.chunkCount,
    totalRecipientCount: input.totalRecipientCount,
    jobId: input.jobId,
    attemptCount: input.attemptCount,
    replayCount: input.replayCount,
    projection: input.projection,
  });
}

export function buildProjectionFailedEvent(
  input: ProjectionLifecycleEventInput,
): ChatDeliveryEventEnvelope {
  return buildEnvelope('fanout_projection_failed', input.command.chatId, {
    messageId: input.command.messageId,
    chatId: input.command.chatId,
    chatType: input.command.chatType,
    seq: input.command.seq,
    senderId: input.command.senderId,
    recipientIds: [...input.command.recipientIds],
    recipientCount: input.command.recipientIds.length,
    topology: input.command.metadata.topology,
    outboxId: input.outboxId,
    chunkIndex: input.chunkIndex,
    chunkCount: input.chunkCount,
    totalRecipientCount: input.totalRecipientCount,
    jobId: input.jobId,
    attemptCount: input.attemptCount,
    replayCount: input.replayCount,
    errorMessage: input.errorMessage,
    terminal: input.terminal,
  });
}

export function buildReplayQueuedEvent(
  record: ChatDeliveryOutboxRecordSnapshot,
  jobs: QueueJobRef[],
  replayCommands: Array<{
    delivery?: {
      chunkIndex?: number;
      chunkCount?: number;
      totalRecipientCount?: number;
    };
    recipientIds: string[];
  }>,
  replaySource: 'manual_replay' | 'primary_fallback' = 'manual_replay',
): ChatDeliveryEventEnvelope {
  return buildEnvelope('fanout_replay_queued', record.chatId, {
    outboxId: record.id,
    messageId: record.messageId,
    chatId: record.chatId,
    chatType: record.chatType,
    seq: record.seq,
    replaySource,
    replayedChunkCount: replayCommands.length,
    replayCount: record.replayCount + 1,
    queuedJobIds: jobs.map((job) => job.id).filter((value): value is string => Boolean(value)),
    chunks: replayCommands.map((command) => ({
      chunkIndex: command.delivery?.chunkIndex ?? 0,
      recipientCount: command.recipientIds.length,
      chunkCount: command.delivery?.chunkCount ?? replayCommands.length,
      totalRecipientCount: command.delivery?.totalRecipientCount ?? command.recipientIds.length,
    })),
  });
}
