import type { Server as HttpServer } from 'http';
import SocketService from '../services/socketService';
import { setSocketService } from '../services/socketRegistry';
import { queueService } from '../services/queueService';
import { notificationDispatchService } from '../services/platformBus/notificationDispatchService';
import { initFanoutWorker } from '../workers/fanoutWorker';
import { createChildLogger } from '../utils/logger';
import {
  runtimeControlPlane,
  FailureClass,
  LifecyclePhase,
  LifecycleStatus,
  RecoveryAction,
} from '../services/controlPlane/runtimeControlPlane';

const log = createChildLogger('bootstrap:socket');

export async function initializeSocketAndQueue(httpServer: HttpServer): Promise<SocketService> {
  // Socket.IO
  const socketService = new SocketService(httpServer);
  setSocketService(socketService);
  log.info('Socket.IO 服务已初始化');
  runtimeControlPlane.markUnit({
    unit: 'socket_gateway',
    phase: LifecyclePhase.WORKER_BOOT,
    status: LifecycleStatus.RUNNING,
    critical: true,
    message: 'Socket.IO gateway initialized',
  });

  // BullMQ + Fanout Worker
  try {
    await queueService.initialize();
    await notificationDispatchService.initializePlatformBridge();
    initFanoutWorker();
    log.info('BullMQ 消息队列 & Fanout Worker 已初始化');
    runtimeControlPlane.markUnit({
      unit: 'queue',
      phase: LifecyclePhase.WORKER_BOOT,
      status: LifecycleStatus.RUNNING,
      message: 'BullMQ initialized',
    });
    runtimeControlPlane.markUnit({
      unit: 'fanout_worker',
      phase: LifecyclePhase.WORKER_BOOT,
      status: LifecycleStatus.RUNNING,
      message: 'fanout worker initialized',
    });
    runtimeControlPlane.markUnit({
      unit: 'chat_delivery_bus',
      phase: LifecyclePhase.WORKER_BOOT,
      status: LifecycleStatus.RUNNING,
      message: 'chat delivery bus ready with queue transport',
    });
    runtimeControlPlane.markUnit({
      unit: 'platform_bus',
      phase: LifecyclePhase.WORKER_BOOT,
      status: LifecycleStatus.RUNNING,
      message: 'platform bus bridge ready for sync wake / presence / notification channels',
    });
  } catch (queueErr: unknown) {
    const message = queueErr instanceof Error ? queueErr.message : String(queueErr);
    log.warn({ err: message }, 'BullMQ 初始化失败，将回退同步模式');
    for (const unit of ['queue', 'fanout_worker', 'chat_delivery_bus', 'platform_bus']) {
      runtimeControlPlane.markFailure(unit, {
        phase: LifecyclePhase.WORKER_BOOT,
        failureClass: FailureClass.QUEUE_FALLBACK,
        message: unit === 'queue' ? message : `${unit} degraded due to queue failure`,
        recoveryAction: RecoveryAction.DEGRADE_TO_COMPAT,
        compatMode: true,
        incrementRetry: unit === 'queue',
      });
    }
  }

  return socketService;
}
