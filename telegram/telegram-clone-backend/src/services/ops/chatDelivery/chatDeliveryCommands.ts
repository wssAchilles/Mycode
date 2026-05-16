import { createChatDeliveryReplayService } from '../../chatDelivery/replayService';
import { createChatDeliveryPrimaryFallbackService } from '../../chatDelivery/primaryFallbackService';
import { chatDeliveryConsistencyService } from '../../chatDelivery/chatDeliveryConsistencyService';
import { readChatType, readOptionalInt } from '../shared/queryParsing';

export function readConsistencyOptions(input: Record<string, unknown>) {
  return {
    limit: readOptionalInt(input.limit),
    staleAfterMinutes: readOptionalInt(input.staleAfterMinutes),
  };
}

export function readFallbackOptions(input: Record<string, unknown>) {
  return {
    limit: readOptionalInt(input.limit),
    staleAfterMinutes: readOptionalInt(input.staleAfterMinutes),
    chatType: readChatType(input.chatType),
  };
}

export async function buildChatDeliveryConsistencyOps(input: Record<string, unknown>) {
  return chatDeliveryConsistencyService.buildSummary(readConsistencyOptions(input));
}

export async function repairChatDeliveryConsistency(input: Record<string, unknown>) {
  return chatDeliveryConsistencyService.repair(readConsistencyOptions(input));
}

export async function replayChatDeliveryFailures(input: Record<string, unknown>) {
  const replayService = await createChatDeliveryReplayService();
  return replayService.replayFailedDeliveries(readConsistencyOptions(input));
}

export async function buildChatDeliveryFallbackOps(input: Record<string, unknown>) {
  const fallbackService = await createChatDeliveryPrimaryFallbackService();
  return fallbackService.buildSummary(readFallbackOptions(input));
}

export async function replayChatDeliveryFallbacks(input: Record<string, unknown>) {
  const fallbackService = await createChatDeliveryPrimaryFallbackService();
  return fallbackService.replayPrimaryFallbacks(readFallbackOptions(input));
}
