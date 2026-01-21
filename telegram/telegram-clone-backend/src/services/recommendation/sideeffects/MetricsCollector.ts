/**
 * MetricsCollector - 指标收集器
 * 复刻 x-algorithm 的监控机制
 * 异步收集推荐管道的性能和质量指标
 */

import { SideEffect } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

/**
 * 指标类型
 */
interface PipelineMetrics {
    userId: string;
    timestamp: Date;
    candidateCount: number;
    inNetworkRatio: number;
    avgScore: number;
    topScoreRange: { min: number; max: number };
    authorDiversity: number; // 不同作者数 / 总帖子数
}

export class MetricsCollector implements SideEffect<FeedQuery, FeedCandidate> {
    readonly name = 'MetricsCollector';
    private metricsBuffer: PipelineMetrics[] = [];
    private readonly FLUSH_THRESHOLD = 100;

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async run(query: FeedQuery, selectedCandidates: FeedCandidate[]): Promise<void> {
        if (selectedCandidates.length === 0) return;

        try {
            const metrics = this.computeMetrics(query, selectedCandidates);
            this.metricsBuffer.push(metrics);

            // 批量刷新
            if (this.metricsBuffer.length >= this.FLUSH_THRESHOLD) {
                await this.flushMetrics();
            }

            // 调试日志
            console.log(`[MetricsCollector] Feed metrics:
        - Candidates: ${metrics.candidateCount}
        - In-network ratio: ${(metrics.inNetworkRatio * 100).toFixed(1)}%
        - Avg score: ${metrics.avgScore.toFixed(3)}
        - Author diversity: ${(metrics.authorDiversity * 100).toFixed(1)}%`);
        } catch (error) {
            console.error('[MetricsCollector] Failed to collect metrics:', error);
        }
    }

    /**
     * 计算指标
     */
    private computeMetrics(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): PipelineMetrics {
        const scores = candidates.map((c) => c.score || 0);
        const inNetworkCount = candidates.filter((c) => c.inNetwork).length;
        const uniqueAuthors = new Set(candidates.map((c) => c.authorId)).size;

        return {
            userId: query.userId,
            timestamp: new Date(),
            candidateCount: candidates.length,
            inNetworkRatio: inNetworkCount / candidates.length,
            avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
            topScoreRange: {
                min: Math.min(...scores),
                max: Math.max(...scores),
            },
            authorDiversity: uniqueAuthors / candidates.length,
        };
    }

    /**
     * 刷新指标到存储
     * TODO: 实际环境中应该发送到监控系统
     */
    private async flushMetrics(): Promise<void> {
        // 暂时只打印摘要
        console.log(
            `[MetricsCollector] Flushing ${this.metricsBuffer.length} metrics records`
        );
        this.metricsBuffer = [];
    }
}
