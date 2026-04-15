import type { MessageFanoutCommand } from './contracts';

const DEFAULT_FANOUT_JOB_RECIPIENTS_MAX = Math.min(
  Math.max(Number.parseInt(process.env.FANOUT_JOB_RECIPIENTS_MAX || '1500', 10) || 1500, 100),
  10000,
);

export interface PlanFanoutChunksOptions {
  maxRecipientsPerChunk?: number;
}

export function planFanoutChunks(
  command: MessageFanoutCommand,
  options: PlanFanoutChunksOptions = {},
): MessageFanoutCommand[] {
  const recipients = Array.from(new Set((command.recipientIds || []).filter(Boolean)));
  if (!recipients.length) return [];

  const maxRecipientsPerChunk = options.maxRecipientsPerChunk ?? DEFAULT_FANOUT_JOB_RECIPIENTS_MAX;
  const chunkCount = Math.max(1, Math.ceil(recipients.length / maxRecipientsPerChunk));

  const chunks: MessageFanoutCommand[] = [];
  for (let offset = 0, chunkIndex = 0; offset < recipients.length; offset += maxRecipientsPerChunk, chunkIndex += 1) {
    const recipientIds = recipients.slice(offset, offset + maxRecipientsPerChunk);
    chunks.push({
      ...command,
      recipientIds,
      delivery: {
        ...command.delivery,
        chunkIndex,
        chunkCount,
        totalRecipientCount: recipients.length,
      },
    });
  }

  return chunks;
}
