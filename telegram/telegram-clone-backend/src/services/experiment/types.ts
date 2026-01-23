/**
 * A/B 实验框架 - 类型定义
 * 复刻业界最佳实践的实验分流系统
 */

/**
 * 实验状态
 */
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

/**
 * 分流类型
 */
export type BucketingType = 
    | 'user'      // 用户级分流 (同一用户始终在同一组)
    | 'request'   // 请求级分流 (每次请求独立分流)
    | 'session';  // 会话级分流

/**
 * 实验桶配置
 */
export interface ExperimentBucket {
    /** 桶名称 (如 control, treatment_a, treatment_b) */
    name: string;
    /** 权重 (0-100, 所有桶加起来应等于 100) */
    weight: number;
    /** 该桶的配置覆盖 */
    config: Record<string, any>;
    /** 描述 */
    description?: string;
}

/**
 * 目标受众条件
 */
export interface TargetAudience {
    /** 最小关注者数 */
    minFollowers?: number;
    /** 最大关注者数 */
    maxFollowers?: number;
    /** 注册天数范围 */
    accountAgeDays?: { min?: number; max?: number };
    /** 用户 ID 白名单 (用于内部测试) */
    userIdWhitelist?: string[];
    /** 用户 ID 黑名单 (排除特定用户) */
    userIdBlacklist?: string[];
    /** 平台 (ios, android, web) */
    platforms?: string[];
    /** 地区 */
    regions?: string[];
    /** 新用户专属 */
    newUsersOnly?: boolean;
}

/**
 * 实验配置
 */
export interface Experiment {
    /** 实验 ID */
    id: string;
    /** 实验名称 */
    name: string;
    /** 描述 */
    description?: string;
    /** 状态 */
    status: ExperimentStatus;
    /** 分流类型 */
    bucketingType: BucketingType;
    /** 实验桶 */
    buckets: ExperimentBucket[];
    /** 目标受众 */
    targetAudience?: TargetAudience;
    /** 流量百分比 (0-100, 剩余流量使用默认行为) */
    trafficPercent: number;
    /** 开始时间 */
    startDate?: Date;
    /** 结束时间 */
    endDate?: Date;
    /** 创建时间 */
    createdAt: Date;
    /** 更新时间 */
    updatedAt: Date;
    /** 创建者 */
    createdBy?: string;
    /** 关联的指标 */
    metrics?: string[];
    /** 标签 */
    tags?: string[];
}

/**
 * 实验分配结果
 */
export interface ExperimentAssignment {
    /** 实验 ID */
    experimentId: string;
    /** 实验名称 */
    experimentName: string;
    /** 分配的桶名称 */
    bucket: string;
    /** 该桶的配置 */
    config: Record<string, any>;
    /** 是否在实验流量内 */
    inExperiment: boolean;
}

/**
 * 用户实验上下文 (用于 Pipeline)
 */
export interface ExperimentContext {
    /** 用户 ID */
    userId: string;
    /** 所有激活的实验分配 */
    assignments: ExperimentAssignment[];
    /** 快速获取配置值 */
    getConfig<T>(experimentId: string, key: string, defaultValue: T): T;
    /** 检查是否在某个实验的某个桶中 */
    isInBucket(experimentId: string, bucket: string): boolean;
}

/**
 * 实验事件 (用于埋点)
 */
export interface ExperimentEvent {
    /** 事件类型 */
    eventType: 'impression' | 'click' | 'engagement' | 'conversion';
    /** 用户 ID */
    userId: string;
    /** 实验 ID */
    experimentId: string;
    /** 桶名称 */
    bucket: string;
    /** 时间戳 */
    timestamp: Date;
    /** 附加数据 */
    metadata?: Record<string, any>;
}

/**
 * 实验指标汇总
 */
export interface ExperimentMetrics {
    experimentId: string;
    bucket: string;
    /** 唯一用户数 */
    uniqueUsers: number;
    /** 曝光数 */
    impressions: number;
    /** 点击数 */
    clicks: number;
    /** 点击率 */
    ctr: number;
    /** 互动率 (like + reply + repost) */
    engagementRate: number;
    /** 平均会话时长 */
    avgSessionDuration?: number;
    /** 置信区间 */
    confidenceInterval?: { lower: number; upper: number };
    /** p-value */
    pValue?: number;
}
