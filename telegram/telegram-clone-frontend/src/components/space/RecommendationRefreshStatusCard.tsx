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

const HUMAN_STATUS_LABELS: Record<RecommendationDailyRefreshStatus, string> = {
    success: '运行正常',
    running: '刷新中',
    failed: '任务异常',
    unknown: '待同步',
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
                <span className={`space-page__status-pill is-${state}`} title={`状态码: ${STATUS_LABELS[state]}`}>
                    <span className="space-page__status-dot" aria-hidden="true" />
                    <span className="space-page__status-human">{HUMAN_STATUS_LABELS[state]}</span>
                    <span className="space-page__status-code">{STATUS_LABELS[state]}</span>
                </span>
            </div>

            {loading && !status && (
                <div className="space-page__recommendation-status-skeleton" aria-label="推荐系统状态加载中">
                    {Array.from({ length: 4 }).map((_, index) => (
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
                    {/* Apple Bento 2x2 核心覆盖率指标网格 */}
                    <div className="space-page__recommendation-bento">
                        <BentoMetricTile
                            label="用户向量刷新"
                            value={`${status.users.refreshed}/${status.users.registered}`}
                            ratio={ratio(status.users.refreshed, status.users.registered)}
                        />
                        <BentoMetricTile
                            label="用户 dense 向量兼容率"
                            value={formatPercent(status.users.compatibleDenseVectorRatio)}
                            ratio={status.users.compatibleDenseVectorRatio}
                        />
                        <BentoMetricTile
                            label="RealGraph 预测刷新"
                            value={`${status.realGraph.predicted}/${status.realGraph.edges}`}
                            ratio={ratio(status.realGraph.predicted, status.realGraph.edges)}
                        />
                        <BentoMetricTile
                            label="Post 特征快照刷新"
                            value={String(status.posts.refreshed)}
                            ratio={ratio(status.posts.refreshed, status.posts.snapshots)}
                        />
                    </div>

                    {/* 底部紧凑遥测明细条 */}
                    <div className="space-page__recommendation-meta-list">
                        <div className="space-page__recommendation-meta-row">
                            <span className="space-page__recommendation-status-label">最近刷新时间</span>
                            <span className="space-page__recommendation-meta-time">
                                <span className="space-page__recommendation-friendly-time">
                                    {formatFriendlyTimestamp(status.lastRefreshAt)}
                                </span>
                                <span className="space-page__recommendation-iso">
                                    {formatUtcTimestamp(status.lastRefreshAt)}
                                </span>
                            </span>
                        </div>
                        <div className="space-page__recommendation-meta-row">
                            <span className="space-page__recommendation-status-label">导出 artifact</span>
                            <span className="space-page__recommendation-status-value">
                                {`${status.artifacts.usersExported} users / ${status.artifacts.postsExported} posts`}
                            </span>
                        </div>
                        <div className="space-page__recommendation-meta-row">
                            <span className="space-page__recommendation-status-label">下一次自动刷新</span>
                            <span className="space-page__recommendation-status-value">{status.schedule.label}</span>
                        </div>
                    </div>
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

const BentoMetricTile: React.FC<MetricRowProps> = ({ label, value, ratio: progressRatio }) => (
    <div className="space-page__recommendation-bento-card space-page__recommendation-status-row">
        <span className="space-page__recommendation-bento-label">{label}</span>
        <span className="space-page__recommendation-bento-value">{value}</span>
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

function formatFriendlyTimestamp(value: string | null): string {
    if (!value) return '待同步';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

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
