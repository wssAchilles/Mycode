import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';
import * as Sentry from '@sentry/node';

// Fix for Render/Supabase connection issues (defaults to IPv6)
dns.setDefaultResultOrder('ipv4first');
import { startAiSocketServer } from './aiSocketServer';
import { corsMiddleware } from './middleware/cors';
import { requestTraceMiddleware } from './middleware/requestTrace';
import { loggerMiddleware, customLogger } from './middleware/logger';
import { connectMongoDB, isMongoConnected } from './config/db';
import { connectPostgreSQL, sequelize } from './config/sequelize';
import { connectRedis, redis } from './config/redis';
import SocketService from './services/socketService';
import { setSocketService } from './services/socketRegistry';
import { authenticateToken } from './middleware/authMiddleware';
import authRoutes from './routes/authRoutes';
import aiRoutes from './routes/aiRoutes';
import aiChatRoutes from './routes/aiChatRoutes';
import messageRoutes from './routes/messageRoutes';
import contactRoutes from './routes/contactRoutes';
import groupRoutes from './routes/groupRoutes';
import uploadRoutes from './routes/uploadRoutes';
import keyRoutes from './routes/keys';
import syncRoutes from './routes/sync';
import spaceRoutes from './routes/space';
import newsRoutes from './routes/newsRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import featureRoutes from './routes/featureRoutes';
import mlProxyRoutes from './routes/mlProxy';
import opsRoutes from './routes/ops';
import { queueService } from './services/queueService';
import { pubSubService } from './services/pubSubService';
import cron from 'node-cron';
import { spaceService } from './services/spaceService';
import { newsService } from './services/newsService';
import { simClustersBatchJob } from './services/jobs/SimClustersBatchJob';
import { realGraphDecayJob } from './services/jobs/RealGraphDecayJob';
import { initFanoutWorker } from './workers/fanoutWorker';

// 加载环境变量
dotenv.config();

const sentryDsn = process.env.SENTRY_DSN;
const sentryEnabled = Boolean(sentryDsn);
if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05') || 0.05,
  });
  console.log('🛰️ Sentry enabled');
}

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// Disable ETag for dynamic APIs to avoid stale 304 responses
app.set('etag', false);
// Trust reverse proxy (Render/Cloud Run) so rate limiter can read X-Forwarded-For
app.set('trust proxy', 1);

// 初始化 Socket.IO 服务
let socketService: SocketService;

// 中间件设置
if (sentryEnabled) {
  const sentryAny = Sentry as any;
  if (typeof sentryAny?.Handlers?.requestHandler === 'function') {
    app.use(sentryAny.Handlers.requestHandler());
  }
}
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestTraceMiddleware);
app.use(loggerMiddleware);

// 在开发环境下使用详细日志
if (process.env.NODE_ENV === 'development') {
  app.use(customLogger);
}

// 静态文件服务 - 为上传的文件提供访问
const uploadsPath = path.join(__dirname, '../uploads');
console.log(`📁 配置静态文件服务: /api/uploads -> ${uploadsPath}`);
app.use('/api/uploads', authenticateToken, express.static(uploadsPath, {
  setHeaders: (res, filePath) => {
    // 设置适当的 Content-Type
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      res.setHeader('Content-Type', `image/${ext.substring(1)}`);
    } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
      res.setHeader('Content-Type', `audio/${ext.substring(1)}`);
    } else if (['.mp4', '.avi', '.mov', '.wmv'].includes(ext)) {
      res.setHeader('Content-Type', `video/${ext.substring(1)}`);
    }
    // 允许浏览器缓存文件
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1年
  }
}));

// 健康检查路由
app.get('/health', async (_req, res) => {
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
      } catch (error: any) {
        return { name: 'postgres', status: 'error', message: error?.message || 'unreachable' };
      }
    })(),
    (async () => {
      try {
        const pong = await Promise.race([redis.ping(), timeout(1500)]);
        return { name: 'redis', status: pong === 'PONG' ? 'ok' : 'degraded' };
      } catch (error: any) {
        return { name: 'redis', status: 'error', message: error?.message || 'unreachable' };
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

  res.status(overallError ? 503 : degraded ? 206 : 200).json({
    status: overallError ? 'error' : degraded ? 'degraded' : 'ok',
    services,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 认证路由
app.use('/api/auth', authRoutes);

// AI 聊天路由
app.use('/api/ai', aiRoutes);

// AI 聊天路由
app.use('/api/ai-chat', aiChatRoutes);

// 消息路由
app.use('/api/messages', messageRoutes);

// 联系人路由
app.use('/api/contacts', contactRoutes);

// 群组路由
app.use('/api/groups', groupRoutes);

// 文件上传路由
app.use('/api', uploadRoutes);

// Signal Protocol 密钥管理路由
app.use('/api/keys', keyRoutes);

// 消息同步路由 (PTS/Gap Recovery)
app.use('/api/sync', syncRoutes);

// 空间动态路由 (Space Feed + 推荐算法)
app.use('/api/space', authenticateToken, spaceRoutes);
app.use('/api/news', authenticateToken, newsRoutes);

// ML Proxy 路由 (解决前端 CORS 问题)
app.use('/api/ml', authenticateToken, mlProxyRoutes);

// 分析监控路由 (Dashboard + A/B Experiments + Event Tracking)
app.use('/api/analytics', authenticateToken, analyticsRoutes);

// 特征存储路由 (X Algorithm Feature Store)
app.use('/api/features', authenticateToken, featureRoutes);

// 运维观测路由（chat runtime / trace metrics）
app.use('/api/ops', opsRoutes);

app.use('/api/ai', aiRoutes);

// API 路由（后续添加）
app.get('/api', (req, res) => {
  res.json({
    message: 'Telegram Clone API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api',
      auth: '/api/auth',
      users: '/api/users',
      messages: '/api/messages',
      contacts: '/api/contacts',
      groups: '/api/groups',
      upload: '/api/upload',
      files: '/api/uploads/:filename',
      ai: '/api/ai',
      space: '/api/space',
      ops: '/api/ops/chat-runtime'
    }
  });
});

// 404 处理 - 使用更简单的方式
app.use((req, res) => {
  res.status(404).json({
    error: '路由未找到',
    message: `无法找到 ${req.method} ${req.originalUrl}`
  });
});

// 错误处理中间件
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ 服务器错误:', error);
  if (sentryEnabled) {
    try {
      Sentry.captureException(error);
    } catch {
      // ignore
    }
  }

  res.status(error.status || 500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? error.message : '服务暂时不可用',
    timestamp: new Date().toISOString()
  });
});

// 启动服务器并连接数据库
const startServer = async () => {
  try {
    console.log('🚀 正在启动 Telegram Clone Backend...');

    // 启动 AI Socket.IO 服务器（可通过环境变量开关与端口控制）
    const aiEnabled = (process.env.AI_SOCKET_ENABLED || 'true').toLowerCase() === 'true';
    const aiPort = process.env.AI_SOCKET_PORT || '5850';
    if (aiEnabled) {
      console.log(`🤖 启动 AI Socket.IO 服务器 (端口: ${aiPort})...`);
      startAiSocketServer();
    } else {
      console.log('🤖 AI Socket.IO 服务器已禁用（AI_SOCKET_ENABLED=false）');
    }

    // 连接 MongoDB（阻塞服务器启动，确保就绪）
    console.log('📊 正在连接 MongoDB（最多等待30秒）...');
    try {
      await Promise.race([
        connectMongoDB(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('MongoDB 连接超时')), 30000))
      ]);
      console.log('✅ MongoDB 初始连接完成');
    } catch (err: any) {
      if ((process.env.NODE_ENV || 'development') === 'development') {
        console.warn('⚠️ 开发模式下 MongoDB 初始连接失败，将继续启动服务器。原因:', err?.message || err);
        console.warn('   • API 与 Socket 将在访问数据库时返回 503（数据库未就绪）');
        console.warn('   • 请稍后修复 Mongo 连接、或使用本地 MongoDB 临时开发');
      } else {
        console.error('❌ 无法连接到 MongoDB，服务器启动中止:', err?.message || err);
        throw err;
      }
    }

    // 连接其他数据库（不阻塞服务器启动）
    console.log('📊 正在连接 PostgreSQL 和 Redis（不阻塞启动）...');
    const tasks: Array<{ name: string; promise: Promise<unknown>; skipped?: boolean }> = [];

    tasks.push({
      name: 'PostgreSQL',
      promise: Promise.race([
        connectPostgreSQL(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('PostgreSQL 连接超时')), 15000)),
      ]),
    });

    const redisConfigured = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
    const redisEnabled = redisConfigured && process.env.REDIS_ENABLED !== 'false';
    if (redisEnabled) {
      tasks.push({
        name: 'Redis',
        promise: Promise.race([
          connectRedis(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis 连接超时')), 15000)),
        ]),
      });
    } else {
      tasks.push({
        name: 'Redis',
        promise: Promise.resolve('skipped'),
        skipped: true,
      });
    }

    Promise.allSettled(tasks.map((t) => t.promise)).then((results) => {
      results.forEach((result, idx) => {
        const task = tasks[idx];
        if (task?.skipped) {
          console.log(`⏭️ ${task.name} 未配置/已禁用，跳过连接`);
          return;
        }
        if (result.status === 'fulfilled') {
          console.log(`✅ ${task.name} 连接成功`);
        } else {
          console.warn(`⚠️ ${task.name} 连接失败: ${result.reason?.message || '连接被拒绝'}`);
        }
      });
    });

    // 初始化 Socket.IO 服务
    socketService = new SocketService(httpServer);
    setSocketService(socketService);
    console.log('🔌 Socket.IO 服务已初始化');

    // 初始化消息队列服务 (P0 异步写扩散)
    try {
      await queueService.initialize();
      initFanoutWorker();
      console.log('📬 BullMQ 消息队列 & Fanout Worker 已初始化');
    } catch (queueErr: any) {
      console.warn('⚠️ BullMQ 初始化失败，将回退同步模式:', queueErr.message);
    }

    // 初始化 Redis Pub/Sub 服务
    // await pubSubService.initialize();
    // console.log('📡 Redis Pub/Sub 已初始化');

    // 初始化定时任务 (Daily Cleanup)
    cron.schedule('0 0 * * *', async () => {
      console.log('🧹 [Cron] Starting daily news cleanup...');
      try {
        const count = await spaceService.cleanupOldNews();
        console.log(`✅ [Cron] Cleaned up ${count} old news posts.`);
      } catch (error) {
        console.error('❌ [Cron] Cleanup failed:', error);
      }
    });
    console.log('⏰ 定时清理任务已启动 (每日 00:00)');

    // NewsService 清理 (内容 30 天 / 元数据 90 天)
    cron.schedule('30 0 * * *', async () => {
      console.log('🧹 [Cron] Starting news content cleanup...');
      try {
        const result = await newsService.cleanup(30, 90);
        console.log(`✅ [Cron] News cleanup done: stripped=${result.stripped}, deleted=${result.deleted}`);
      } catch (error) {
        console.error('❌ [Cron] News cleanup failed:', error);
      }
    });
    console.log('⏰ News 内容清理任务已启动 (每日 00:30)');

    // News 用户向量更新 (每日 01:00)
    cron.schedule('0 1 * * *', async () => {
      console.log('🧠 [Cron] Starting news user vector update...');
      try {
        const updated = await newsService.updateUserVectors();
        console.log(`✅ [Cron] News user vectors updated: ${updated}`);
      } catch (error) {
        console.error('❌ [Cron] News user vector update failed:', error);
      }
    });
    console.log('⏰ News 用户向量任务已启动 (每日 01:00)');

    // SimClusters 离线嵌入计算 (每日 03:00)
    cron.schedule('0 3 * * *', async () => {
      console.log('🔄 [Cron] Starting SimClusters batch job...');
      try {
        const result = await simClustersBatchJob.run();
        console.log(`✅ [Cron] SimClusters completed: ${result.success} users updated in ${result.durationMs}ms`);
      } catch (error) {
        console.error('❌ [Cron] SimClusters job failed:', error);
      }
    });
    console.log('⏰ SimClusters 批量任务已启动 (每日 03:00)');

    // RealGraph 衰减计算 (每日 04:00)
    cron.schedule('0 4 * * *', async () => {
      console.log('📉 [Cron] Starting RealGraph decay job...');
      try {
        const result = await realGraphDecayJob.run();
        console.log(`✅ [Cron] RealGraph decay completed: ${result.decayedEdges} edges in ${result.durationMs}ms`);
      } catch (error) {
        console.error('❌ [Cron] RealGraph decay failed:', error);
      }
    });
    console.log('⏰ RealGraph 衰减任务已启动 (每日 04:00)');

    // 启动服务器（MongoDB 已连接）
    httpServer.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log(`🎉 Telegram Clone Backend 已启动!`);
      console.log(`🌍 HTTP 服务器: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket 服务器: ws://localhost:${PORT}`);
      console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📅 启动时间: ${new Date().toISOString()}`);
      console.log('');
      console.log('📋 可用的 API 端点:');
      console.log('🔐 认证: POST /api/auth/register, POST /api/auth/login');
      console.log('💬 消息: GET|POST /api/messages/*');
      console.log('👥 联系人: GET|POST|PUT|DELETE /api/contacts/*');
      console.log('🏢 群组: GET|POST|PUT|DELETE /api/groups/*');
      console.log('');
      console.log('='.repeat(60));
    });

  } catch (error) {
    console.error('❌ 服务器启动失败:', error);
    process.exit(1);
  }
};

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('👋 收到 SIGTERM 信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 收到 SIGINT 信号，正在关闭服务器...');
  process.exit(0);
});

// 启动应用
startServer();
