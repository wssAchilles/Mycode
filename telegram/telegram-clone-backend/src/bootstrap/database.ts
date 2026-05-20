import { connectMongoDB, isMongoConnected } from '../config/db';
import { connectPostgreSQL, sequelize } from '../config/sequelize';
import { connectRedis, redis } from '../config/redis';
import { createChildLogger } from '../utils/logger';
import {
  runtimeControlPlane,
  FailureClass,
  LifecyclePhase,
  LifecycleStatus,
  RecoveryAction,
} from '../services/controlPlane/runtimeControlPlane';

const log = createChildLogger('bootstrap:database');

export async function connectDatabases(): Promise<void> {
  // MongoDB — 阻塞服务器启动，确保就绪
  log.info('正在连接 MongoDB（最多等待30秒）...');
  runtimeControlPlane.markUnit({
    unit: 'mongo',
    phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
    status: LifecycleStatus.SPAWNING,
    critical: true,
    recoveryAction: RecoveryAction.RETRY_ONCE,
    message: 'attempting initial MongoDB bootstrap',
  });
  try {
    await Promise.race([
      connectMongoDB(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MongoDB 连接超时')), 30000))
    ]);
    log.info('MongoDB 初始连接完成');
    runtimeControlPlane.recordRecovery('mongo', 'MongoDB bootstrap succeeded', {
      phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if ((process.env.NODE_ENV || 'development') === 'development') {
      log.warn({ err: message }, '开发模式下 MongoDB 初始连接失败，将继续启动服务器');
      log.warn('API 与 Socket 将在访问数据库时返回 503（数据库未就绪）');
      runtimeControlPlane.markFailure('mongo', {
        phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
        failureClass: FailureClass.DEPENDENCY_BOOTSTRAP,
        message,
        critical: true,
        recoveryAction: RecoveryAction.RETRY_ONCE,
        incrementRetry: true,
      });
    } else {
      log.fatal({ err: message }, '无法连接到 MongoDB，服务器启动中止');
      runtimeControlPlane.markFailure('mongo', {
        phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
        failureClass: FailureClass.DEPENDENCY_BOOTSTRAP,
        message,
        critical: true,
        recoveryAction: RecoveryAction.ESCALATE,
        incrementRetry: true,
      });
      throw err;
    }
  }

  // PostgreSQL + Redis — 不阻塞服务器启动
  log.info('正在连接 PostgreSQL 和 Redis（不阻塞启动）...');
  const tasks: Array<{ name: string; unit: string; promise: Promise<unknown>; skipped?: boolean }> = [];
  runtimeControlPlane.markUnit({
    unit: 'postgres',
    phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
    status: LifecycleStatus.SPAWNING,
    critical: true,
    recoveryAction: RecoveryAction.RETRY_ONCE,
    message: 'attempting PostgreSQL bootstrap',
  });

  tasks.push({
    name: 'PostgreSQL',
    unit: 'postgres',
    promise: Promise.race([
      connectPostgreSQL(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PostgreSQL 连接超时')), 15000)),
    ]),
  });

  const redisConfigured = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
  const redisEnabled = redisConfigured && process.env.REDIS_ENABLED !== 'false';
  if (redisEnabled) {
    runtimeControlPlane.markUnit({
      unit: 'redis',
      phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
      status: LifecycleStatus.SPAWNING,
      recoveryAction: RecoveryAction.DEGRADE_TO_COMPAT,
      message: 'attempting Redis bootstrap',
    });
    tasks.push({
      name: 'Redis',
      unit: 'redis',
      promise: Promise.race([
        connectRedis(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis 连接超时')), 15000)),
      ]),
    });
  } else {
    tasks.push({
      name: 'Redis',
      unit: 'redis',
      promise: Promise.resolve('skipped'),
      skipped: true,
    });
    runtimeControlPlane.markFailure('redis', {
      phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
      failureClass: FailureClass.CONFIGURATION,
      message: 'Redis disabled or not configured',
      recoveryAction: RecoveryAction.DEGRADE_TO_COMPAT,
      compatMode: true,
    });
  }

  Promise.allSettled(tasks.map((t) => t.promise)).then((results) => {
    results.forEach((result, idx) => {
      const task = tasks[idx];
      if (task?.skipped) {
        log.info(`${task.name} 未配置/已禁用，跳过连接`);
        return;
      }
      if (result.status === 'fulfilled') {
        log.info(`${task.name} 连接成功`);
        runtimeControlPlane.recordRecovery(task.unit, `${task.name} connected`, {
          phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
        });
      } else {
        log.warn({ err: result.reason?.message }, `${task.name} 连接失败`);
        runtimeControlPlane.markFailure(task.unit, {
          phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
          failureClass: FailureClass.DEPENDENCY_BOOTSTRAP,
          message: result.reason?.message || `${task.name} connection rejected`,
          critical: task.name === 'PostgreSQL',
          recoveryAction: task.name === 'Redis' ? RecoveryAction.DEGRADE_TO_COMPAT : RecoveryAction.RETRY_ONCE,
          compatMode: task.name === 'Redis',
          incrementRetry: true,
        });
      }
    });
  });
}

export { isMongoConnected, sequelize, redis };
