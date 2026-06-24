import cron from 'node-cron';
import { spaceService } from '../services/spaceService';
import { newsService } from '../services/newsService';
import { simClustersBatchJob } from '../services/jobs/SimClustersBatchJob';
import { realGraphDecayJob } from '../services/jobs/RealGraphDecayJob';
import { dailyRecommendationRefreshJob } from '../services/jobs/DailyRecommendationRefreshJob';
import { newsMaterializationService } from '../services/recommendation/newsMaterialization';
import { createChildLogger } from '../utils/logger';
import {
  runtimeControlPlane,
  LifecyclePhase,
  LifecycleStatus,
} from '../services/controlPlane/runtimeControlPlane';

const log = createChildLogger('bootstrap:scheduler');

async function materializeRecentNewsPosts(context: string): Promise<void> {
  const result = await newsMaterializationService.materialize({
    limit: 300,
    batchSize: 100,
    since: new Date(Date.now() - 72 * 60 * 60 * 1000),
    refreshFeatureSnapshots: true,
  });
  log.info({ ...result, context }, 'News articles materialized into Space posts');
}

export function registerCronJobs(): void {
  // Daily Cleanup (00:00)
  cron.schedule('0 0 * * *', async () => {
    log.info('Starting daily news cleanup...');
    try {
      const count = await spaceService.cleanupOldNews();
      log.info({ count }, 'Cleaned up old news posts');
    } catch (error) {
      log.error({ err: error }, 'Daily cleanup failed');
    }
  });
  log.info('定时清理任务已启动 (每日 00:00)');

  // NewsService 清理 (00:30)
  cron.schedule('30 0 * * *', async () => {
    log.info('Starting news content cleanup...');
    try {
      const result = await newsService.cleanup(30, 90);
      log.info({ stripped: result.stripped, deleted: result.deleted }, 'News cleanup done');
    } catch (error) {
      log.error({ err: error }, 'News cleanup failed');
    }
  });
  log.info('News 内容清理任务已启动 (每日 00:30)');

  // News 用户向量更新 (01:00)
  cron.schedule('0 1 * * *', async () => {
    log.info('Starting news user vector update...');
    try {
      const updated = await newsService.updateUserVectors();
      log.info({ updated }, 'News user vectors updated');
    } catch (error) {
      log.error({ err: error }, 'News user vector update failed');
    }
  });
  log.info('News 用户向量任务已启动 (每日 01:00)');

  // News materialization for Space personalized brief (01:20)
  cron.schedule('20 1 * * *', async () => {
    log.info('Starting news post materialization...');
    try {
      await materializeRecentNewsPosts('daily-news-materialization');
    } catch (error) {
      log.error({ err: error }, 'News post materialization failed');
    }
  });
  log.info('News Space 物化任务已启动 (每日 01:20)');

  // Unified recommendation closure (02:00)
  cron.schedule('0 2 * * *', async () => {
    log.info('Starting daily recommendation refresh closure...');
    try {
      await materializeRecentNewsPosts('pre-daily-recommendation-refresh');
      const result = await dailyRecommendationRefreshJob.run({ trigger: 'cron' });
      log.info({
        users: result.users,
        realGraph: result.realGraph,
        posts: result.posts,
        featureExport: result.featureExport,
      }, 'Daily recommendation refresh closure completed');
    } catch (error) {
      log.error({ err: error }, 'Daily recommendation refresh closure failed');
    }
  });
  log.info('推荐特征闭环刷新任务已启动 (每日 02:00)');

  // SimClusters 离线嵌入计算 (03:00)
  cron.schedule('0 3 * * *', async () => {
    log.info('Starting SimClusters batch job...');
    try {
      const result = await simClustersBatchJob.run();
      log.info({ success: result.success, durationMs: result.durationMs }, 'SimClusters completed');
    } catch (error) {
      log.error({ err: error }, 'SimClusters job failed');
    }
  });
  log.info('SimClusters 批量任务已启动 (每日 03:00)');

  // RealGraph 衰减计算 (04:00)
  cron.schedule('0 4 * * *', async () => {
    log.info('Starting RealGraph decay job...');
    try {
      const result = await realGraphDecayJob.run();
      log.info({ decayedEdges: result.decayedEdges, durationMs: result.durationMs }, 'RealGraph decay completed');
    } catch (error) {
      log.error({ err: error }, 'RealGraph decay failed');
    }
  });
  log.info('RealGraph 衰减任务已启动 (每日 04:00)');

  runtimeControlPlane.markUnit({
    unit: 'cron',
    phase: LifecyclePhase.RUNTIME,
    status: LifecycleStatus.RUNNING,
    message: 'cron schedules registered',
  });
}
