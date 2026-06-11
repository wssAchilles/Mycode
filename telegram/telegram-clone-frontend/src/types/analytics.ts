/**
 * 分析和监控相关类型定义
 */

// ===== 指标类型 =====
export interface MetricValue {
    value: number;
    change?: number; // 相比上一周期的变化百分比
    trend?: 'up' | 'down' | 'stable';
    timestamp?: Date;
}

export interface LatencyMetrics {
    p50: number;
    p90: number;
    p99: number;
    avg: number;
    max: number;
    min: number;
}

export interface RequestMetrics {
    totalRequests: number;
    successRate: number;
    errorRate: number;
    latency: LatencyMetrics;
}

// ===== 实验指标 =====
export interface ExperimentMetrics {
    experimentId: string;
    experimentName: string;
    buckets: ExperimentBucketMetrics[];
    startDate: Date;
    endDate?: Date;
    status: 'running' | 'paused' | 'completed';
}

export interface ExperimentBucketMetrics {
    bucketId: string;
    bucketName: string;
    userCount: number;
    impressions: number;
    clicks: number;
    ctr: number; // Click-through rate
    engagementRate: number;
    conversionRate: number;
    avgSessionDuration: number;
}

// ===== 召回源分布 =====
export interface RecallSourceDistribution {
    source: string;
    label: string;
    count: number;
    percentage: number;
    color: string;
}

// ===== 安全过滤指标 =====
export interface SafetyMetrics {
    totalChecked: number;
    flaggedCount: number;
    flagRate: number;
    byLevel: {
        high: number;
        medium: number;
        low: number;
        safe: number;
    };
    byType: {
        spam: number;
        nsfw: number;
        hate: number;
        violence: number;
        other: number;
    };
}

// ===== 时间序列数据 =====
export interface TimeSeriesPoint {
    timestamp: Date;
    value: number;
}

export interface TimeSeriesData {
    label: string;
    color: string;
    data: TimeSeriesPoint[];
}

// ===== Dashboard 数据 =====
export interface DashboardData {
    overview: {
        totalUsers: MetricValue;
        dau: MetricValue; // Daily Active Users
        totalPosts: MetricValue;
        recommendationsServed: MetricValue;
    };
    recommendation: {
        requestMetrics: RequestMetrics;
        latencyTrend: TimeSeriesData[];
        recallDistribution: RecallSourceDistribution[];
    };
    experiments: ExperimentMetrics[];
    safety: SafetyMetrics;
    updatedAt: Date;
}

// ===== 管理面板类型 =====
export interface ExperimentConfig {
    id: string;
    name: string;
    description?: string;
    status: 'draft' | 'running' | 'paused' | 'completed';
    trafficPercentage: number; // 0-100
    buckets: {
        id: string;
        name: string;
        weight: number;
        config: Record<string, unknown>;
    }[];
    targetAudience?: {
        minVersion?: string;
        countries?: string[];
        userSegments?: string[];
    };
    startDate?: Date;
    endDate?: Date;
    createdAt: Date;
    updatedAt: Date;
}

// ===== 用户行为事件 =====
export type UserBehaviorEventType =
    | 'impression' | 'click' | 'like' | 'unlike' | 'reply' | 'repost' | 'unrepost'
    | 'quote' | 'share' | 'scroll' | 'dwell' | 'dismiss' | 'hide' | 'report'
    | 'block' | 'mute' | 'follow' | 'unfollow' | 'bookmark' | 'search'
    | 'profile_click' | 'search_query' | 'hashtag_click' | 'open_link';

export interface UserBehaviorEvent {
    type: UserBehaviorEventType;
    postId: string;
    userId: string;
    timestamp: Date;
    metadata?: {
        source?: string; // 召回源
        position?: number; // 在 feed 中的位置
        requestId?: string; // 推荐请求 ID
        recommendationScore?: number; // 推荐分数
        selectionPool?: string; // selector 分桶
        selectionReason?: string; // selector 选择原因
        experimentId?: string;
        bucketId?: string;
        dwellTime?: number; // 停留时间 (ms)
        scrollDepth?: number; // 滚动深度 (0-1)
        reason?: string; // 举报/隐藏原因
        authorId?: string; // 相关作者 ID
        searchQuery?: string; // 搜索词
        hashtag?: string; // 话题标签
        url?: string; // 外链目标
        targetType?: string; // 推荐目标类型
        productSurface?: string; // 产品表面
    };
}
