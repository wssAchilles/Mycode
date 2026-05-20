import express, { type Express } from 'express';
import path from 'path';
import { authenticateToken } from '../middleware/authMiddleware';
import { notFoundHandler } from '../middleware/errorHandler';
import { createChildLogger } from '../utils/logger';
import authRoutes from '../routes/authRoutes';
import aiRoutes from '../routes/aiRoutes';
import aiChatRoutes from '../routes/aiChatRoutes';
import messageRoutes from '../routes/messageRoutes';
import contactRoutes from '../routes/contactRoutes';
import groupRoutes from '../routes/groupRoutes';
import uploadRoutes from '../routes/uploadRoutes';
import keyRoutes from '../routes/keys';
import syncRoutes from '../routes/sync';
import realtimeRoutes from '../routes/realtime';
import spaceRoutes from '../routes/space';
import newsRoutes from '../routes/newsRoutes';
import analyticsRoutes from '../routes/analyticsRoutes';
import featureRoutes from '../routes/featureRoutes';
import mlProxyRoutes from '../routes/mlProxy';
import opsRoutes from '../routes/ops';
import recommendationInternalRoutes from '../routes/recommendationInternal';
import graphKernelInternalRoutes from '../routes/graphKernelInternal';
import pushRoutes from '../routes/pushRoutes';

const log = createChildLogger('bootstrap:routes');

export function registerRoutes(app: Express): void {
  // 静态文件服务 - 为上传的文件提供访问
  const uploadsPath = path.join(__dirname, '../../uploads');
  log.info({ path: uploadsPath }, '配置静态文件服务: /api/uploads');
  app.use('/api/uploads', authenticateToken, express.static(uploadsPath, {
    setHeaders: (res, filePath) => {
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
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }));

  // 业务路由
  app.use('/api/auth', authRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/ai-chat', aiChatRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/contacts', contactRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/ops', opsRoutes);
  app.use('/internal/recommendation', recommendationInternalRoutes);
  app.use('/internal/graph-kernel', graphKernelInternalRoutes);
  app.use('/api', uploadRoutes);
  app.use('/api/keys', keyRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/realtime', realtimeRoutes);
  app.use('/api/space', authenticateToken, spaceRoutes);
  app.use('/api/news', authenticateToken, newsRoutes);
  app.use('/api/ml', authenticateToken, mlProxyRoutes);
  app.use('/api/analytics', authenticateToken, analyticsRoutes);
  app.use('/api/features', authenticateToken, featureRoutes);
  app.use('/api/push', pushRoutes);

  // API 根路由
  app.get('/api', (_req, res) => {
    res.json({
      message: 'Telegram Clone API',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        ready: '/ready',
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

  // 404 处理
  app.use(notFoundHandler);
}
