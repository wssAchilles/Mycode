import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import type {
  ChatDeliveryOutboxRecordSnapshot,
  ChatDeliveryPrimaryFallbackCandidate,
  ChatDeliveryPrimaryFallbackReplayResult,
  ChatDeliveryPrimaryFallbackSummary,
  ChatDeliveryPrimaryFallbackReason,
  MessageFanoutCommand,
} from './contracts';
import { buildReplayQueuedEvent } from './eventFactory';
import { chatDeliveryEventPublisher } from './eventPublisher';
import { chatDeliveryOutboxService, type QueueJobRef } from './outboxService';
import type { DeliveryEventPublisher, FanoutCommandExecutor } from './ports';
import { buildReplayCommandsFromRecord } from './replayPlanner';

interface LegacyQueuePublisher {
  addFanoutJobs(commands: MessageFanoutCommand[]): Promise<Array<QueueJobRef>>;
}

export interface ChatDeliveryPrimaryFallbackOptions {
  limit?: number;
  staleAfterMinutes?: number;
}

function normalizeOptions(options: ChatDeliveryPrimaryFallbackOptions = {}) {
  return {
    limit: Math.max(1, Math.min(options.limit || 20, 100)),
    staleAfterMinutes: Math.max(1, Math.min(options.staleAfterMinutes || 15, 24 * 60)),
  };
}

function toFanoutExecutor(executor: FanoutCommandExecutor | LegacyQueuePublisher): FanoutCommandExecutor {
  if ('enqueue' in executor) {
    return executor;
  }
  return {
    enqueue: (commands) => executor.addFanoutJobs(commands),
  };
}

function buildCandidate(record: ChatDeliveryOutboxRecordSnapshot): ChatDeliveryPrimaryFallbackCandidate {
  const replayCommands = buildReplayCommandsFromRecord(record);
  const reason: ChatDeliveryPrimaryFallbackReason = record.status === 'failed' ? 'failed_outbox' : 'stale_outbox';
  return {
    outboxId: record.id,
    messageId: record.messageId,
    chatId: record.chatId,
    chatType: record.chatType,
    status: record.status,
    reason,
    replayCount: record.replayCount,
    updatedAt: record.updatedAt,
    pendingChunkCount: replayCommands.length,
    recoverable: replayCommands.length > 0,
    blockedReason: replayCommands.length > 0 ? undefined : 'no_replayable_chunks',
  };
}

function summarizeCandidates(
  candidates: ChatDeliveryPrimaryFallbackCandidate[],
  staleThresholdMinutes: number,
): ChatDeliveryPrimaryFallbackSummary {
  return {
    scannedRecords: candidates.length,
    staleThresholdMinutes,
    eligibleCount: candidates.filter((candidate) => candidate.recoverable).length,
    failedEligibleCount: candidates.filter((candidate) => candidate.recoverable && candidate.reason === 'failed_outbox').length,
    staleEligibleCount: candidates.filter((candidate) => candidate.recoverable && candidate.reason === 'stale_outbox').length,
    blockedCount: candidates.filter((candidate) => !candidate.recoverable).length,
    recentCandidates: candidates,
    lastScannedAt: new Date().toISOString(),
  };
}

export class ChatDeliveryPrimaryFallbackService {
  constructor(
    private readonly fanoutExecutor: FanoutCommandExecutor | LegacyQueuePublisher,
    private readonly eventPublisher: DeliveryEventPublisher = chatDeliveryEventPublisher,
  ) {}

  async buildSummary(
    options: ChatDeliveryPrimaryFallbackOptions = {},
  ): Promise<ChatDeliveryPrimaryFallbackSummary> {
    const normalized = normalizeOptions(options);
    const staleBefore = new Date(Date.now() - normalized.staleAfterMinutes * 60_000);
    const records = await chatDeliveryOutboxService.listReplayCandidates(normalized.limit, staleBefore);
    const candidates = records
      .filter((record) => record.dispatchMode === 'go_primary')
      .map((record) => buildCandidate(record));
    return summarizeCandidates(candidates, normalized.staleAfterMinutes);
  }

  async replayPrimaryFallbacks(
    options: ChatDeliveryPrimaryFallbackOptions = {},
  ): Promise<ChatDeliveryPrimaryFallbackReplayResult> {
    const normalized = normalizeOptions(options);
    const staleBefore = new Date(Date.now() - normalized.staleAfterMinutes * 60_000);
    const records = await chatDeliveryOutboxService.listReplayCandidates(normalized.limit, staleBefore);
    const primaryRecords = records.filter((record) => record.dispatchMode === 'go_primary');
    const candidates = primaryRecords.map((record) => buildCandidate(record));

    let replayedRecords = 0;
    let replayedChunks = 0;
    let skippedRecords = 0;
    const queuedJobIds: string[] = [];

    for (const record of primaryRecords) {
      const replayCommands = buildReplayCommandsFromRecord(record);
      if (!replayCommands.length) {
        skippedRecords += 1;
        continue;
      }

      const jobs = await toFanoutExecutor(this.fanoutExecutor).enqueue(replayCommands);
      if (!jobs.length) {
        skippedRecords += 1;
        continue;
      }

      await chatDeliveryOutboxService.markReplayQueued(
        record.id,
        replayCommands.map((command) => command.delivery?.chunkIndex ?? 0),
        jobs,
        {
          recoveryMode: 'legacy_replay',
          recoveredFromDispatchMode: 'go_primary',
        },
      );
      replayedRecords += 1;
      replayedChunks += replayCommands.length;
      queuedJobIds.push(...jobs.map((job) => job.id).filter((value): value is string => Boolean(value)));
      await this.publishReplayQueuedEvent(record, jobs, replayCommands);
    }

    chatRuntimeMetrics.observeValue('chatDelivery.primaryFallback.replayedRecords', replayedRecords);
    chatRuntimeMetrics.observeValue('chatDelivery.primaryFallback.replayedChunks', replayedChunks);

    return {
      ...summarizeCandidates(candidates, normalized.staleAfterMinutes),
      replayedRecords,
      replayedChunks,
      skippedRecords,
      queuedJobIds,
    };
  }

  private async publishReplayQueuedEvent(
    record: ChatDeliveryOutboxRecordSnapshot,
    jobs: QueueJobRef[],
    replayCommands: MessageFanoutCommand[],
  ): Promise<void> {
    try {
      await this.eventPublisher.publish([
        buildReplayQueuedEvent(record, jobs, replayCommands, 'primary_fallback'),
      ]);
    } catch {
      chatRuntimeMetrics.increment('chatDelivery.primaryFallback.eventBus.errors');
    }
  }
}

export async function createChatDeliveryPrimaryFallbackService(): Promise<ChatDeliveryPrimaryFallbackService> {
  const { queueService } = await import('../queueService');
  return new ChatDeliveryPrimaryFallbackService(queueService);
}
