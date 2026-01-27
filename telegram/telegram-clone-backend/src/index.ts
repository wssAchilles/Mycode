import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';

// Fix for Render/Supabase connection issues (defaults to IPv6)
dns.setDefaultResultOrder('ipv4first');
import { startAiSocketServer } from './aiSocketServer';
import { corsMiddleware } from './middleware/cors';
import { loggerMiddleware, customLogger } from './middleware/logger';
import { connectMongoDB, isMongoConnected } from './config/db';
import { connectPostgreSQL, sequelize } from './config/sequelize';
import { connectRedis, redis } from './config/redis';
import SocketService from './services/socketService';
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
import analyticsRoutes from './routes/analyticsRoutes';
import featureRoutes from './routes/featureRoutes';
import { queueService } from './services/queueService';
import { pubSubService } from './services/pubSubService';
import cron from 'node-cron';
import { spaceService } from './services/spaceService';

// 加载环境变量
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// 初始化 Socket.IO 服务
let socketService: SocketService;

// 中间件设置
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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

// 分析监控路由 (Dashboard + A/B Experiments + Event Tracking)
app.use('/api/analytics', authenticateToken, analyticsRoutes);

// 特征存储路由 (X Algorithm Feature Store)
app.use('/api/features', authenticateToken, featureRoutes);

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
      space: '/api/space'
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
    Promise.allSettled([
      Promise.race([
        connectPostgreSQL(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('PostgreSQL 连接超时')), 15000))
      ]),
      /*
      Promise.race([
        connectRedis(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis 连接超时')), 15000))
      ])
      */
      Promise.resolve() // Skip Redis for local verify
    ]).then(results => {
      const dbNames = ['PostgreSQL', 'Redis'];
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          console.log(`✅ ${dbNames[idx]} 连接成功`);
        } else {
          console.warn(`⚠️ ${dbNames[idx]} 连接失败: ${result.reason?.message || '连接被拒绝'}`);
        }
      });
    });

    // 初始化 Socket.IO 服务
    socketService = new SocketService(httpServer);
    console.log('🔌 Socket.IO 服务已初始化');

    // 初始化消息队列服务
    // await queueService.initialize();
    // console.log('📬 BullMQ 消息队列已初始化');

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
