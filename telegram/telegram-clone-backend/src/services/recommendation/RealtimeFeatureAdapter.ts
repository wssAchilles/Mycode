/**
 * 实时特征适配器
 * 将事件流中的实时特征集成到推荐管道
 */
import { getEventStreamService, RealtimeFeatureService } from '../eventStreamService';
import { createChildLogger } from '../../utils/logger';

const log = createChildLogger('services:recommendation:realtimeFeature');

export interface RealtimeUserFeatures {
  interestWeights: Record<string, number>;
  activityLevel: 'high' | 'medium' | 'low' | 'inactive';
  eventsLast1h: number;
  eventsLast24h: number;
  lastActiveAt: Date | null;
}

export class RealtimeFeatureAdapter {
  private featureService: RealtimeFeatureService;

  constructor() {
    const eventService = getEventStreamService();
    this.featureService = new RealtimeFeatureService((eventService as any).redis || null);
  }

  /**
   * 获取用户的实时特征
   */
  async getUserFeatures(userId: string): Promise<RealtimeUserFeatures> {
    try {
      const [interestFeatures, activityFeatures] = await Promise.all([
        this.featureService.getUserInterestFeatures(userId),
        this.featureService.getUserActivityFeatures(userId),
      ]);

      // 根据事件数量判断活跃度
      let activityLevel: RealtimeUserFeatures['activityLevel'] = 'inactive';
      if (activityFeatures.eventsLast1h > 10) activityLevel = 'high';
      else if (activityFeatures.eventsLast1h > 3) activityLevel = 'medium';
      else if (activityFeatures.eventsLast24h > 0) activityLevel = 'low';

      return {
        interestWeights: interestFeatures,
        activityLevel,
        eventsLast1h: activityFeatures.eventsLast1h,
        eventsLast24h: activityFeatures.eventsLast24h,
        lastActiveAt: activityFeatures.lastActiveAt,
      };
    } catch (error) {
      log.error({ err: error, userId }, 'Failed to get realtime user features');
      return {
        interestWeights: {},
        activityLevel: 'inactive',
        eventsLast1h: 0,
        eventsLast24h: 0,
        lastActiveAt: null,
      };
    }
  }

  /**
   * 批量获取多个用户的实时特征
   */
  async getBatchUserFeatures(userIds: string[]): Promise<Map<string, RealtimeUserFeatures>> {
    const results = new Map<string, RealtimeUserFeatures>();
    const promises = userIds.map(async (userId) => {
      const features = await this.getUserFeatures(userId);
      results.set(userId, features);
    });
    await Promise.allSettled(promises);
    return results;
  }
}

export const realtimeFeatureAdapter = new RealtimeFeatureAdapter();
