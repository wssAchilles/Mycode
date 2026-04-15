import { compressSummary } from '../controlPlane/summaryCompression';
import type { ChatDeliveryConsistencySummary } from './chatDeliveryConsistencyService';
import type { ChatDeliveryCanaryStreamSummary } from './deliveryCanaryOps';
import type { DeliveryConsumerOpsSnapshot } from './deliveryConsumerOps';
import type { ChatDeliveryExecutionPolicySummary } from './executionPolicy';

export type ChatDeliveryRolloutAction =
  | 'continue_canary'
  | 'promote_private_primary'
  | 'rollback_to_node'
  | 'repair_outbox'
  | 'investigate_consumer'
  | 'hold_primary'
  | 'monitor';

export interface ChatDeliveryRolloutRecommendation {
  action: ChatDeliveryRolloutAction;
  priority: number;
  reason: string;
}

export interface ChatDeliveryRolloutAssessmentInput {
  rollout: ChatDeliveryExecutionPolicySummary;
  consumer: DeliveryConsumerOpsSnapshot;
  canary: ChatDeliveryCanaryStreamSummary;
  consistency: ChatDeliveryConsistencySummary;
}

export interface ChatDeliveryRolloutAssessment {
  overallStatus: 'healthy' | 'degraded' | 'blocked';
  recommendations: ChatDeliveryRolloutRecommendation[];
  summary: string;
  facts: Record<string, unknown>;
}

function readNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function assessChatDeliveryRollout(
  input: ChatDeliveryRolloutAssessmentInput,
): ChatDeliveryRolloutAssessment {
  const { rollout, consumer, canary, consistency } = input;
  const consumerSummary = (consumer.summary || {}) as Record<string, unknown>;
  const executionMode = String(consumerSummary.executionMode || '');
  const shadowCompared = readNumber(consumerSummary.shadowCompared);
  const shadowMismatches = readNumber(consumerSummary.shadowMismatches);
  const deadLetters = readNumber(consumerSummary.deadLetters);
  const primarySucceeded = readNumber(consumerSummary.primarySucceeded);
  const primaryFailed = readNumber(consumerSummary.primaryFailed);

  const recommendations: ChatDeliveryRolloutRecommendation[] = [];

  if ((rollout.goCanary || rollout.goPrimary) && !consumer.available) {
    recommendations.push({
      action: 'investigate_consumer',
      priority: 5,
      reason: 'Go delivery consumer 当前不可用，无法安全推进 rollout',
    });
  }

  if (consistency.repairableCount > 0) {
    recommendations.push({
      action: 'repair_outbox',
      priority: 15,
      reason: `发现 ${consistency.repairableCount} 条 outbox 聚合漂移，需先修复再推进 rollout`,
    });
  }

  if (rollout.mode === 'go_canary') {
    if (
      shadowCompared >= Math.max(rollout.canary.mismatchThreshold, 5)
      && shadowMismatches === 0
      && deadLetters < rollout.canary.deadLetterThreshold
      && consistency.repairableCount === 0
      && consumer.available
    ) {
      recommendations.push({
        action: 'promote_private_primary',
        priority: 20,
        reason: 'canary 对账稳定，可推进 private 小流量 go_primary',
      });
    } else if (
      shadowMismatches >= rollout.canary.mismatchThreshold
      || deadLetters >= rollout.canary.deadLetterThreshold
    ) {
      recommendations.push({
        action: 'rollback_to_node',
        priority: 10,
        reason: 'canary mismatch / dead-letter 已触达阈值，应优先回滚到 Node',
      });
    } else {
      recommendations.push({
        action: 'continue_canary',
        priority: 40,
        reason: 'canary 仍在收敛期，继续观测 shadow 对账与死信趋势',
      });
    }
  } else if (rollout.mode === 'go_primary') {
    if (consumer.available && executionMode !== 'primary') {
      recommendations.push({
        action: 'hold_primary',
        priority: 10,
        reason: `rollout 已请求 go_primary，但 consumer 当前为 ${executionMode || 'unknown'}，需先校准执行面`,
      });
    } else if (primaryFailed > 0 && primarySucceeded === 0) {
      recommendations.push({
        action: 'rollback_to_node',
        priority: 10,
        reason: 'go_primary 尚未出现成功投影且已存在失败记录，应优先回滚',
      });
    } else {
      recommendations.push({
        action: 'monitor',
        priority: 50,
        reason: 'go_primary 正在运行，继续监控 primary success/failure 与一致性摘要',
      });
    }
  } else {
    recommendations.push({
      action: 'monitor',
      priority: 60,
      reason: '当前仍以 Node 为主执行面，继续保持观测即可',
    });
  }

  recommendations.sort((left, right) => left.priority - right.priority);

  const overallStatus: ChatDeliveryRolloutAssessment['overallStatus'] =
    recommendations.some((entry) => ['rollback_to_node', 'investigate_consumer', 'hold_primary'].includes(entry.action))
      ? 'blocked'
      : recommendations.some((entry) => entry.action === 'repair_outbox' || entry.action === 'continue_canary')
        ? 'degraded'
        : 'healthy';

  const lines = [
    'Summary:',
    `- Rollout mode: ${rollout.mode}`,
    `- Consumer mode: ${executionMode || 'unavailable'}`,
    `- Shadow compared/mismatch: ${shadowCompared}/${shadowMismatches}`,
    `- Dead letters: ${deadLetters}`,
    `- Consistency repairable: ${consistency.repairableCount}`,
    `- Canary stream: ${canary.available ? `${canary.streamLength} entries (${canary.lastResult || 'unknown'})` : 'unavailable'}`,
    `- Next action: ${recommendations[0]?.action || 'monitor'}`,
  ];

  return {
    overallStatus,
    recommendations,
    summary: compressSummary(lines.join('\n')),
    facts: {
      rolloutMode: rollout.mode,
      requestedMode: rollout.requestedMode,
      consumerAvailable: consumer.available,
      consumerExecutionMode: executionMode || null,
      shadowCompared,
      shadowMismatches,
      deadLetters,
      primarySucceeded,
      primaryFailed,
      repairableCount: consistency.repairableCount,
      staleRecordCount: consistency.staleRecordCount,
      goPrimaryReady: rollout.goPrimaryReady,
    },
  };
}
