import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import dotenv from 'dotenv';
import dns from 'dns';
import * as Sentry from '@sentry/node';

// Fix for Render/Supabase connection issues (defaults to IPv6)
dns.setDefaultResultOrder('ipv4first');
import { startAiSocketServer } from './aiSocketServer';
import { corsMiddleware } from './middleware/cors';
import { requestTraceMiddleware } from './middleware/requestTrace';
import { requestIdMiddleware, loggerMiddleware, devLogger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { isMongoConnected, sequelize, redis, connectDatabases } from './bootstrap/database';
import { registerRoutes } from './bootstrap/routes';
import { registerCronJobs } from './bootstrap/scheduler';
import { initializeSocketAndQueue } from './bootstrap/socket';
import { createChildLogger } from './utils/logger';
import {
  runtimeControlPlane,
  FailureClass,
  LifecyclePhase,
  LifecycleStatus,
  RecoveryAction,
} from './services/controlPlane/runtimeControlPlane';
import { buildNodeCapabilityOwnershipSummary } from './services/controlPlane/capabilityOwners';

const log = createChildLogger('index');

// 优雅关闭状态标志
let isShuttingDown = false;

// 加载环境变量
dotenv.config({ quiet: true });
runtimeControlPlane.markUnit({
  unit: 'backend_http',
  phase: LifecyclePhase.CONFIG_LOAD,
  status: LifecycleStatus.SPAWNING,
  critical: true,
  message: 'environment loaded',
});

// Sentry 初始化
const sentryDsn = process.env.SENTRY_DSN;
const sentryEnabled = Boolean(sentryDsn);
if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05') || 0.05,
  });
  log.info('Sentry enabled');
}

// Express 应用初始化
const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// 安全头 + 基础配置
app.use(helmet());
app.set('etag', false);
app.set('trust proxy', 1);

// 中间件
if (sentryEnabled) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = (Sentry as unknown as { Handlers?: { requestHandler?: () => express.RequestHandler } }).Handlers;
  if (typeof handlers?.requestHandler === 'function') {
    app.use(handlers.requestHandler());
  }
}
app.use(requestIdMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestTraceMiddleware);
app.use(loggerMiddleware);
if (process.env.NODE_ENV === 'development') {
  app.use(devLogger);
}

// Liveness 探针 — 仅检查进程是否存活
app.get('/health', (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'shutting_down' });
  }
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Readiness 探针 — 检查所有依赖是否就绪
app.get('/ready', async (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'shutting_down' });
  }

  const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

  const [mongo, postgres, redisStatus, ai] = await Promise.all([
    (async () => {
      const ok = isMongoConnected();
      return { name: 'mongo', status: ok ? 'ok' : 'degraded' };
    })(),
    (async () => {
      try {
        await Promise.race([sequelize.authenticate(), timeout(2000)]);
        return { name: 'postgres', status: 'ok' };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unreachable';
        return { name: 'postgres', status: 'error', message };
      }
    })(),
    (async () => {
      try {
        const pong = await Promise.race([redis.ping(), timeout(1500)]);
        return { name: 'redis', status: pong === 'PONG' ? 'ok' : 'degraded' };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unreachable';
        return { name: 'redis', status: 'error', message };
      }
    })(),
    (async () => {
      const hasKey = !!process.env.GEMINI_API_KEY;
      return { name: 'ai', status: hasKey ? 'ok' : 'degraded', message: hasKey ? undefined : 'GEMINI_API_KEY missing' };
    })(),
  ]);

  const services = [mongo, postgres, redisStatus, ai];
  const overallError = services.some((s) => s.status === 'error');
  const degraded = services.some((s) => s.status === 'degraded');
  const controlPlane = runtimeControlPlane.snapshot();
  const capabilityOwners = buildNodeCapabilityOwnershipSummary();

  res.status(overallError ? 503 : degraded ? 206 : 200).json({
    status: overallError ? 'error' : degraded ? 'degraded' : 'ok',
    services,
    controlPlane: {
      overallStatus: controlPlane.overallStatus,
      currentBlocker: controlPlane.currentBlocker,
      recommendations: controlPlane.recommendations,
      summary: controlPlane.summary,
      capabilitiesSummary: capabilityOwners.summary,
      nodeStrategicShape: capabilityOwners.nodeStrategicShape,
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 路由注册
registerRoutes(app);

// 全局错误处理 (Sentry + errorHandler)
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (sentryEnabled) {
    try { Sentry.captureException(err); } catch { /* ignore */ }
  }
  errorHandler(err, req, res, next);
});

// 启动服务器
const startServer = async () => {
  try {
    log.info('正在启动 Telegram Clone Backend...');
    runtimeControlPlane.markUnit({
      unit: 'backend_http',
      phase: LifecyclePhase.CONFIG_LOAD,
      status: LifecycleStatus.RUNNING,
      critical: true,
      message: 'backend startup sequence entered',
    });

    // AI Socket.IO 服务器
    const aiEnabled = (process.env.AI_SOCKET_ENABLED || 'true').toLowerCase() === 'true';
    const aiPort = process.env.AI_SOCKET_PORT || '5850';
    if (aiEnabled) {
      log.info({ port: aiPort }, '启动 AI Socket.IO 服务器...');
      startAiSocketServer();
      runtimeControlPlane.markUnit({
        unit: 'ai_socket',
        phase: LifecyclePhase.WORKER_BOOT,
        status: LifecycleStatus.RUNNING,
        message: `AI socket listening on ${aiPort}`,
      });
    } else {
      log.info('AI Socket.IO 服务器已禁用（AI_SOCKET_ENABLED=false）');
      runtimeControlPlane.markFailure('ai_socket', {
        phase: LifecyclePhase.WORKER_BOOT,
        failureClass: FailureClass.CONFIGURATION,
        message: 'AI socket disabled via AI_SOCKET_ENABLED=false',
        recoveryAction: RecoveryAction.DEGRADE_TO_COMPAT,
        compatMode: true,
      });
    }

    // 数据库连接
    await connectDatabases();

    // Socket.IO + 消息队列
    await initializeSocketAndQueue(httpServer);

    // 定时任务
    registerCronJobs();

    // 启动 HTTP 监听
    httpServer.listen(PORT, () => {
      runtimeControlPlane.markUnit({
        unit: 'backend_http',
        phase: LifecyclePhase.HTTP_LISTEN,
        status: LifecycleStatus.RUNNING,
        critical: true,
        message: `HTTP server listening on ${PORT}`,
      });
      log.info({
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        endpoints: {
          auth: 'POST /api/auth/register, POST /api/auth/login',
          messages: 'GET|POST /api/messages/*',
          contacts: 'GET|POST|PUT|DELETE /api/contacts/*',
          groups: 'GET|POST|PUT|DELETE /api/groups/*',
        },
      }, `Telegram Clone Backend 已启动 — http://localhost:${PORT}`);
    });

  } catch (error) {
    log.fatal({ err: error }, '服务器启动失败');
    runtimeControlPlane.markFailure('backend_http', {
      phase: LifecyclePhase.HTTP_LISTEN,
      failureClass: FailureClass.STARTUP,
      message: (error instanceof Error ? error.message : null) || 'backend startup failed',
      critical: true,
      recoveryAction: RecoveryAction.ESCALATE,
      incrementRetry: true,
    });
    process.exit(1);
  }
};

// 优雅关闭
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info({ signal }, '优雅关闭开始');

  // 10 秒硬超时
  const timeout = setTimeout(() => {
    log.error('关闭超时，强制退出');
    process.exit(1);
  }, 10_000);

  try {
    // 停止接受新连接
    httpServer.close(() => {
      log.info('HTTP 服务器已停止接受新连接');
    });

    // 并行关闭所有子系统
    await Promise.allSettled([
      // 关闭 Socket.IO
      (async () => {
        try {
          const { getSocketService } = await import('./services/socketRegistry');
          const svc = getSocketService();
          if (svc?.close) await svc.close();
        } catch { /* socket 可能未初始化 */ }
      })(),
      // 关闭 BullMQ 队列
      (async () => {
        try {
          const { queueService } = await import('./services/queueService');
          await queueService.close();
        } catch { /* queue 可能未初始化 */ }
      })(),
      // 关闭数据库连接
      (async () => {
        try {
          const mongoose = await import('mongoose');
          await mongoose.default.disconnect();
        } catch {}
      })(),
      (async () => {
        try {
          await sequelize.close();
        } catch {}
      })(),
      (async () => {
        try {
          await redis.quit();
        } catch {}
      })(),
    ]);

    clearTimeout(timeout);
    log.info('优雅关闭完成');
    process.exit(0);
  } catch (err) {
    log.error({ err }, '关闭过程中出错');
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
