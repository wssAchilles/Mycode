import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { buildMessageWrittenEvent } from './eventFactory';
import type { MessagePersistedEventInput } from './busContracts';
import { chatDeliveryEventPublisher } from './eventPublisher';
import type { DeliveryEventPublisher } from './ports';

export async function publishMessagePersistedEvent(
  input: MessagePersistedEventInput,
  publisher: DeliveryEventPublisher = chatDeliveryEventPublisher,
): Promise<void> {
  try {
    await publisher.publish([buildMessageWrittenEvent(input)]);
    chatRuntimeMetrics.increment('chatDelivery.lifecycle.messageWritten.success');
  } catch {
    chatRuntimeMetrics.increment('chatDelivery.lifecycle.messageWritten.errors');
  }
}
