import { chatFanoutCommandBus } from '../../chatDelivery/fanoutCommandBus';
import { chatDeliveryEventPublisher } from '../../chatDelivery/eventPublisher';
import { createChatDeliveryPrimaryFallbackService } from '../../chatDelivery/primaryFallbackService';
import { getChatDeliveryExecutionPolicySummary } from '../../chatDelivery/executionPolicy';
import { readDeliveryConsumerOpsSummary } from '../../chatDelivery/deliveryConsumerOps';
import { readDeliveryCanaryStreamSummary } from '../../chatDelivery/deliveryCanaryOps';
import { chatDeliveryConsistencyService } from '../../chatDelivery/chatDeliveryConsistencyService';
import { assessChatDeliveryRollout } from '../../chatDelivery/rolloutAssessment';
import { readMessageFanoutQueueStats } from '../shared/queueStats';

export async function buildChatDeliveryOps() {
  const fallbackService = await createChatDeliveryPrimaryFallbackService();
  const [queue, eventBus, consumer, canary, consistency, fallback] = await Promise.all([
    readMessageFanoutQueueStats(),
    chatDeliveryEventPublisher.buildSummary(),
    readDeliveryConsumerOpsSummary(),
    readDeliveryCanaryStreamSummary(),
    chatDeliveryConsistencyService.buildSummary(),
    fallbackService.buildSummary(),
  ]);
  const rollout = getChatDeliveryExecutionPolicySummary();
  const policy = assessChatDeliveryRollout({
    rollout,
    consumer,
    canary,
    consistency,
    fallback,
  });

  return {
    snapshot: await chatFanoutCommandBus.buildOpsSnapshot(),
    queue,
    eventBus,
    rollout,
    consumer,
    canary,
    consistency,
    fallback,
    policy,
  };
}
