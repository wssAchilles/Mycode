/**
 * Analytics API 路由
 * 提供监控数据、实验管理、事件收集接口
 */

import { Router, Request, Response } from 'express';
import { getEventStreamService } from '../services/eventStreamService';
import { getExperimentService } from '../services/experiment';

const router = Router();

// ===== Dashboard 数据 =====
router.get('/dashboard', async (_req: Request, res: Response) => {
    try {
        const eventStream = getEventStreamService();
        const stats = await eventStream.getStats();

        // 构建 Dashboard 数据 (简化版，实际应从多个数据源聚合)
        const dashboardData = {
            overview: {
                totalUsers: { value: 15420, change: 12.5, trend: 'up' as const },
                dau: { value: 3256, change: 8.2, trend: 'up' as const },
                totalPosts: { value: 42891, change: 15.3, trend: 'up' as const },
                recommendationsServed: { value: stats.totalEvents, change: 23.1, trend: 'up' as const },
            },
            recommendation: {
                requestMetrics: {
                    totalRequests: stats.totalEvents,
                    successRate: 99.7,
                    errorRate: 0.3,
                    latency: { p50: 45, p90: 120, p99: 280, avg: 62, max: 1520, min: 12 },
                },
                latencyTrend: [],
                recallDistribution: [
                    { source: 'embedding', label: 'Embedding 召回', count: 44500, percentage: 49.8, color: '#3390ec' },
                    { source: 'graph', label: 'Graph 召回', count: 26750, percentage: 29.9, color: '#8774e1' },
                    { source: 'trending', label: '热门趋势', count: 8920, percentage: 10.0, color: '#4fae4e' },
                    { source: 'following', label: '关注用户', count: 7140, percentage: 8.0, color: '#f5a623' },
                    { source: 'random', label: '随机探索', count: 1924, percentage: 2.3, color: '#707579' },
                ],
            },
            experiments: [],
            safety: {
                totalChecked: 42891,
                flaggedCount: 215,
                flagRate: 0.5,
                byLevel: { high: 12, medium: 48, low: 155, safe: 42676 },
                byType: { spam: 89, nsfw: 45, hate: 28, violence: 15, other: 38 },
            },
            updatedAt: new Date(),
        };

        res.json(dashboardData);
    } catch (error: any) {
        console.error('[Analytics] Dashboard error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 实验列表 =====
router.get('/experiments', async (_req: Request, res: Response) => {
    try {
        const experimentService = getExperimentService();
        const experiments = await experimentService.listExperiments();

        res.json({ experiments });
    } catch (error: any) {
        console.error('[Analytics] Get experiments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 更新实验 =====
router.put('/experiments/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const experimentService = getExperimentService();
        const updated = await experimentService.updateExperiment(id, updates);

        if (!updated) {
            return res.status(404).json({ error: 'Experiment not found' });
        }

        res.json(updated);
    } catch (error: any) {
        console.error('[Analytics] Update experiment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 暂停/恢复实验 =====
router.post('/experiments/:id/:action', async (req: Request, res: Response) => {
    try {
        const { id, action } = req.params;

        if (action !== 'pause' && action !== 'resume') {
            return res.status(400).json({ error: 'Invalid action' });
        }

        const experimentService = getExperimentService();
        if (action === 'pause') {
            await experimentService.pauseExperiment(id);
        } else {
            await experimentService.resumeExperiment(id);
        }

        res.json({ success: true });
    } catch (error: any) {
        console.error('[Analytics] Toggle experiment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 收集单个事件 =====
router.post('/events', async (req: Request, res: Response) => {
    try {
        const event = req.body;

        // 验证必填字段
        if (!event.type || !event.postId || !event.userId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const eventStream = getEventStreamService();
        await eventStream.logEvent({
            ...event,
            timestamp: new Date(event.timestamp || Date.now()),
        });

        res.status(201).json({ success: true });
    } catch (error: any) {
        console.error('[Analytics] Log event error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 批量收集事件 =====
router.post('/events/batch', async (req: Request, res: Response) => {
    try {
        const { events } = req.body;

        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'Invalid events array' });
        }

        const eventStream = getEventStreamService();
        await eventStream.logBatch(
            events.map((e: any) => ({
                ...e,
                timestamp: new Date(e.timestamp || Date.now()),
            }))
        );

        res.status(201).json({ success: true, count: events.length });
    } catch (error: any) {
        console.error('[Analytics] Log batch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 事件统计 =====
router.get('/events/stats', async (_req: Request, res: Response) => {
    try {
        const eventStream = getEventStreamService();
        const stats = await eventStream.getStats();

        res.json(stats);
    } catch (error: any) {
        console.error('[Analytics] Get stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 导出训练数据 =====
router.get('/events/export', async (req: Request, res: Response) => {
    try {
        const { start, end, limit = '10000' } = req.query;

        const startTime = start ? new Date(start as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const endTime = end ? new Date(end as string) : new Date();

        const eventStream = getEventStreamService();
        const aggregated = await eventStream.exportForTraining(
            startTime,
            endTime,
            parseInt(limit as string, 10)
        );

        res.json({
            startTime,
            endTime,
            count: aggregated.length,
            data: aggregated,
        });
    } catch (error: any) {
        console.error('[Analytics] Export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 模型热更新通知 =====
router.post('/model/reload', async (req: Request, res: Response) => {
    try {
        const { path: modelPath } = req.body;

        console.log(`[Analytics] Model reload requested: ${modelPath}`);

        // 通知 ML 服务重新加载模型
        // 由于 ML 服务是独立的 Python 进程，这里我们:
        // 1. 记录重新加载请求
        // 2. 通知前端刷新 (通过 WebSocket 或轮询)
        // 3. 实际的模型重新加载由 ML 服务在下次请求时自动检测

        // 记录到事件流
        const eventStream = getEventStreamService();
        await eventStream.logEvent({
            type: 'click' as any, // 使用已有类型，实际应扩展类型
            postId: 'system:model_reload',
            userId: 'system',
            timestamp: new Date(),
            metadata: {
                source: 'auto_retrain',
                experimentId: modelPath,
            }
        });

        res.json({
            success: true,
            message: 'Model reload notification received',
            modelPath,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[Analytics] Model reload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== 获取模型版本信息 =====
router.get('/model/info', async (_req: Request, res: Response) => {
    try {
        // 返回当前模型信息 (实际应从配置或数据库读取)
        res.json({
            currentVersion: 'phoenix_epoch_3',
            lastUpdated: new Date().toISOString(),
            status: 'active',
            metrics: {
                accuracy: 0.85,
                latencyP50: 45,
                latencyP99: 280
            }
        });
    } catch (error: any) {
        console.error('[Analytics] Model info error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
