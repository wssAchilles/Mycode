import type {
  ChatDeliveryEventBusSummary,
  ChatDeliveryEventEnvelope,
} from './busContracts';
import type { MessageFanoutCommand } from './contracts';

export interface QueueJobRef {
  id?: string;
}

export interface FanoutCommandExecutor {
  enqueue(commands: MessageFanoutCommand[]): Promise<Array<QueueJobRef>>;
}

export interface DeliveryEventPublisher {
  publish(events: ChatDeliveryEventEnvelope[]): Promise<void>;
  buildSummary(recentLimit?: number): Promise<ChatDeliveryEventBusSummary>;
}
