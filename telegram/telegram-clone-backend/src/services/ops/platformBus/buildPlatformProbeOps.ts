import { buildNodeCapabilityOwnershipSummary } from '../../controlPlane/capabilityOwners';
import { readDeliveryConsumerOpsSummary } from '../../chatDelivery/deliveryConsumerOps';
import { readDeliveryConsumerReplaySummary } from '../../chatDelivery/ops/deliveryConsumerReplaySummary';
import { platformEventPublisher } from '../../platformBus/eventPublisher';
import { readDeliveryConsumerPlatformProbe } from '../../platformBus/ops/deliveryConsumerPlatformProbe';
import { getCapabilityRecord } from '../shared/capabilityRecord';

export async function buildPlatformProbeOps() {
  const [eventBus, consumer, replay, platformProbe] = await Promise.all([
    platformEventPublisher.buildSummary(),
    readDeliveryConsumerOpsSummary(),
    readDeliveryConsumerReplaySummary(),
    readDeliveryConsumerPlatformProbe(),
  ]);
  const capabilities = buildNodeCapabilityOwnershipSummary({ consumer });

  return {
    eventBus,
    consumer,
    replay,
    platformProbe,
    ownership: getCapabilityRecord(capabilities, 'platform'),
    checkedAt: new Date().toISOString(),
  };
}
