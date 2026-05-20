import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { realtimeOps } from '../realtimeProtocol/realtimeOps';
import {
  createRealtimeDeliveryEnvelope,
  type RealtimeDeliveryTarget,
  type RealtimeDeliveryTopic,
  type RealtimeCompatDispatchEnvelopeV1,
} from '../realtimeProtocol/eventBusContracts';
import { realtimeDeliveryPublisher } from '../realtimeProtocol/delivery/realtimeDeliveryPublisher';
import { translateDisplayEnvelopeToCompatMessage } from '../realtimeProtocol/displayPlaneContract';
import { isRustRealtimeEdgePrimary } from '../realtimeProtocol/contracts';
import { realtimeCompatDispatchBridge } from '../realtimeProtocol/compat/compatDispatchBridge';
import { createChildLogger } from '../../utils/logger';
import type { TypedSocketIOServer, RealtimeBatchEvent, RealtimeDispatchEvent } from './types';
import type { BatchEmitter } from './batchEmitter';

const log = createChildLogger('services:socket:dispatch');

export class RealtimeDispatcher {
  private readonly deliveryPrimaryEnabled = isRustRealtimeEdgePrimary();

  constructor(
    private io: TypedSocketIOServer,
    private batchEmitter: BatchEmitter,
    private emitLegacy: boolean,
  ) {}

  setupCompatBridge(): void {
    void realtimeCompatDispatchBridge
      .initialize((dispatch) => this.applyCompatDispatch(dispatch))
      .catch(() => {
        chatRuntimeMetrics.increment('realtime.compatDispatch.initErrors');
      });
  }

  emitToUser(userId: string, event: RealtimeBatchEvent): void {
    this.dispatchRealtimeDelivery({ kind: 'user', id: userId }, event);
  }

  emitToRoom(groupId: string, event: RealtimeBatchEvent): void {
    this.dispatchRealtimeDelivery({ kind: 'room', id: groupId }, event);
  }

  emitToSocket(socketId: string, event: RealtimeBatchEvent): void {
    this.dispatchRealtimeDelivery({ kind: 'socket', id: socketId }, event);
  }

  emitBroadcast(event: RealtimeBatchEvent): void {
    this.dispatchRealtimeDelivery({ kind: 'broadcast' }, event);
  }

  private dispatchRealtimeDelivery(target: RealtimeDeliveryTarget, event: RealtimeDispatchEvent): void {
    if (target.kind !== 'broadcast' && !String(target.id || '').trim()) return;

    if (this.deliveryPrimaryEnabled) {
      realtimeOps.recordDeliveryRequested(target.kind, event.type);
      const envelope = createRealtimeDeliveryEnvelope({
        topic: this.deliveryTopicForEvent(event),
        target,
        payload: event.payload,
      });
      void realtimeDeliveryPublisher
        .publish([envelope])
        .then(() => {
          realtimeOps.recordDeliveryPublished(target.kind, event.type);
        })
        .catch((error) => {
          chatRuntimeMetrics.increment('realtime.delivery.publish.backgroundErrors');
          realtimeOps.recordDeliveryPublishFailed(target.kind, event.type);
          realtimeOps.recordCompatFallbackEmit(target.kind, event.type);
          log.error({ err: error }, '发布 realtime delivery 事件失败，回退本地 compat emit');
          this.emitLocally(target, event, 'fallback');
        });
      return;
    }

    this.emitLocally(target, event, 'local');
  }

  private emitLocally(
    target: RealtimeDeliveryTarget,
    event: RealtimeDispatchEvent,
    dispatchSource: 'local' | 'compat_dispatch' | 'fallback',
  ): void {
    if (event.type === 'typing') {
      this.emitTypingLocally(target, event.payload, dispatchSource);
      return;
    }

    switch (target.kind) {
      case 'user':
        if (target.id) this.emitBatchLocallyToUser(target.id, event, dispatchSource);
        break;
      case 'room':
        if (target.id) this.emitBatchLocallyToRoom(target.id, event, dispatchSource);
        break;
      case 'socket':
        if (target.id) this.emitBatchLocallyToSocket(target.id, event, dispatchSource);
        break;
      case 'broadcast':
        this.emitBatchLocallyBroadcast(event, dispatchSource);
        break;
    }
  }

  private emitBatchLocallyToUser(
    userId: string,
    event: RealtimeBatchEvent,
    dispatchSource: 'local' | 'compat_dispatch' | 'fallback',
  ): void {
    const adapted = this.adaptBatchEvent(event);
    realtimeOps.recordRealtimeEmit('user', event.type, 1, dispatchSource);
    this.batchEmitter.queue(
      `user:${userId}`,
      (events) => this.io.to(`user:${userId}`).emit('realtimeBatch', events),
      adapted,
    );
  }

  private emitBatchLocallyToRoom(
    groupId: string,
    event: RealtimeBatchEvent,
    dispatchSource: 'local' | 'compat_dispatch' | 'fallback',
  ): void {
    const adapted = this.adaptBatchEvent(event);
    realtimeOps.recordRealtimeEmit('room', event.type, 1, dispatchSource);
    this.batchEmitter.queue(
      `room:${groupId}`,
      (events) => this.io.to(`room:${groupId}`).emit('realtimeBatch', events),
      adapted,
    );
  }

  private emitBatchLocallyToSocket(
    socketId: string,
    event: RealtimeBatchEvent,
    dispatchSource: 'local' | 'compat_dispatch' | 'fallback',
  ): void {
    const adapted = this.adaptBatchEvent(event);
    realtimeOps.recordRealtimeEmit('socket', event.type, 1, dispatchSource);
    this.batchEmitter.queue(
      `socket:${socketId}`,
      (events) => this.io.to(socketId).emit('realtimeBatch', events),
      adapted,
    );
  }

  private emitBatchLocallyBroadcast(
    event: RealtimeBatchEvent,
    dispatchSource: 'local' | 'compat_dispatch' | 'fallback',
  ): void {
    const adapted = this.adaptBatchEvent(event);
    realtimeOps.recordRealtimeEmit('broadcast', event.type, 1, dispatchSource);
    this.batchEmitter.queue(
      'broadcast:global',
      (events) => this.io.emit('realtimeBatch', events),
      adapted,
    );
  }

  emitTypingLocally(
    target: RealtimeDeliveryTarget,
    payload: { userId: string; username: string; isTyping: boolean; groupId?: string },
    dispatchSource: 'local' | 'compat_dispatch' | 'fallback',
  ): void {
    const eventName = payload.isTyping ? 'typingStart' : 'typingStop';
    const message = payload.groupId
      ? { userId: payload.userId, username: payload.username, groupId: payload.groupId }
      : { userId: payload.userId, username: payload.username };

    switch (target.kind) {
      case 'user':
        if (target.id) {
          realtimeOps.recordRealtimeEmit('user', 'typing', 1, dispatchSource);
          this.io.to(`user:${target.id}`).emit(eventName, message);
        }
        break;
      case 'room':
        if (target.id) {
          realtimeOps.recordRealtimeEmit('room', 'typing', 1, dispatchSource);
          let broadcast = this.io.to(`room:${target.id}`);
          for (const socketId of target.excludeSocketIds || []) {
            broadcast = broadcast.except(socketId);
          }
          broadcast.emit(eventName, message);
        }
        break;
      case 'socket':
        if (target.id) {
          realtimeOps.recordRealtimeEmit('socket', 'typing', 1, dispatchSource);
          this.io.to(target.id).emit(eventName, message);
        }
        break;
      case 'broadcast':
        realtimeOps.recordRealtimeEmit('broadcast', 'typing', 1, dispatchSource);
        this.io.emit(eventName, message);
        break;
    }
  }

  private applyCompatDispatch(dispatch: RealtimeCompatDispatchEnvelopeV1): void {
    const eventType = this.dispatchEventTypeFromTopic(dispatch.topic);
    realtimeOps.recordCompatDispatchReceived(eventType, dispatch.target.socketIds.length);
    if (!dispatch.target.socketIds.length) return;

    if (eventType === 'typing') {
      for (const socketId of dispatch.target.socketIds) {
        this.emitTypingLocally(
          { kind: 'socket', id: socketId },
          {
            userId: String((dispatch.payload as any)?.userId || ''),
            username: String((dispatch.payload as any)?.username || 'Unknown'),
            isTyping: Boolean((dispatch.payload as any)?.isTyping),
            groupId: typeof (dispatch.payload as any)?.groupId === 'string'
              ? String((dispatch.payload as any).groupId)
              : undefined,
          },
          'compat_dispatch',
        );
      }
    } else {
      const event: RealtimeBatchEvent = {
        type: eventType,
        payload: eventType === 'message'
          ? translateDisplayEnvelopeToCompatMessage(dispatch.payload)
          : dispatch.payload,
      };
      for (const socketId of dispatch.target.socketIds) {
        this.emitBatchLocallyToSocket(socketId, event, 'compat_dispatch');
      }
    }

    realtimeOps.recordCompatDispatchEmitted(eventType, dispatch.target.socketIds.length);
  }

  private adaptBatchEvent(event: RealtimeBatchEvent): RealtimeBatchEvent {
    if (event.type !== 'message') return event;
    return {
      ...event,
      payload: translateDisplayEnvelopeToCompatMessage(event.payload),
    };
  }

  private deliveryTopicForEvent(event: RealtimeDispatchEvent): RealtimeDeliveryTopic {
    switch (event.type) {
      case 'message': return 'message';
      case 'presence': return 'presence';
      case 'typing': return 'typing';
      case 'readReceipt': return 'read_receipt';
      case 'groupUpdate': return 'group_update';
    }
  }

  private dispatchEventTypeFromTopic(
    topic: RealtimeDeliveryTopic,
  ): 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing' {
    switch (topic) {
      case 'message': return 'message';
      case 'presence': return 'presence';
      case 'typing': return 'typing';
      case 'read_receipt': return 'readReceipt';
      case 'group_update': return 'groupUpdate';
    }
  }
}
