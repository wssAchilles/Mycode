/**
 * SequenceService - PTS 消息序列管理服务
 * 实现仿 Telegram 的消息序列验证和 Gap Recovery
 */
import Redis from 'ioredis';

// Redis 客户端
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// PTS 键前缀
const PTS_PREFIX = 'pts:user:';
const QTS_PREFIX = 'qts:user:'; // 用于 Secret Chat

// 消息状态接口
export interface MessageState {
    pts: number;
    ptsCount: number;
}

// Gap 检测结果
export type GapCheckResult = 'apply' | 'skip' | 'gap';

class SequenceService {
    /**
     * 获取用户当前 PTS
     */
    async getPts(userId: string): Promise<number> {
        const pts = await redis.get(`${PTS_PREFIX}${userId}`);
        return pts ? parseInt(pts, 10) : 0;
    }

    /**
     * 生成新的 PTS (原子递增)
     */
    async generatePts(userId: string, count: number = 1): Promise<number> {
        const newPts = await redis.incrby(`${PTS_PREFIX}${userId}`, count);
        return newPts;
    }

    /**
     * 批量生成 PTS (用于批量消息)
     */
    async generatePtsBatch(
        userId: string,
        count: number
    ): Promise<{ startPts: number; endPts: number }> {
        const endPts = await redis.incrby(`${PTS_PREFIX}${userId}`, count);
        const startPts = endPts - count + 1;
        return { startPts, endPts };
    }

    /**
     * 检查 PTS 是否有 Gap
     * @param localPts 客户端当前 PTS
     * @param remotePts 消息携带的 PTS
     * @param ptsCount 消息事件数量
     */
    checkGap(localPts: number, remotePts: number, ptsCount: number): GapCheckResult {
        const expectedPts = localPts + ptsCount;

        if (expectedPts === remotePts) {
            // 正常：本地 PTS + 事件数 = 远程 PTS
            return 'apply';
        } else if (expectedPts > remotePts) {
            // 重复消息：跳过
            return 'skip';
        } else {
            // 有 Gap：需要拉取缺失消息
            return 'gap';
        }
    }

    /**
     * 获取用户 QTS (Secret Chat 序列)
     */
    async getQts(userId: string): Promise<number> {
        const qts = await redis.get(`${QTS_PREFIX}${userId}`);
        return qts ? parseInt(qts, 10) : 0;
    }

    /**
     * 生成新的 QTS
     */
    async generateQts(userId: string): Promise<number> {
        return redis.incr(`${QTS_PREFIX}${userId}`);
    }

    /**
     * 重置用户序列 (慎用，仅用于测试)
     */
    async resetSequence(userId: string): Promise<void> {
        await Promise.all([
            redis.del(`${PTS_PREFIX}${userId}`),
            redis.del(`${QTS_PREFIX}${userId}`),
        ]);
    }

    /**
     * 获取多个用户的 PTS
     */
    async getMultiplePts(userIds: string[]): Promise<Map<string, number>> {
        const pipeline = redis.pipeline();

        for (const userId of userIds) {
            pipeline.get(`${PTS_PREFIX}${userId}`);
        }

        const results = await pipeline.exec();
        const ptsMap = new Map<string, number>();

        if (results) {
            userIds.forEach((userId, index) => {
                const [err, value] = results[index];
                if (!err && value) {
                    ptsMap.set(userId, parseInt(value as string, 10));
                } else {
                    ptsMap.set(userId, 0);
                }
            });
        }

        return ptsMap;
    }

    /**
     * 获取用户完整状态
     */
    async getState(userId: string): Promise<{
        pts: number;
        qts: number;
        date: number;
    }> {
        const [pts, qts] = await Promise.all([
            this.getPts(userId),
            this.getQts(userId),
        ]);

        return {
            pts,
            qts,
            date: Math.floor(Date.now() / 1000),
        };
    }
}

// 导出单例
export const sequenceService = new SequenceService();
export default sequenceService;
