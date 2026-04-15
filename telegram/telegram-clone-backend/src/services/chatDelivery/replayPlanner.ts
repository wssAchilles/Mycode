import type { ChatDeliveryOutboxRecordSnapshot, MessageFanoutCommand } from './contracts';

export function buildReplayCommandsFromRecord(record: ChatDeliveryOutboxRecordSnapshot): MessageFanoutCommand[] {
  return record.chunks
    .filter((chunk) => chunk.status !== 'completed' && chunk.recipientIds.length > 0)
    .map((chunk) => ({
      messageId: record.messageId,
      chatId: record.chatId,
      chatType: record.chatType,
      seq: record.seq,
      senderId: record.senderId,
      emittedAt: record.emittedAt,
      metadata: {
        topology: record.topology,
      },
      recipientIds: [...chunk.recipientIds],
      delivery: {
        outboxId: record.id,
        chunkIndex: chunk.chunkIndex,
        chunkCount: record.chunkCountExpected,
        totalRecipientCount: record.totalRecipientCount,
        replayCount: record.replayCount + 1,
      },
    }));
}
