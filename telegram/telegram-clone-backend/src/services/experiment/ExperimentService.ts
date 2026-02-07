/**
 * A/B 实验服务 - 核心实现
 * 提供实验配置管理、用户分流、配置获取等功能
 */

import crypto from 'crypto';
import {
    Experiment,
    ExperimentStatus,
    ExperimentBucket,
    ExperimentAssignment,
    ExperimentContext,
    TargetAudience,
} from './types';
import { PostgresExperimentStore } from './PostgresExperimentStore';

/**
 * 实验存储接口 (可替换为数据库实现)
 */
export interface ExperimentStore {
    getExperiment(id: string): Promise<Experiment | null>;
    listExperiments(status?: ExperimentStatus): Promise<Experiment[]>;
    saveExperiment(experiment: Experiment): Promise<void>;
    deleteExperiment(id: string): Promise<void>;
}

/**
 * 内存实验存储 (开发/测试用)
 */
export class InMemoryExperimentStore implements ExperimentStore {
    private experiments: Map<string, Experiment> = new Map();

    async getExperiment(id: string): Promise<Experiment | null> {
        return this.experiments.get(id) || null;
    }

    async listExperiments(status?: ExperimentStatus): Promise<Experiment[]> {
        const all = Array.from(this.experiments.values());
        if (status) {
            return all.filter(e => e.status === status);
        }
        return all;
    }

    async saveExperiment(experiment: Experiment): Promise<void> {
        this.experiments.set(experiment.id, experiment);
    }

    async deleteExperiment(id: string): Promise<void> {
        this.experiments.delete(id);
    }
}

/**
 * 用户特征接口 (用于目标受众判断)
 */
export interface UserFeatures {
    userId: string;
    followerCount?: number;
    accountCreatedAt?: Date;
    platform?: string;
    region?: string;
}

/**
 * 实验服务配置
 */
export interface ExperimentServiceConfig {
    /** 实验存储 */
    store: ExperimentStore;
    /** 分流结果缓存 TTL (秒) */
    cacheTtlSeconds?: number;
    /** 是否启用实验 */
    enabled?: boolean;
}

/**
 * 实验服务
 */
export class ExperimentService {
    private store: ExperimentStore;
    private cacheTtlSeconds: number;
    private enabled: boolean;
    
    // 简单的内存缓存 (生产环境应使用 Redis)
    private assignmentCache: Map<string, { assignment: ExperimentAssignment; expireAt: number }> = new Map();

    constructor(config: ExperimentServiceConfig) {
        this.store = config.store;
        this.cacheTtlSeconds = config.cacheTtlSeconds ?? 300; // 5 分钟
        this.enabled = config.enabled ?? true;
    }

    /**
     * 获取用户在某个实验中的分配
     */
    async getAssignment(
        experimentId: string,
        userId: string,
        userFeatures?: UserFeatures
    ): Promise<ExperimentAssignment | null> {
        if (!this.enabled) {
            return null;
        }

        // 检查缓存
        const cacheKey = `${experimentId}:${userId}`;
        const cached = this.assignmentCache.get(cacheKey);
        if (cached && cached.expireAt > Date.now()) {
            return cached.assignment;
        }

        // 获取实验配置
        const experiment = await this.store.getExperiment(experimentId);
        if (!experiment || experiment.status !== 'running') {
            return null;
        }

        // 检查时间范围
        const now = new Date();
        if (experiment.startDate && now < experiment.startDate) {
            return null;
        }
        if (experiment.endDate && now > experiment.endDate) {
            return null;
        }

        // 检查目标受众
        if (experiment.targetAudience && userFeatures) {
            if (!this.matchesAudience(experiment.targetAudience, userFeatures)) {
                return null;
            }
        }

        // 检查是否在实验流量内
        const trafficHash = this.hashForTraffic(userId, experimentId);
        if (trafficHash >= experiment.trafficPercent) {
            return {
                experimentId,
                experimentName: experiment.name,
                bucket: 'control', // 流量外默认为 control
                config: {},
                inExperiment: false,
            };
        }

        // 分流
        const bucket = this.assignBucket(userId, experimentId, experiment.buckets);
        
        const assignment: ExperimentAssignment = {
            experimentId,
            experimentName: experiment.name,
            bucket: bucket.name,
            config: bucket.config,
            inExperiment: true,
        };

        // 缓存结果
        this.assignmentCache.set(cacheKey, {
            assignment,
            expireAt: Date.now() + this.cacheTtlSeconds * 1000,
        });

        return assignment;
    }

    /**
     * 获取用户所有激活实验的分配
     */
    async getAllAssignments(
        userId: string,
        userFeatures?: UserFeatures
    ): Promise<ExperimentAssignment[]> {
        if (!this.enabled) {
            return [];
        }

        const experiments = await this.store.listExperiments('running');
        const assignments: ExperimentAssignment[] = [];

        for (const experiment of experiments) {
            const assignment = await this.getAssignment(experiment.id, userId, userFeatures);
            if (assignment) {
                assignments.push(assignment);
            }
        }

        return assignments;
    }

    /**
     * 创建实验上下文 (用于 Pipeline)
     */
    async createContext(
        userId: string,
        userFeatures?: UserFeatures
    ): Promise<ExperimentContext> {
        const assignments = await this.getAllAssignments(userId, userFeatures);

        return {
            userId,
            assignments,
            getConfig<T>(experimentId: string, key: string, defaultValue: T): T {
                const assignment = assignments.find(a => a.experimentId === experimentId);
                if (!assignment || !assignment.inExperiment) {
                    return defaultValue;
                }
                return (assignment.config[key] as T) ?? defaultValue;
            },
            isInBucket(experimentId: string, bucket: string): boolean {
                const assignment = assignments.find(a => a.experimentId === experimentId);
                return assignment?.inExperiment === true && assignment?.bucket === bucket;
            },
        };
    }

    /**
     * 分配桶 (确定性哈希)
     */
    private assignBucket(
        userId: string,
        experimentId: string,
        buckets: ExperimentBucket[]
    ): ExperimentBucket {
        // 使用 MD5 哈希保证确定性
        const hash = crypto
            .createHash('md5')
            .update(`${userId}:${experimentId}:bucket`)
            .digest('hex');
        
        // 取前 8 位转为 0-100 的数字
        const hashValue = parseInt(hash.substring(0, 8), 16) % 100;

        // 根据权重分配桶
        let cumulative = 0;
        for (const bucket of buckets) {
            cumulative += bucket.weight;
            if (hashValue < cumulative) {
                return bucket;
            }
        }

        // 兜底返回最后一个桶
        return buckets[buckets.length - 1];
    }

    /**
     * 计算流量哈希 (0-100)
     */
    private hashForTraffic(userId: string, experimentId: string): number {
        const hash = crypto
            .createHash('md5')
            .update(`${userId}:${experimentId}:traffic`)
            .digest('hex');
        
        return parseInt(hash.substring(0, 8), 16) % 100;
    }

    /**
     * 检查用户是否匹配目标受众
     */
    private matchesAudience(audience: TargetAudience, user: UserFeatures): boolean {
        // 白名单 (最高优先级)
        if (audience.userIdWhitelist?.length) {
            return audience.userIdWhitelist.includes(user.userId);
        }

        // 黑名单
        if (audience.userIdBlacklist?.includes(user.userId)) {
            return false;
        }

        // 关注者数
        if (audience.minFollowers !== undefined && (user.followerCount ?? 0) < audience.minFollowers) {
            return false;
        }
        if (audience.maxFollowers !== undefined && (user.followerCount ?? 0) > audience.maxFollowers) {
            return false;
        }

        // 账号年龄
        if (audience.accountAgeDays && user.accountCreatedAt) {
            const ageDays = (Date.now() - user.accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
            if (audience.accountAgeDays.min !== undefined && ageDays < audience.accountAgeDays.min) {
                return false;
            }
            if (audience.accountAgeDays.max !== undefined && ageDays > audience.accountAgeDays.max) {
                return false;
            }
        }

        // 平台
        if (audience.platforms?.length && user.platform) {
            if (!audience.platforms.includes(user.platform)) {
                return false;
            }
        }

        // 地区
        if (audience.regions?.length && user.region) {
            if (!audience.regions.includes(user.region)) {
                return false;
            }
        }

        return true;
    }

    // ========== 管理 API ==========

    async createExperiment(experiment: Omit<Experiment, 'createdAt' | 'updatedAt'>): Promise<Experiment> {
        const now = new Date();
        const full: Experiment = {
            ...experiment,
            createdAt: now,
            updatedAt: now,
        };
        await this.store.saveExperiment(full);
        return full;
    }

    async updateExperiment(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
        const existing = await this.store.getExperiment(id);
        if (!existing) {
            return null;
        }

        const updated: Experiment = {
            ...existing,
            ...updates,
            id, // 防止 ID 被覆盖
            updatedAt: new Date(),
        };
        await this.store.saveExperiment(updated);

        // 清除相关缓存
        for (const key of this.assignmentCache.keys()) {
            if (key.startsWith(`${id}:`)) {
                this.assignmentCache.delete(key);
            }
        }

        return updated;
    }

    async pauseExperiment(id: string): Promise<void> {
        await this.updateExperiment(id, { status: 'paused' });
    }

    async resumeExperiment(id: string): Promise<void> {
        await this.updateExperiment(id, { status: 'running' });
    }

    async completeExperiment(id: string): Promise<void> {
        await this.updateExperiment(id, { status: 'completed', endDate: new Date() });
    }

    async getExperiment(id: string): Promise<Experiment | null> {
        return this.store.getExperiment(id);
    }

    async listExperiments(status?: ExperimentStatus): Promise<Experiment[]> {
        return this.store.listExperiments(status);
    }
}

// ========== 单例导出 ==========

let experimentServiceInstance: ExperimentService | null = null;

export function getExperimentService(): ExperimentService {
    if (!experimentServiceInstance) {
        const storeType = String(process.env.EXPERIMENT_STORE || '').toLowerCase();
        const hasPostgresConfig = Boolean(process.env.DATABASE_URL || process.env.PG_HOST);
        const preferPostgres = storeType === 'postgres' || (storeType === '' && hasPostgresConfig);

        let store: ExperimentStore;
        if (preferPostgres) {
            try {
                store = new PostgresExperimentStore();
                console.log('[ExperimentService] Using PostgresExperimentStore');
            } catch (err) {
                console.warn('[ExperimentService] Failed to init PostgresExperimentStore, falling back to InMemoryExperimentStore:', err);
                store = new InMemoryExperimentStore();
            }
        } else {
            store = new InMemoryExperimentStore();
        }

        experimentServiceInstance = new ExperimentService({
            store,
            cacheTtlSeconds: 300,
            enabled: process.env.EXPERIMENTS_ENABLED !== 'false',
        });
    }
    return experimentServiceInstance;
}

export function initExperimentService(config: ExperimentServiceConfig): ExperimentService {
    experimentServiceInstance = new ExperimentService(config);
    return experimentServiceInstance;
}
