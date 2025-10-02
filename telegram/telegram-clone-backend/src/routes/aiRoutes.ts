import express from 'express';
import { getAiResponse, checkAiHealth } from '../controllers/aiController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// AI聊天端点 - POST /api/ai/chat
// 需要用户认证
router.post('/chat', authenticateToken, getAiResponse);

// AI服务健康检查端点 - GET /api/ai/health
// 不需要认证，用于系统监控
router.get('/health', checkAiHealth);

// AI服务信息端点 - GET /api/ai/info
// 需要用户认证，返回AI服务基本信息
router.get('/info', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      name: 'Azure AI Foundry Chat Service',
      version: '1.0.0',
      features: [
        'multi-turn-conversation',
        'context-awareness',
        'chinese-support'
      ],
      limits: {
        max_tokens: 1000,
        max_history: 20,
        timeout: 30000
      },
      timestamp: new Date().toISOString()
    }
  });
});

export default router;
