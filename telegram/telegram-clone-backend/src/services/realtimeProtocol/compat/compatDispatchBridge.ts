import type Redis from 'ioredis';

import { redis } from '../../../config/redis';
import { chatRuntimeMetrics } from '../../chatRuntimeMetrics';
import {
  REALTIME_COMPAT_DISPATCH_CHANNEL,
  REALTIME_COMPAT_DISPATCH_SPEC_VERSION,
  type RealtimeCompatDispatchEnvelopeV1,
} from '../eventBusContracts';

type CompatDispatchHandler = (message: RealtimeCompatDispatchEnvelopeV1) => void;

export class RealtimeCompatDispatchBridge {
  private subscriber: Redis | null = null;
  private initialized = false;

  async initialize(handler: CompatDispatchHandler): Promise<void> {
    if (this.initialized) {
      return;
    }

    const subscriber = redis.duplicate();
    subscriber.on('error', () => {
      chatRuntimeMetrics.increment('realtime.compatDispatch.errors');
    });
    subscriber.on('message', (_channel, rawMessage) => {
      try {
        const message = JSON.parse(rawMessage) as RealtimeCompatDispatchEnvelopeV1;
        if (message.specVersion !== REALTIME_COMPAT_DISPATCH_SPEC_VERSION) {
          chatRuntimeMetrics.increment('realtime.compatDispatch.invalidSpecVersion');
          return;
        }
        handler(message);
      } catch {
        chatRuntimeMetrics.increment('realtime.compatDispatch.parseErrors');
      }
    });

    await subscriber.connect();
    await subscriber.subscribe(REALTIME_COMPAT_DISPATCH_CHANNEL);
    this.subscriber = subscriber;
    this.initialized = true;
    chatRuntimeMetrics.increment('realtime.compatDispatch.ready');
  }

  async close(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = null;
    this.initialized = false;
    if (subscriber) {
      await subscriber.quit();
    }
  }
}

export const realtimeCompatDispatchBridge = new RealtimeCompatDispatchBridge();
