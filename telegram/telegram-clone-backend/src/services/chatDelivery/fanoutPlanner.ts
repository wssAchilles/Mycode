import type { FanoutTopology, MessageFanoutCommand } from './contracts';

export interface BuildMessageFanoutCommandInput {
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  recipientIds: string[];
  topology?: FanoutTopology;
}

export function buildMessageFanoutCommand(
  input: BuildMessageFanoutCommandInput,
): MessageFanoutCommand {
  const recipientIds = Array.from(
    new Set((input.recipientIds || []).filter((userId) => userId && userId !== input.senderId)),
  );

  return {
    messageId: input.messageId,
    chatId: input.chatId,
    chatType: input.chatType,
    seq: input.seq,
    senderId: input.senderId,
    recipientIds,
    emittedAt: new Date().toISOString(),
    metadata: {
      topology: input.topology || 'eager',
    },
  };
}
