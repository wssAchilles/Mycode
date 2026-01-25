/**
 * Feature Store API 路由
 * 
 * 提供 X Algorithm 特征存储的 HTTP API
 * 
 * 端点:
 * - POST /api/features/user/compute - 计算用户特征
 * - POST /api/features/batch/compute - 批量计算特征
 * - POST /api/simclusters/embed - 计算 SimClusters 嵌入
 * - POST /api/simclusters/similar - 查找相似用户
 * - POST /api/realgraph/score - 获取社交分数
 * - POST /api/realgraph/top - 获取 Top 亲密关系
 * - POST /api/signals/log - 记录用户信号
 */

import { Router, Request, Response } from 'express';
import { FeatureStore } from '../services/recommendation/featureStore';
import { simClustersService } from '../services/recommendation/SimClustersService';
import { realGraphService } from '../services/recommendation/RealGraphService';
import { userSignalService } from '../services/recommendation/UserSignalService';
import { SignalType, ProductSurface, TargetType } from '../models/UserSignal';
import { InteractionType } from '../models/RealGraphEdge';

const router = Router();

// ========== 用户特征 API ==========

/**
 * POST /api/features/user/compute
 * 计算单个用户的完整特征
 */
router.post('/user/compute', async (req: Request, res: Response) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        // 并行获取各类特征
        const [embedding, signalFeatures, topConnections] = await Promise.all([
            FeatureStore.getUserEmbedding(userId),
            FeatureStore.getUserSignalFeatures(userId),
            FeatureStore.getTopConnections(userId, 20),
        ]);

        return res.json({
            userId,
            embedding: embedding ? {
                interestedInClusters: embedding.interestedInClusters,
                knownForCluster: embedding.knownForCluster,
                twoTowerEmbedding: embedding.twoTowerEmbedding,
                version: embedding.version,
                computedAt: embedding.computedAt,
            } : null,
            signals: signalFeatures,
            topConnections: topConnections.map(e => ({
                targetUserId: e.targetUserId,
                score: e.decayedSum,
            })),
        });
    } catch (error) {
        console.error('[FeatureAPI] Error computing user features:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/features/batch/compute
 * 批量计算用户特征
 */
router.post('/batch/compute', async (req: Request, res: Response) => {
    try {
        const { userIds } = req.body;

        if (!userIds || !Array.isArray(userIds)) {
            return res.status(400).json({ error: 'userIds array is required' });
        }

        if (userIds.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 users per request' });
        }

        // 批量获取嵌入
        const embeddings = await FeatureStore.getUserEmbeddingsBatch(userIds);

        const results: Record<string, unknown> = {};
        for (const userId of userIds) {
            const embedding = embeddings.get(userId);
            results[userId] = embedding ? {
                hasEmbedding: true,
                clusterCount: embedding.interestedInClusters?.length || 0,
                hasTwoTower: !!embedding.twoTowerEmbedding,
            } : {
                hasEmbedding: false,
            };
        }

        return res.json({ results });
    } catch (error) {
        console.error('[FeatureAPI] Error in batch compute:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== SimClusters API ==========

/**
 * POST /api/simclusters/embed
 * 计算或获取用户 SimClusters 嵌入
 */
router.post('/simclusters/embed', async (req: Request, res: Response) => {
    try {
        const { userId, recompute } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        let embedding;

        if (recompute) {
            // 强制重新计算
            embedding = await FeatureStore.computeUserEmbedding(userId);
        } else {
            // 优先从缓存获取
            embedding = await FeatureStore.getUserEmbedding(userId);

            if (!embedding) {
                // 缓存不存在时计算
                embedding = await FeatureStore.computeUserEmbedding(userId);
            }
        }

        if (!embedding) {
            return res.status(404).json({ error: 'Could not compute embedding' });
        }

        return res.json({
            userId,
            interestedInClusters: embedding.interestedInClusters,
            knownForCluster: embedding.knownForCluster,
            knownForScore: embedding.knownForScore,
            version: embedding.version,
            computedAt: embedding.computedAt,
        });
    } catch (error) {
        console.error('[FeatureAPI] Error in simclusters embed:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/simclusters/similar
 * 查找相似用户
 */
router.post('/simclusters/similar', async (req: Request, res: Response) => {
    try {
        const { userId, limit = 20 } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const similarUsers = await FeatureStore.findSimilarUsers(userId, Math.min(limit, 100));

        return res.json({
            userId,
            similarUsers,
        });
    } catch (error) {
        console.error('[FeatureAPI] Error finding similar users:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/simclusters/similarity
 * 计算两个用户的相似度
 */
router.post('/simclusters/similarity', async (req: Request, res: Response) => {
    try {
        const { userId1, userId2 } = req.body;

        if (!userId1 || !userId2) {
            return res.status(400).json({ error: 'userId1 and userId2 are required' });
        }

        const similarity = await FeatureStore.getUserSimilarity(userId1, userId2);

        return res.json({
            userId1,
            userId2,
            similarity,
        });
    } catch (error) {
        console.error('[FeatureAPI] Error computing similarity:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== RealGraph API ==========

/**
 * POST /api/realgraph/score
 * 获取两个用户之间的社交分数
 */
router.post('/realgraph/score', async (req: Request, res: Response) => {
    try {
        const { sourceUserId, targetUserId, mutual } = req.body;

        if (!sourceUserId || !targetUserId) {
            return res.status(400).json({ error: 'sourceUserId and targetUserId are required' });
        }

        let score: number;

        if (mutual) {
            // 获取双向分数
            const [s1, s2] = await Promise.all([
                FeatureStore.getEdgeScore(sourceUserId, targetUserId),
                FeatureStore.getEdgeScore(targetUserId, sourceUserId),
            ]);
            score = s1 + s2;
        } else {
            // 获取单向分数
            score = await FeatureStore.getEdgeScore(sourceUserId, targetUserId);
        }

        return res.json({
            sourceUserId,
            targetUserId,
            score,
            mutual: !!mutual,
        });
    } catch (error) {
        console.error('[FeatureAPI] Error getting edge score:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/realgraph/batch
 * 批量获取边分数
 */
router.post('/realgraph/batch', async (req: Request, res: Response) => {
    try {
        const { pairs } = req.body;

        if (!pairs || !Array.isArray(pairs)) {
            return res.status(400).json({ error: 'pairs array is required' });
        }

        if (pairs.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 pairs per request' });
        }

        const scores = await FeatureStore.getEdgeScoresBatch(pairs);

        const results: Record<string, number> = {};
        for (const [key, score] of scores) {
            results[key] = score;
        }

        return res.json({ results });
    } catch (error) {
        console.error('[FeatureAPI] Error in batch edge scores:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/realgraph/top
 * 获取用户 Top 亲密关系
 */
router.post('/realgraph/top', async (req: Request, res: Response) => {
    try {
        const { userId, limit = 50 } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const connections = await FeatureStore.getTopConnections(userId, Math.min(limit, 100));

        return res.json({
            userId,
            connections: connections.map(e => ({
                targetUserId: e.targetUserId,
                score: e.decayedSum,
                lastInteractionAt: e.lastInteractionAt,
            })),
        });
    } catch (error) {
        console.error('[FeatureAPI] Error getting top connections:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/realgraph/predict
 * 预测交互概率
 */
router.post('/realgraph/predict', async (req: Request, res: Response) => {
    try {
        const { sourceUserId, targetUserId } = req.body;

        if (!sourceUserId || !targetUserId) {
            return res.status(400).json({ error: 'sourceUserId and targetUserId are required' });
        }

        const probability = await FeatureStore.predictInteraction(sourceUserId, targetUserId);

        return res.json({
            sourceUserId,
            targetUserId,
            interactionProbability: probability,
        });
    } catch (error) {
        console.error('[FeatureAPI] Error predicting interaction:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/realgraph/record
 * 记录交互 (内部使用)
 */
router.post('/realgraph/record', async (req: Request, res: Response) => {
    try {
        const { sourceUserId, targetUserId, interactionType, value } = req.body;

        if (!sourceUserId || !targetUserId || !interactionType) {
            return res.status(400).json({
                error: 'sourceUserId, targetUserId, and interactionType are required'
            });
        }

        // 验证交互类型
        if (!Object.values(InteractionType).includes(interactionType)) {
            return res.status(400).json({ error: 'Invalid interactionType' });
        }

        await FeatureStore.recordInteraction(
            sourceUserId,
            targetUserId,
            interactionType as InteractionType,
            value
        );

        return res.json({ success: true });
    } catch (error) {
        console.error('[FeatureAPI] Error recording interaction:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== 信号 API ==========

/**
 * POST /api/signals/log
 * 记录用户信号
 */
router.post('/signals/log', async (req: Request, res: Response) => {
    try {
        const {
            userId,
            signalType,
            targetId,
            targetType,
            targetAuthorId,
            productSurface,
            metadata
        } = req.body;

        if (!userId || !signalType || !targetId || !targetType || !productSurface) {
            return res.status(400).json({
                error: 'userId, signalType, targetId, targetType, and productSurface are required'
            });
        }

        // 验证枚举值
        if (!Object.values(SignalType).includes(signalType)) {
            return res.status(400).json({ error: 'Invalid signalType' });
        }
        if (!Object.values(TargetType).includes(targetType)) {
            return res.status(400).json({ error: 'Invalid targetType' });
        }
        if (!Object.values(ProductSurface).includes(productSurface)) {
            return res.status(400).json({ error: 'Invalid productSurface' });
        }

        await FeatureStore.logSignal({
            userId,
            signalType: signalType as SignalType,
            targetId,
            targetType: targetType as TargetType,
            targetAuthorId,
            productSurface: productSurface as ProductSurface,
            metadata,
        });

        return res.json({ success: true });
    } catch (error) {
        console.error('[FeatureAPI] Error logging signal:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/signals/batch
 * 批量记录信号
 */
router.post('/signals/batch', async (req: Request, res: Response) => {
    try {
        const { signals } = req.body;

        if (!signals || !Array.isArray(signals)) {
            return res.status(400).json({ error: 'signals array is required' });
        }

        if (signals.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 signals per request' });
        }

        await FeatureStore.logSignalsBatch(signals);

        return res.json({ success: true, logged: signals.length });
    } catch (error) {
        console.error('[FeatureAPI] Error in batch signal log:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/signals/features
 * 获取用户信号特征
 */
router.post('/signals/features', async (req: Request, res: Response) => {
    try {
        const { userId, days = 7 } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const features = await FeatureStore.getUserSignalFeatures(userId, Math.min(days, 30));

        return res.json({
            userId,
            days,
            features,
        });
    } catch (error) {
        console.error('[FeatureAPI] Error getting signal features:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== 缓存管理 API ==========

/**
 * POST /api/cache/clear
 * 清除缓存 (管理接口)
 */
router.post('/cache/clear', async (req: Request, res: Response) => {
    try {
        FeatureStore.clearCache();
        return res.json({ success: true, message: 'L1 cache cleared' });
    } catch (error) {
        console.error('[FeatureAPI] Error clearing cache:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/cache/stats
 * 获取缓存统计
 */
router.get('/cache/stats', async (req: Request, res: Response) => {
    try {
        const stats = FeatureStore.getCacheStats();
        return res.json(stats);
    } catch (error) {
        console.error('[FeatureAPI] Error getting cache stats:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
