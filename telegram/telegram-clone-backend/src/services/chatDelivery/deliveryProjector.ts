import ChatMemberState from '../../models/ChatMemberState';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { updateService } from '../updateService';
import type { MessageFanoutCommand, MessageFanoutProjectionResult } from './contracts';

export interface MemberStateStore {
  bulkWrite(ops: Array<Record<string, unknown>>, options: Record<string, unknown>): Promise<unknown>;
}

export interface SyncAppender {
  appendUpdates(
    userIds: string[],
    params: {
      type: 'message';
      chatId: string;
      seq: number;
      messageId: string;
    },
  ): Promise<void>;
}

export interface MessageFanoutProjectionDeps {
  chunkSize?: number;
  memberStateStore?: MemberStateStore;
  syncAppender?: SyncAppender;
}

const DEFAULT_CHUNK_SIZE = Math.min(
  Math.max(Number.parseInt(process.env.FANOUT_MEMBERSTATE_CHUNK_SIZE || '1000', 10) || 1000, 100),
  5000,
);

export async function projectMessageFanoutCommand(
  command: MessageFanoutCommand,
  deps: MessageFanoutProjectionDeps = {},
): Promise<MessageFanoutProjectionResult> {
  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const memberStateStore = deps.memberStateStore ?? (ChatMemberState as unknown as MemberStateStore);
  const syncAppender = deps.syncAppender ?? updateService;
  const recipients = Array.from(new Set((command.recipientIds || []).filter(Boolean)));

  chatRuntimeMetrics.increment('chatDelivery.projection.requests');
  chatRuntimeMetrics.observeValue('chatDelivery.projection.chunkSize', chunkSize);
  chatRuntimeMetrics.observeValue('chatDelivery.projection.recipientCount', recipients.length);
  chatRuntimeMetrics.observeValue('fanout.chunkSize.config', chunkSize);

  if (!recipients.length) {
    chatRuntimeMetrics.increment('chatDelivery.projection.empty');
    return {
      recipientCount: 0,
      chunkCount: 0,
    };
  }

  let chunkCount = 0;
  try {
    for (let index = 0; index < recipients.length; index += chunkSize) {
      const chunk = recipients.slice(index, index + chunkSize);
      if (!chunk.length) continue;
      chunkCount += 1;
      chatRuntimeMetrics.increment('fanout.chunks.total');
      chatRuntimeMetrics.observeValue('fanout.chunk.recipients', chunk.length);

      const ops = chunk.map((userId) => ({
        updateOne: {
          filter: { chatId: command.chatId, userId },
          update: {
            $max: { lastDeliveredSeq: command.seq },
            $setOnInsert: { lastReadSeq: 0 },
          },
          upsert: true,
        },
      }));

      await memberStateStore.bulkWrite(ops, { ordered: false });
      await syncAppender.appendUpdates(chunk, {
        type: 'message',
        chatId: command.chatId,
        seq: command.seq,
        messageId: command.messageId,
      });
    }

    chatRuntimeMetrics.increment('chatDelivery.projection.success');
    chatRuntimeMetrics.observeValue('chatDelivery.projection.chunkCount', chunkCount);
    return {
      recipientCount: recipients.length,
      chunkCount,
    };
  } catch (error) {
    chatRuntimeMetrics.increment('chatDelivery.projection.errors');
    chatRuntimeMetrics.observeValue('chatDelivery.projection.chunkCount', chunkCount);
    throw error;
  }
}
