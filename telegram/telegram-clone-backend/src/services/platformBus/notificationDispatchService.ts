import { randomUUID } from 'node:crypto';

import pubSubService, { CHANNELS } from '../pubSubService';
import { queueService, type NotificationJobData } from '../queueService';
import { buildNotificationDispatchRequestedEvent } from './eventFactory';
import { platformEventPublisher } from './eventPublisher';

export type NotificationDispatchExecutionMode = 'direct_queue' | 'platform_bus' | 'dual';

function readExecutionMode(): NotificationDispatchExecutionMode {
  const value = String(process.env.NOTIFICATION_DISPATCH_EXECUTION_MODE || '')
    .trim()
    .toLowerCase();
  if (value === 'platform_bus' || value === 'dual') {
    return value;
  }
  return 'direct_queue';
}

class NotificationDispatchService {
  private readonly executionMode = readExecutionMode();
  private bridgeReady = false;

  async dispatch(data: NotificationJobData): Promise<{ mode: NotificationDispatchExecutionMode; dispatchId: string }> {
    const dispatchId = randomUUID();
    if (this.executionMode === 'direct_queue' || this.executionMode === 'dual') {
      await queueService.addNotificationJob(data);
    }
    if (this.executionMode === 'platform_bus' || this.executionMode === 'dual') {
      await platformEventPublisher.publish([
        buildNotificationDispatchRequestedEvent({
          ...data,
          source: 'notification_dispatch_service',
        }),
      ]);
    }
    return {
      mode: this.executionMode,
      dispatchId,
    };
  }

  async initializePlatformBridge(): Promise<void> {
    if (this.bridgeReady) {
      return;
    }
    await pubSubService.initialize();
    const handler = async (data: NotificationJobData) => {
      await queueService.addNotificationJob(data);
    };
    pubSubService.on(CHANNELS.NOTIFICATION, handler);
    this.bridgeReady = true;
  }
}

export const notificationDispatchService = new NotificationDispatchService();
