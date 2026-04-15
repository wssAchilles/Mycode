import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import type { ChatDeliveryOutboxRecordSnapshot, ChatDeliveryReplayResult, MessageFanoutCommand } from './contracts';
import { chatDeliveryOutboxService, type QueueJobRef } from './outboxService';
import { buildReplayQueuedEvent } from './eventFactory';
import { chatDeliveryEventPublisher } from './eventPublisher';
import type { DeliveryEventPublisher, FanoutCommandExecutor } from './ports';
import { buildReplayCommandsFromRecord } from './replayPlanner';

interface LegacyQueuePublisher {
  addFanoutJobs(commands: MessageFanoutCommand[]): Promise<Array<QueueJobRef>>;
}

export interface ReplayFailedDeliveriesOptions {
  limit?: number;
  staleAfterMinutes?: number;
}

function toFanoutExecutor(executor: FanoutCommandExecutor | LegacyQueuePublisher): FanoutCommandExecutor {
  if ('enqueue' in executor) {
    return executor;
  }
  return {
    enqueue: (commands) => executor.addFanoutJobs(commands),
  };
}

export class ChatDeliveryReplayService {
  constructor(
    private readonly fanoutExecutor: FanoutCommandExecutor | LegacyQueuePublisher,
    private readonly eventPublisher: DeliveryEventPublisher = chatDeliveryEventPublisher,
  ) {}

  async replayFailedDeliveries(options: ReplayFailedDeliveriesOptions = {}): Promise<ChatDeliveryReplayResult> {
    const limit = Math.max(1, Math.min(options.limit || 20, 100));
    const staleMinutes = Math.max(1, Math.min(options.staleAfterMinutes || 15, 24 * 60));
    const staleBefore = new Date(Date.now() - staleMinutes * 60_000);
    const records = await chatDeliveryOutboxService.listReplayCandidates(limit, staleBefore);

    chatRuntimeMetrics.increment('chatDelivery.replay.requests');
    chatRuntimeMetrics.observeValue('chatDelivery.replay.candidates', records.length);

    let replayedRecords = 0;
    let replayedChunks = 0;
    let skippedRecords = 0;
    const queuedJobIds: string[] = [];

    for (const record of records) {
      const replayCommands = this.toReplayCommands(record);
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
      );

      replayedRecords += 1;
      replayedChunks += replayCommands.length;
      queuedJobIds.push(...jobs.map((job) => job.id).filter((value): value is string => Boolean(value)));
      await this.publishReplayQueuedEvent(record, jobs, replayCommands);
    }

    return {
      scannedRecords: records.length,
      replayedRecords,
      replayedChunks,
      skippedRecords,
      queuedJobIds,
    };
  }

  private toReplayCommands(record: ChatDeliveryOutboxRecordSnapshot): MessageFanoutCommand[] {
    return buildReplayCommandsFromRecord(record);
  }

  private async publishReplayQueuedEvent(
    record: ChatDeliveryOutboxRecordSnapshot,
    jobs: QueueJobRef[],
    replayCommands: MessageFanoutCommand[],
  ): Promise<void> {
    try {
      await this.eventPublisher.publish([
        buildReplayQueuedEvent(record, jobs, replayCommands, 'manual_replay'),
      ]);
    } catch {
      chatRuntimeMetrics.increment('chatDelivery.replay.eventBus.errors');
    }
  }
}

export async function createChatDeliveryReplayService(): Promise<ChatDeliveryReplayService> {
  const { queueService } = await import('../queueService');
  return new ChatDeliveryReplayService(queueService);
}
