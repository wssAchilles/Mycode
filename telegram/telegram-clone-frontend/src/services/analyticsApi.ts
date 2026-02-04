/**
 * 分析 API 服务
 * 对接后端监控和分析接口
 */

import apiClient from './apiClient';
import type {
    DashboardData,
    ExperimentConfig,
    ExperimentMetrics,
    TimeSeriesData,
    UserBehaviorEvent,
} from '../types/analytics';

// 模拟数据生成器 (开发阶段使用)
const generateMockDashboardData = (): DashboardData => {
    const now = new Date();

    return {
        overview: {
            totalUsers: { value: 15420, change: 12.5, trend: 'up' },
            dau: { value: 3256, change: 8.2, trend: 'up' },
            totalPosts: { value: 42891, change: 15.3, trend: 'up' },
            recommendationsServed: { value: 892341, change: 23.1, trend: 'up' },
        },
        recommendation: {
            requestMetrics: {
                totalRequests: 892341,
                successRate: 99.7,
                errorRate: 0.3,
                latency: {
                    p50: 45,
                    p90: 120,
                    p99: 280,
                    avg: 62,
                    max: 1520,
                    min: 12,
                },
            },
            latencyTrend: generateLatencyTrend(),
            recallDistribution: [
                { source: 'embedding', label: 'Embedding 召回', count: 445000, percentage: 49.8, color: '#3390ec' },
                { source: 'graph', label: 'Graph 召回', count: 267500, percentage: 29.9, color: '#8774e1' },
                { source: 'trending', label: '热门趋势', count: 89200, percentage: 10.0, color: '#4fae4e' },
                { source: 'following', label: '关注用户', count: 71400, percentage: 8.0, color: '#f5a623' },
                { source: 'random', label: '随机探索', count: 19241, percentage: 2.3, color: '#707579' },
            ],
        },
        experiments: [
            {
                experimentId: 'exp_phoenix_v2',
                experimentName: 'Phoenix V2 排序模型',
                status: 'running',
                startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
                buckets: [
                    { bucketId: 'control', bucketName: '对照组 (V1)', userCount: 1628, impressions: 45000, clicks: 2700, ctr: 6.0, engagementRate: 12.3, conversionRate: 2.1, avgSessionDuration: 185 },
                    { bucketId: 'treatment', bucketName: '实验组 (V2)', userCount: 1628, impressions: 45200, clicks: 3160, ctr: 7.0, engagementRate: 14.8, conversionRate: 2.8, avgSessionDuration: 210 },
                ],
            },
            {
                experimentId: 'exp_graph_recall',
                experimentName: 'Graph 召回权重优化',
                status: 'running',
                startDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
                buckets: [
                    { bucketId: 'low', bucketName: '低权重 (0.2)', userCount: 1085, impressions: 30000, clicks: 1650, ctr: 5.5, engagementRate: 10.2, conversionRate: 1.8, avgSessionDuration: 165 },
                    { bucketId: 'medium', bucketName: '中权重 (0.4)', userCount: 1085, impressions: 30200, clicks: 1965, ctr: 6.5, engagementRate: 12.1, conversionRate: 2.2, avgSessionDuration: 180 },
                    { bucketId: 'high', bucketName: '高权重 (0.6)', userCount: 1086, impressions: 30100, clicks: 2106, ctr: 7.0, engagementRate: 13.5, conversionRate: 2.5, avgSessionDuration: 195 },
                ],
            },
        ],
        safety: {
            totalChecked: 42891,
            flaggedCount: 215,
            flagRate: 0.5,
            byLevel: { high: 12, medium: 48, low: 155, safe: 42676 },
            byType: { spam: 89, nsfw: 45, hate: 28, violence: 15, other: 38 },
        },
        updatedAt: now,
    };
};

// 生成延迟趋势数据
const generateLatencyTrend = (): TimeSeriesData[] => {
    const now = Date.now();
    const points = 24;

    const generateSeries = (baseValue: number, variance: number, label: string, color: string) => ({
        label,
        color,
        data: Array.from({ length: points }, (_, i) => ({
            timestamp: new Date(now - (points - i) * 60 * 60 * 1000),
            value: baseValue + (Math.random() - 0.5) * variance,
        })),
    });

    return [
        generateSeries(280, 80, 'P99', '#e53935'),
        generateSeries(120, 40, 'P90', '#f5a623'),
        generateSeries(45, 15, 'P50', '#4fae4e'),
    ];
};

export const analyticsAPI = {
    /**
     * 获取 Dashboard 概览数据
     */
    getDashboard: async (): Promise<DashboardData> => {
        try {
            const response = await apiClient.get<DashboardData>('/api/analytics/dashboard');
            return response.data;
        } catch {
            // 开发阶段返回模拟数据
            console.warn('[Analytics] Using mock dashboard data');
            return generateMockDashboardData();
        }
    },

    /**
     * 获取实验列表
     */
    getExperiments: async (): Promise<ExperimentConfig[]> => {
        try {
            const response = await apiClient.get<{ experiments: ExperimentConfig[] }>('/api/analytics/experiments');
            return response.data.experiments;
        } catch {
            // 模拟数据
            return [
                {
                    id: 'exp_phoenix_v2',
                    name: 'Phoenix V2 排序模型',
                    description: '测试新版 Phoenix 排序模型的效果',
                    status: 'running',
                    trafficPercentage: 50,
                    buckets: [
                        { id: 'control', name: '对照组', weight: 50, config: { modelVersion: 'v1' } },
                        { id: 'treatment', name: '实验组', weight: 50, config: { modelVersion: 'v2' } },
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: 'exp_graph_recall',
                    name: 'Graph 召回权重优化',
                    description: '测试不同 Graph 召回权重对 CTR 的影响',
                    status: 'running',
                    trafficPercentage: 30,
                    buckets: [
                        { id: 'low', name: '低权重', weight: 33, config: { graphWeight: 0.2 } },
                        { id: 'medium', name: '中权重', weight: 34, config: { graphWeight: 0.4 } },
                        { id: 'high', name: '高权重', weight: 33, config: { graphWeight: 0.6 } },
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];
        }
    },

    /**
     * 更新实验配置
     */
    updateExperiment: async (id: string, updates: Partial<ExperimentConfig>): Promise<ExperimentConfig> => {
        const response = await apiClient.put<ExperimentConfig>(`/api/analytics/experiments/${id}`, updates);
        return response.data;
    },

    /**
     * 创建新实验
     */
    createExperiment: async (config: Omit<ExperimentConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ExperimentConfig> => {
        const response = await apiClient.post<ExperimentConfig>('/api/analytics/experiments', config);
        return response.data;
    },

    /**
     * 暂停/恢复实验
     */
    toggleExperiment: async (id: string, action: 'pause' | 'resume'): Promise<void> => {
        await apiClient.post(`/api/analytics/experiments/${id}/${action}`);
    },

    /**
     * 获取实验详细指标
     */
    getExperimentMetrics: async (id: string, days: number = 7): Promise<ExperimentMetrics> => {
        const response = await apiClient.get<ExperimentMetrics>(`/api/analytics/experiments/${id}/metrics?days=${days}`);
        return response.data;
    },

    /**
     * 上报用户行为事件
     */
    trackEvent: async (event: UserBehaviorEvent): Promise<void> => {
        try {
            await apiClient.post('/api/analytics/events', event);
        } catch (error) {
            // 静默失败，不影响用户体验
            console.warn('[Analytics] Failed to track event:', error);
        }
    },

    /**
     * 批量上报事件
     */
    trackBatch: async (events: UserBehaviorEvent[]): Promise<void> => {
        if (events.length === 0) return;
        try {
            await apiClient.post('/api/analytics/events/batch', { events });
        } catch (error) {
            console.warn('[Analytics] Failed to track batch events:', error);
        }
    },
};

export default analyticsAPI;
