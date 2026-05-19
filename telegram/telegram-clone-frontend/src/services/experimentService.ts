/**
 * Experiment Service - A/B 实验客户端
 * 获取当前用户的实验分配，提供 UI 级别的实验配置读取
 */

import apiClient from './apiClient';

export interface ExperimentAssignment {
    experimentId: string;
    experimentName: string;
    bucket: string;
    config: Record<string, unknown>;
    inExperiment: boolean;
}

interface ExperimentAssignmentResponse {
    userId: string;
    assignments: ExperimentAssignment[];
    activeCount: number;
}

// 内存缓存（会话级别）
let cachedAssignments: ExperimentAssignment[] | null = null;
let fetchPromise: Promise<ExperimentAssignment[]> | null = null;

/**
 * 获取当前用户的所有实验分配
 * 结果在会话级别缓存，避免重复请求
 */
export async function getExperimentAssignments(forceRefresh = false): Promise<ExperimentAssignment[]> {
    if (!forceRefresh && cachedAssignments) {
        return cachedAssignments;
    }

    // 防止并发请求
    if (fetchPromise) {
        return fetchPromise;
    }

    fetchPromise = (async () => {
        try {
            const response = await apiClient.get<ExperimentAssignmentResponse>(
                '/api/analytics/experiments/assignment'
            );
            cachedAssignments = response.data.assignments || [];
            return cachedAssignments;
        } catch {
            // 实验分配获取失败不应阻塞用户操作
            cachedAssignments = [];
            return cachedAssignments;
        } finally {
            fetchPromise = null;
        }
    })();

    return fetchPromise;
}

/**
 * 获取指定实验的配置值
 * 如果用户不在实验中或实验不存在，返回默认值
 */
export async function getExperimentConfig<T>(
    experimentId: string,
    key: string,
    defaultValue: T
): Promise<T> {
    const assignments = await getExperimentAssignments();
    const assignment = assignments.find(a => a.experimentId === experimentId && a.inExperiment);
    if (!assignment) return defaultValue;
    return (assignment.config[key] as T) ?? defaultValue;
}

/**
 * 检查用户是否在指定实验的指定桶中
 */
export async function isInBucket(experimentId: string, bucket: string): Promise<boolean> {
    const assignments = await getExperimentAssignments();
    const assignment = assignments.find(a => a.experimentId === experimentId);
    return assignment?.inExperiment === true && assignment?.bucket === bucket;
}

/**
 * 获取所有活跃实验的摘要（用于调试 UI）
 */
export async function getActiveExperimentsSummary(): Promise<string[]> {
    const assignments = await getExperimentAssignments();
    return assignments
        .filter(a => a.inExperiment)
        .map(a => `${a.experimentName}: ${a.bucket}`);
}

/**
 * 清除缓存（用于登出或强制刷新）
 */
export function clearExperimentCache(): void {
    cachedAssignments = null;
    fetchPromise = null;
}
