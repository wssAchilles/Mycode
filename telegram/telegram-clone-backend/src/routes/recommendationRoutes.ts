/**
 * 推荐系统 API 路由
 */

import { Router, Request, Response } from 'express';
import { recommendationService } from '../services/recommendationService';
import { TargetType, InteractionType } from '../models/UserInteraction';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// 所有路由都需要认证
router.use(authMiddleware);

/**
 * GET /api/recommendations
 * 获取推荐列表（联系人 + 群组）
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const targetType = req.query.type as TargetType | undefined;
    
    const recommendations = await recommendationService.getRecommendations({
      userId,
      targetType,
      limit,
    });
    
    res.json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations',
    });
  }
});

/**
 * GET /api/recommendations/chats
 * 获取排序后的聊天列表
 */
router.get('/chats', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const sortedChats = await recommendationService.getSortedChatList(userId, limit);
    
    res.json({
      success: true,
      data: {
        chats: sortedChats,
        count: sortedChats.length,
      },
    });
  } catch (error) {
    console.error('Error getting sorted chats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sorted chats',
    });
  }
});

/**
 * GET /api/recommendations/groups
 * 获取群组推荐
 */
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const groupRecommendations = await recommendationService.getGroupRecommendations(
      userId,
      limit
    );
    
    res.json({
      success: true,
      data: {
        groups: groupRecommendations,
        count: groupRecommendations.length,
      },
    });
  } catch (error) {
    console.error('Error getting group recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get group recommendations',
    });
  }
});

/**
 * POST /api/recommendations/interactions
 * 记录用户互动（用于训练推荐系统）
 */
router.post('/interactions', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { targetId, targetType, interactionType, metadata } = req.body;
    
    // 验证必需字段
    if (!targetId || !targetType || !interactionType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: targetId, targetType, interactionType',
      });
    }
    
    // 验证枚举值
    if (!Object.values(TargetType).includes(targetType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid targetType. Must be one of: ${Object.values(TargetType).join(', ')}`,
      });
    }
    
    if (!Object.values(InteractionType).includes(interactionType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid interactionType. Must be one of: ${Object.values(InteractionType).join(', ')}`,
      });
    }
    
    await recommendationService.recordInteraction(
      userId,
      targetId,
      targetType,
      interactionType,
      metadata
    );
    
    res.json({
      success: true,
      message: 'Interaction recorded successfully',
    });
  } catch (error) {
    console.error('Error recording interaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record interaction',
    });
  }
});

/**
 * POST /api/recommendations/interactions/batch
 * 批量记录用户互动
 */
router.post('/interactions/batch', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { interactions } = req.body;
    
    if (!Array.isArray(interactions) || interactions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'interactions must be a non-empty array',
      });
    }
    
    // 限制批量大小
    const maxBatchSize = 100;
    const limitedInteractions = interactions.slice(0, maxBatchSize);
    
    // 并行记录所有互动
    await Promise.all(
      limitedInteractions.map(interaction =>
        recommendationService.recordInteraction(
          userId,
          interaction.targetId,
          interaction.targetType,
          interaction.interactionType,
          interaction.metadata
        ).catch(err => {
          console.error('Failed to record interaction:', err);
          return null;
        })
      )
    );
    
    res.json({
      success: true,
      message: `Recorded ${limitedInteractions.length} interactions`,
    });
  } catch (error) {
    console.error('Error recording batch interactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record batch interactions',
    });
  }
});

/**
 * GET /api/recommendations/debug
 * 调试端点：获取用户的推荐评分详情
 */
router.get('/debug', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const targetId = req.query.targetId as string;
    
    if (!targetId) {
      return res.status(400).json({
        success: false,
        error: 'targetId is required',
      });
    }
    
    // 获取完整的推荐数据
    const recommendations = await recommendationService.getRecommendations({
      userId,
      limit: 200, // 获取更多以确保目标在其中
    });
    
    // 查找特定目标的评分详情
    const targetCandidate = recommendations.candidates.find(c => c.id === targetId);
    
    if (!targetCandidate) {
      return res.json({
        success: true,
        data: {
          found: false,
          message: 'Target not found in recommendations',
        },
      });
    }
    
    res.json({
      success: true,
      data: {
        found: true,
        candidate: targetCandidate,
        scoreBreakdown: {
          ...targetCandidate.scores,
          finalScore: targetCandidate.finalScore,
        },
      },
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get debug info',
    });
  }
});

export default router;
