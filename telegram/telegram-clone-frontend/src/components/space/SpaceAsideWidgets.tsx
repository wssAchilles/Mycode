import React, { useEffect } from 'react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import { TrendIcon, UserPlusIcon } from '../icons/SpaceIcons';
import type { RecommendedUser, RecommendationDailyRefreshOps, TrendItem } from '../../services/spaceApi';
import { RecommendationRefreshStatusCard } from './RecommendationRefreshStatusCard';
import {
    limitedMotionItems,
    motionDurations,
    motionStaggers,
    stagger,
    useAnimeScope,
    waapi,
} from '../../core/animation';

interface SpaceAsideWidgetsProps {
    trends: TrendItem[];
    recommendedUsers: RecommendedUser[];
    loadingAside: boolean;
    asideError: string | null;
    recommendationRefreshStatus: RecommendationDailyRefreshOps | null;
    loadingRecommendationRefresh: boolean;
    recommendationRefreshError: string | null;
    onRetry: () => void;
    onRecommendationRefreshRetry: () => void;
    onTrendClick: (tag: string) => void;
    onFollowToggle: (user: RecommendedUser) => void;
}

export const SpaceAsideWidgets: React.FC<SpaceAsideWidgetsProps> = ({
    trends,
    recommendedUsers,
    loadingAside,
    asideError,
    recommendationRefreshStatus,
    loadingRecommendationRefresh,
    recommendationRefreshError,
    onRetry,
    onRecommendationRefreshRetry,
    onTrendClick,
    onFollowToggle,
}) => {
    const widgetsMotion = useAnimeScope<HTMLElement, {
        reveal: () => void;
        heatbars: () => void;
    }>(
        ({ root, reducedMotion, duration }) => ({
            reveal: () => {
                if (reducedMotion || !root) return;
                const items = limitedMotionItems(
                    root.querySelectorAll('.space-page__recommendation-status-row, .space-page__trend-item, .space-page__suggest-user-item'),
                );
                if (items.length === 0) return;
                waapi.animate(items, {
                    opacity: [0, 1],
                    y: ['8px', '0px'],
                    duration: duration(motionDurations.fast),
                    delay: stagger(motionStaggers.tight),
                    ease: 'out(4)',
                });
            },
            heatbars: () => {
                if (reducedMotion || !root) return;
                const bars = limitedMotionItems(root.querySelectorAll('.space-page__heatbar-fill'));
                if (bars.length === 0) return;
                waapi.animate(bars, {
                    transform: ['scaleX(0)', 'scaleX(var(--heat-scale))'],
                    duration: duration(motionDurations.slow),
                    delay: stagger(motionStaggers.tight),
                    ease: 'out(4)',
                });
            },
        }),
        [recommendationRefreshStatus, trends.length, recommendedUsers.length],
    );

    useEffect(() => {
        widgetsMotion.run('reveal');
        widgetsMotion.run('heatbars');
    }, [recommendedUsers.length, recommendationRefreshStatus, trends.length, widgetsMotion]);

    return (
        <aside ref={widgetsMotion.rootRef} className="space-page__aside">
            <RecommendationRefreshStatusCard
                status={recommendationRefreshStatus}
                loading={loadingRecommendationRefresh}
                error={recommendationRefreshError}
                onRetry={onRecommendationRefreshRetry}
            />

            <div className="space-page__widget glass-card">
                <h2 className="space-page__widget-title">
                    <TrendIcon />
                    热门趋势
                </h2>
                {loadingAside && trends.length === 0 && (
                    <div className="space-page__skeleton-list" aria-label="趋势加载中">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div className="space-page__skeleton-row" key={`trend-skeleton-${index}`}>
                                <Skeleton className="space-page__skeleton-line is-short" />
                                <Skeleton className="space-page__skeleton-line" />
                            </div>
                        ))}
                    </div>
                )}
                {asideError && trends.length === 0 && !loadingAside && (
                    <StateBlock
                        compact
                        variant="error"
                        title="趋势加载失败"
                        description="无法获取热门话题。"
                        actionLabel="重试"
                        onAction={onRetry}
                    />
                )}
                {trends.length === 0 && !loadingAside && !asideError && (
                    <div className="space-page__empty-state">暂无趋势话题</div>
                )}
                {trends.map((trend) => {
                    const trendLabel = trend.displayName?.trim() || `#${trend.tag}`;
                    const trendCategory = trend.kind === 'news_event' ? '新闻 · 热门' : '话题 · 热门';
                    return (
                        <div
                            className="space-page__trend-item"
                            key={trend.tag}
                            role="button"
                            tabIndex={0}
                            aria-label={`查看趋势 ${trendLabel}`}
                            onClick={() => onTrendClick(trend.tag)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onTrendClick(trend.tag);
                                }
                            }}
                        >
                            <div className="space-page__trend-info">
                                <span className="space-page__trend-category">{trendCategory}</span>
                                <span className="space-page__trend-name">{trendLabel}</span>
                                <span className="space-page__trend-posts">{trend.count} 条相关动态</span>
                            </div>
                            <div className="space-page__trend-meta">
                                <div className="space-page__heatbar">
                                    <div
                                        className="space-page__heatbar-fill"
                                        style={{
                                            '--heat-scale': String(Math.max(0, Math.min(100, trend.heat)) / 100),
                                        } as React.CSSProperties}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="space-page__widget glass-card">
                <h2 className="space-page__widget-title">
                    <UserPlusIcon />
                    推荐关注
                </h2>
                {loadingAside && recommendedUsers.length === 0 && (
                    <div className="space-page__skeleton-list" aria-label="推荐用户加载中">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div className="space-page__skeleton-user" key={`user-skeleton-${index}`}>
                                <Skeleton className="space-page__skeleton-avatar" />
                                <div className="space-page__skeleton-user-copy">
                                    <Skeleton className="space-page__skeleton-line is-short" />
                                    <Skeleton className="space-page__skeleton-line" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {asideError && recommendedUsers.length === 0 && !loadingAside && (
                    <StateBlock
                        compact
                        variant="error"
                        title="推荐加载失败"
                        description="暂时无法获取推荐关注。"
                        actionLabel="重试"
                        onAction={onRetry}
                    />
                )}
                {recommendedUsers.length === 0 && !loadingAside && !asideError && (
                    <div className="space-page__empty-state">暂无推荐用户</div>
                )}
                {recommendedUsers.map((user) => (
                    <div className="space-page__suggest-user-item" key={user.id}>
                        <div className={`space-page__suggest-avatar-wrapper ${user.isOnline ? 'is-online' : ''}`}>
                            {user.avatarUrl ? (
                                <img className="space-page__suggest-avatar-img" src={user.avatarUrl} alt={user.username} />
                            ) : (
                                <div className="space-page__suggest-avatar">{user.username.charAt(0).toUpperCase()}</div>
                            )}
                            {user.isOnline && <div className="space-page__suggest-status-ring" />}
                        </div>
                        <div className="space-page__suggest-user-info">
                            <div className="space-page__suggest-user-name">{user.username}</div>
                            <div className="space-page__suggest-user-handle">{user.reason || '@space'}</div>
                        </div>
                        <button
                            type="button"
                            className={`space-page__follow-btn ${user.isFollowed ? 'is-followed' : ''}`}
                            onClick={() => onFollowToggle(user)}
                        >
                            {user.isFollowed ? '已关注' : '关注'}
                        </button>
                    </div>
                ))}
            </div>
        </aside>
    );
};

export default SpaceAsideWidgets;
