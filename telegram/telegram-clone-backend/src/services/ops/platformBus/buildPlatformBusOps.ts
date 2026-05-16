import { buildNodeCapabilityOwnershipSummary } from '../../controlPlane/capabilityOwners';
import { readDeliveryConsumerOpsSummary } from '../../chatDelivery/deliveryConsumerOps';
import { readDeliveryConsumerReplaySummary } from '../../chatDelivery/ops/deliveryConsumerReplaySummary';
import { platformEventPublisher } from '../../platformBus/eventPublisher';
import { getCapabilityRecord } from '../shared/capabilityRecord';

export async function buildPlatformBusOps() {
  const [consumer, replay] = await Promise.all([
    readDeliveryConsumerOpsSummary(),
    readDeliveryConsumerReplaySummary(),
  ]);
  const capabilities = buildNodeCapabilityOwnershipSummary({ consumer });
  const replaySummary = (replay.summary || {}) as Record<string, unknown>;
  const replayRuntime = ((replaySummary.runtime || {}) as Record<string, unknown>);

  return {
    eventBus: await platformEventPublisher.buildSummary(),
    consumer,
    replay,
    ownership: getCapabilityRecord(capabilities, 'platform'),
    runtime: {
      syncWakeExecutionMode: String(
        (consumer.runtime?.syncWakeExecutionMode as string)
          || process.env.DELIVERY_CONSUMER_SYNC_WAKE_EXECUTION_MODE
          || 'publish',
      ),
      platformReplayStreamKey: String(
        (replaySummary.streamKey as string)
          || process.env.DELIVERY_CONSUMER_PLATFORM_REPLAY_STREAM_KEY
          || 'platform:events:replay:v1',
      ),
      platformReplayCompletedKey: String(
        (replaySummary.completedKey as string)
          || `${process.env.DELIVERY_CONSUMER_PLATFORM_REPLAY_STREAM_KEY || 'platform:events:replay:v1'}:completed`,
      ),
      platformReplaySingleTopicDrainConcurrency: Number(
        replayRuntime.singleTopicDrainConcurrency || 1,
      ),
      platformReplayCrossTopicDrainConcurrency: Number(
        replayRuntime.crossTopicDrainConcurrency || 3,
      ),
      platformPresenceExecutionMode: String(
        (consumer.runtime?.presenceExecutionMode as string)
          || process.env.DELIVERY_CONSUMER_PRESENCE_EXECUTION_MODE
          || 'publish',
      ),
      platformNotificationExecutionMode: String(
        (consumer.runtime?.notificationExecutionMode as string)
          || process.env.DELIVERY_CONSUMER_NOTIFICATION_EXECUTION_MODE
          || 'publish',
      ),
      notificationDispatchExecutionMode: String(
        process.env.NOTIFICATION_DISPATCH_EXECUTION_MODE || 'direct_queue',
      ),
    },
  };
}
