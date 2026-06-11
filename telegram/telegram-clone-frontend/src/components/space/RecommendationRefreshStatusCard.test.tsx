import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecommendationRefreshStatusCard } from './RecommendationRefreshStatusCard';
import type { RecommendationDailyRefreshOps } from '../../services/spaceApi';

describe('RecommendationRefreshStatusCard', () => {
    it('renders daily recommendation closure evidence in the Space aside card', () => {
        render(
            <RecommendationRefreshStatusCard
                status={makeStatus()}
                loading={false}
                error={null}
                onRetry={vi.fn()}
            />,
        );

        expect(screen.getByText('推荐系统状态')).toBeInTheDocument();
        expect(screen.getAllByText('success').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-06-11T07:04:46Z')).toBeInTheDocument();
        expect(screen.getByText('642/642')).toBeInTheDocument();
        expect(screen.getByText('100%')).toBeInTheDocument();
        expect(screen.getByText('954/954')).toBeInTheDocument();
        expect(screen.getByText('1161')).toBeInTheDocument();
        expect(screen.getByText('642 users / 1338 posts')).toBeInTheDocument();
        expect(screen.getByText('每天 02:00')).toBeInTheDocument();
    });

    it('keeps the error retry local to the recommendation status card', () => {
        const onRetry = vi.fn();

        render(
            <RecommendationRefreshStatusCard
                status={null}
                loading={false}
                error="无法获取每日推荐闭环统计。"
                onRetry={onRetry}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('推荐状态不可用');
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

function makeStatus(): RecommendationDailyRefreshOps {
    return {
        status: 'success',
        lastRefreshAt: '2026-06-11T07:04:46.553Z',
        latestRun: {
            startedAt: '2026-06-11T06:47:45.406Z',
            finishedAt: '2026-06-11T07:04:46.553Z',
            durationMs: 1021147,
            trigger: 'manual',
            error: null,
        },
        users: {
            registered: 642,
            vectors: 642,
            refreshed: 642,
            compatibleDenseVectorRatio: 1,
        },
        realGraph: {
            edges: 954,
            predicted: 954,
        },
        posts: {
            snapshots: 1161,
            refreshed: 1161,
        },
        artifacts: {
            usersExported: 642,
            postsExported: 1338,
            clustersExported: 0,
        },
        schedule: {
            label: '每天 02:00',
            cron: '0 2 * * *',
        },
        freshnessWindow: {
            hours: 24,
            since: '2026-06-10T08:00:00.000Z',
        },
    };
}
