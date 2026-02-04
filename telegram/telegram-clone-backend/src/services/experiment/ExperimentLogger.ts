/**
 * 实验事件日志记录器
 * 用于收集实验数据进行分析
 */

import { ExperimentEvent, ExperimentAssignment } from './types';

/**
 * 日志传输接口 (可替换为 Kafka, ClickHouse 等)
 */
export interface ExperimentLogTransport {
    log(event: ExperimentEvent): Promise<void>;
    logBatch(events: ExperimentEvent[]): Promise<void>;
}

/**
 * 控制台传输 (开发用)
 */
export class ConsoleLogTransport implements ExperimentLogTransport {
    async log(event: ExperimentEvent): Promise<void> {
        console.log('[Experiment]', JSON.stringify(event));
    }

    async logBatch(events: ExperimentEvent[]): Promise<void> {
        for (const event of events) {
            await this.log(event);
        }
    }
}

/**
 * 内存传输 (测试用)
 */
export class InMemoryLogTransport implements ExperimentLogTransport {
    public events: ExperimentEvent[] = [];

    async log(event: ExperimentEvent): Promise<void> {
        this.events.push(event);
    }

    async logBatch(events: ExperimentEvent[]): Promise<void> {
        this.events.push(...events);
    }

    clear(): void {
        this.events = [];
    }

    getEvents(experimentId?: string): ExperimentEvent[] {
        if (experimentId) {
            return this.events.filter(e => e.experimentId === experimentId);
        }
        return this.events;
    }
}

/**
 * HTTP 传输 (生产用)
 */
export class HttpLogTransport implements ExperimentLogTransport {
    private endpoint: string;
    private batchSize: number;
    private flushIntervalMs: number;
    private buffer: ExperimentEvent[] = [];
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(config: {
        endpoint: string;
        batchSize?: number;
        flushIntervalMs?: number;
    }) {
        this.endpoint = config.endpoint;
        this.batchSize = config.batchSize ?? 100;
        this.flushIntervalMs = config.flushIntervalMs ?? 5000;

        // 定时刷新
        this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    }

    async log(event: ExperimentEvent): Promise<void> {
        this.buffer.push(event);
        if (this.buffer.length >= this.batchSize) {
            await this.flush();
        }
    }

    async logBatch(events: ExperimentEvent[]): Promise<void> {
        this.buffer.push(...events);
        if (this.buffer.length >= this.batchSize) {
            await this.flush();
        }
    }

    async flush(): Promise<void> {
        if (this.buffer.length === 0) {
            return;
        }

        const events = [...this.buffer];
        this.buffer = [];

        try {
            await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events }),
            });
        } catch (error) {
            console.error('[ExperimentLogger] Failed to flush events:', error);
            // 重新加入缓冲区
            this.buffer.unshift(...events);
        }
    }

    destroy(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        this.flush();
    }
}

/**
 * 实验日志记录器
 */
export class ExperimentLogger {
    private transport: ExperimentLogTransport;

    constructor(transport?: ExperimentLogTransport) {
        this.transport = transport ?? new ConsoleLogTransport();
    }

    /**
     * 记录曝光事件
     */
    async logImpression(
        userId: string,
        assignments: ExperimentAssignment[],
        metadata?: Record<string, any>
    ): Promise<void> {
        const events = assignments
            .filter(a => a.inExperiment)
            .map(a => ({
                eventType: 'impression' as const,
                userId,
                experimentId: a.experimentId,
                bucket: a.bucket,
                timestamp: new Date(),
                metadata,
            }));

        if (events.length > 0) {
            await this.transport.logBatch(events);
        }
    }

    /**
     * 记录点击事件
     */
    async logClick(
        userId: string,
        experimentId: string,
        bucket: string,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.transport.log({
            eventType: 'click',
            userId,
            experimentId,
            bucket,
            timestamp: new Date(),
            metadata,
        });
    }

    /**
     * 记录互动事件 (like, reply, repost)
     */
    async logEngagement(
        userId: string,
        experimentId: string,
        bucket: string,
        engagementType: 'like' | 'reply' | 'repost' | 'share',
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.transport.log({
            eventType: 'engagement',
            userId,
            experimentId,
            bucket,
            timestamp: new Date(),
            metadata: { ...metadata, engagementType },
        });
    }

    /**
     * 记录转化事件
     */
    async logConversion(
        userId: string,
        experimentId: string,
        bucket: string,
        conversionType: string,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.transport.log({
            eventType: 'conversion',
            userId,
            experimentId,
            bucket,
            timestamp: new Date(),
            metadata: { ...metadata, conversionType },
        });
    }

    /**
     * 批量记录事件
     */
    async logEvents(events: ExperimentEvent[]): Promise<void> {
        await this.transport.logBatch(events);
    }
}

// ========== 单例导出 ==========

let loggerInstance: ExperimentLogger | null = null;

export function getExperimentLogger(): ExperimentLogger {
    if (!loggerInstance) {
        // 根据环境选择传输方式
        const transport = process.env.NODE_ENV === 'production'
            ? new HttpLogTransport({
                endpoint: process.env.EXPERIMENT_LOG_ENDPOINT || '/api/experiment/events',
                batchSize: 100,
                flushIntervalMs: 5000,
            })
            : new ConsoleLogTransport();
        
        loggerInstance = new ExperimentLogger(transport);
    }
    return loggerInstance;
}

export function initExperimentLogger(transport: ExperimentLogTransport): ExperimentLogger {
    loggerInstance = new ExperimentLogger(transport);
    return loggerInstance;
}
