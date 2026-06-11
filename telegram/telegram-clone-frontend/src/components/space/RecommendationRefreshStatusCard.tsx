import React from 'react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import { SparkIcon } from '../icons/SpaceIcons';
import type { RecommendationDailyRefreshOps, RecommendationDailyRefreshStatus } from '../../services/spaceApi';

interface RecommendationRefreshStatusCardProps {
    status: RecommendationDailyRefreshOps | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
}

const STATUS_LABELS: Record<RecommendationDailyRefreshStatus, string> = {
    success: 'success',
    running: 'running',
    failed: 'failed',
    unknown: 'unknown',
};

export const RecommendationRefreshStatusCard: React.FC<RecommendationRefreshStatusCardProps> = ({
    status,
    loading,
    error,
    onRetry,
}) => {
    const state = status?.status ?? 'unknown';

    return (
        <div className="space-page__widget glass-card space-page__recommendation-status">
            <div className="space-page__recommendation-status-header">
                <h2 className="space-page__widget-title">
                    <SparkIcon />
                    推荐系统状态
                </h2>
                <span className={`space-page__status-pill is-${state}`}>{STATUS_LABELS[state]}</span>
            </div>

            {loading && !status && (
                <div className="space-page__recommendation-status-skeleton" aria-label="推荐系统状态加载中">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div className="space-page__recommendation-status-row" key={`refresh-status-skeleton-${index}`}>
                            <Skeleton className="space-page__skeleton-line is-short" />
                            <Skeleton className="space-page__skeleton-line" />
                        </div>
                    ))}
                </div>
            )}

            {error && !loading && !status && (
                <StateBlock
                    compact
                    variant="error"
                    title="推荐状态不可用"
                    description={error}
                    actionLabel="重试"
                    onAction={onRetry}
                />
            )}

            {status && (
                <div className="space-page__recommendation-status-body">
                    <MetricRow
                        label="最近刷新时间"
                        value={formatUtcTimestamp(status.lastRefreshAt)}
                    />
                    <MetricRow
                        label="最新任务状态"
                        value={STATUS_LABELS[status.status]}
                    />
                    <MetricRow
                        label="用户向量刷新"
                        value={`${status.users.refreshed}/${status.users.registered}`}
                        ratio={ratio(status.users.refreshed, status.users.registered)}
                    />
                    <MetricRow
                        label="用户 dense 向量兼容率"
                        value={formatPercent(status.users.compatibleDenseVectorRatio)}
                        ratio={status.users.compatibleDenseVectorRatio}
                    />
                    <MetricRow
                        label="RealGraph 预测刷新"
                        value={`${status.realGraph.predicted}/${status.realGraph.edges}`}
                        ratio={ratio(status.realGraph.predicted, status.realGraph.edges)}
                    />
                    <MetricRow
                        label="Post 特征快照刷新"
                        value={String(status.posts.refreshed)}
                        ratio={ratio(status.posts.refreshed, status.posts.snapshots)}
                    />
                    <MetricRow
                        label="导出 artifact"
                        value={`${status.artifacts.usersExported} users / ${status.artifacts.postsExported} posts`}
                    />
                    <MetricRow
                        label="下一次自动刷新"
                        value={status.schedule.label}
                    />
                </div>
            )}
        </div>
    );
};

interface MetricRowProps {
    label: string;
    value: string;
    ratio?: number;
}

const MetricRow: React.FC<MetricRowProps> = ({ label, value, ratio: progressRatio }) => (
    <div className="space-page__recommendation-status-row">
        <div className="space-page__recommendation-status-copy">
            <span className="space-page__recommendation-status-label">{label}</span>
            <span className="space-page__recommendation-status-value">{value}</span>
        </div>
        {typeof progressRatio === 'number' && (
            <div className="space-page__recommendation-status-bar" aria-hidden="true">
                <div
                    className="space-page__recommendation-status-bar-fill"
                    style={{
                        '--refresh-scale': String(clampRatio(progressRatio)),
                    } as React.CSSProperties}
                />
            </div>
        )}
    </div>
);

function formatUtcTimestamp(value: string | null): string {
    if (!value) return '暂无记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatPercent(value: number): string {
    return `${Math.round(clampRatio(value) * 100)}%`;
}

function ratio(count: number, total: number): number {
    return total > 0 ? count / total : 0;
}

function clampRatio(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export default RecommendationRefreshStatusCard;
