import { compressSummary } from '../controlPlane/summaryCompression';
import type { ChatDeliveryConsistencySummary } from './chatDeliveryConsistencyService';
import type { ChatDeliveryCanaryStreamSummary } from './deliveryCanaryOps';
import type { DeliveryConsumerOpsSnapshot } from './deliveryConsumerOps';
import type { ChatDeliveryExecutionPolicySummary } from './executionPolicy';
import type { ChatDeliveryPrimaryFallbackSummary } from './contracts';

export type ChatDeliveryRolloutAction =
  | 'continue_canary'
  | 'promote_private_primary'
  | 'promote_group_canary'
  | 'continue_group_canary'
  | 'promote_group_primary'
  | 'activate_legacy_fallback'
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
  fallback: ChatDeliveryPrimaryFallbackSummary;
}

export interface ChatDeliveryRolloutAssessment {
  overallStatus: 'healthy' | 'degraded' | 'blocked';
  recommendations: ChatDeliveryRolloutRecommendation[];
  summary: string;
  facts: Record<string, unknown>;
}

interface ChatDeliveryRolloutFacts {
  rolloutMode: ChatDeliveryExecutionPolicySummary['mode'];
  takeoverStage: ChatDeliveryExecutionPolicySummary['takeoverStage'];
  privateStage: 'node_primary' | 'go_primary';
  groupStage: 'node_primary' | 'go_group_canary' | 'go_primary';
  fallbackStrategy: 'node_primary' | 'fallback_only';
  goManaged: boolean;
  consumerAvailable: boolean;
  consumerExecutionMode: string;
  shadowCompared: number;
  shadowMismatches: number;
  deadLetters: number;
  primarySucceeded: number;
  primaryFailed: number;
  primarySuccessRate: number;
  primaryPrivateSucceeded: number;
  primaryPrivateFailed: number;
  primaryGroupSucceeded: number;
  primaryGroupFailed: number;
  privatePrimarySuccessRate: number;
  groupPrimarySuccessRate: number;
  repairableCount: number;
  staleRecordCount: number;
  fallbackEligibleCount: number;
  fallbackEligiblePrivateCount: number;
  fallbackEligibleGroupCount: number;
  fallbackFailedEligibleCount: number;
  fallbackStaleEligibleCount: number;
  canaryAvailable: boolean;
  canaryStreamLength: number;
  canaryLastResult: string | null;
  canaryMismatchThreshold: number;
  canaryDeadLetterThreshold: number;
  goPrimaryReady: boolean;
}

interface ChatDeliveryRolloutPolicyRule {
  action: ChatDeliveryRolloutAction;
  priority: number;
  when: (facts: ChatDeliveryRolloutFacts) => boolean;
  reason: (facts: ChatDeliveryRolloutFacts) => string;
}

function readNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolvePrivateStage(
  rollout: ChatDeliveryExecutionPolicySummary,
): ChatDeliveryRolloutFacts['privateStage'] {
  const explicit = rollout.segmentStages?.private;
  if (explicit === 'go_primary') {
    return explicit;
  }
  return rollout.takeoverStage === 'private_primary'
    || rollout.takeoverStage === 'group_canary'
    || rollout.takeoverStage === 'full_primary'
    ? 'go_primary'
    : 'node_primary';
}

function resolveGroupStage(
  rollout: ChatDeliveryExecutionPolicySummary,
): ChatDeliveryRolloutFacts['groupStage'] {
  const explicit = rollout.segmentStages?.group;
  if (explicit === 'go_group_canary' || explicit === 'go_primary') {
    return explicit;
  }
  if (rollout.takeoverStage === 'full_primary') {
    return 'go_primary';
  }
  if (rollout.takeoverStage === 'group_canary') {
    return 'go_group_canary';
  }
  return 'node_primary';
}

function buildFacts(input: ChatDeliveryRolloutAssessmentInput): ChatDeliveryRolloutFacts {
  const { rollout, consumer, canary, consistency, fallback } = input;
  const consumerSummary = (consumer.summary || {}) as Record<string, unknown>;
  const consumerRuntime = (consumer.runtime || {}) as Record<string, unknown>;
  const executionMode = String(consumerSummary.executionMode || consumerRuntime.executionMode || '');
  const primarySucceeded = readNumber(consumerSummary.primarySucceeded);
  const primaryFailed = readNumber(consumerSummary.primaryFailed);
  const primarySuccessRate = readNumber((consumerSummary.derived as Record<string, unknown> | undefined)?.primarySuccessRate);
  const primaryPrivateSucceeded = readNumber(consumerSummary.primaryPrivateSucceeded) || primarySucceeded;
  const primaryPrivateFailed = readNumber(consumerSummary.primaryPrivateFailed);
  const primaryGroupSucceeded = readNumber(consumerSummary.primaryGroupSucceeded);
  const primaryGroupFailed = readNumber(consumerSummary.primaryGroupFailed);
  const privatePrimarySuccessRate = readNumber((consumerSummary.derived as Record<string, unknown> | undefined)?.privatePrimarySuccessRate) || primarySuccessRate;
  const groupPrimarySuccessRate = readNumber((consumerSummary.derived as Record<string, unknown> | undefined)?.groupPrimarySuccessRate);

  return {
    rolloutMode: rollout.mode,
    takeoverStage: rollout.takeoverStage,
    privateStage: resolvePrivateStage(rollout),
    groupStage: resolveGroupStage(rollout),
    fallbackStrategy: rollout.fallbackStrategy || (rollout.nodeFallbackOnly ? 'fallback_only' : 'node_primary'),
    goManaged: rollout.goCanary || rollout.goPrimary,
    consumerAvailable: consumer.available,
    consumerExecutionMode: executionMode,
    shadowCompared: readNumber(consumerSummary.shadowCompared),
    shadowMismatches: readNumber(consumerSummary.shadowMismatches),
    deadLetters: readNumber(consumerSummary.deadLetters),
    primarySucceeded,
    primaryFailed,
    primarySuccessRate,
    primaryPrivateSucceeded,
    primaryPrivateFailed,
    primaryGroupSucceeded,
    primaryGroupFailed,
    privatePrimarySuccessRate,
    groupPrimarySuccessRate,
    repairableCount: consistency.repairableCount,
    staleRecordCount: consistency.staleRecordCount,
    fallbackEligibleCount: fallback.eligibleCount,
    fallbackEligiblePrivateCount: fallback.eligiblePrivateCount,
    fallbackEligibleGroupCount: fallback.eligibleGroupCount,
    fallbackFailedEligibleCount: fallback.failedEligibleCount,
    fallbackStaleEligibleCount: fallback.staleEligibleCount,
    canaryAvailable: canary.available,
    canaryStreamLength: canary.streamLength,
    canaryLastResult: canary.lastResult || null,
    canaryMismatchThreshold: rollout.canary.mismatchThreshold,
    canaryDeadLetterThreshold: rollout.canary.deadLetterThreshold,
    goPrimaryReady: rollout.goPrimaryReady,
  };
}

function buildPolicyRules(): ChatDeliveryRolloutPolicyRule[] {
  return [
    {
      action: 'investigate_consumer',
      priority: 5,
      when: (facts) => facts.goManaged && !facts.consumerAvailable,
      reason: () => 'Go delivery consumer 当前不可用，无法安全推进 rollout',
    },
    {
      action: 'hold_primary',
      priority: 10,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.consumerAvailable
        && facts.consumerExecutionMode !== 'primary',
      reason: (facts) => `rollout 已请求 go_primary，但 consumer 当前为 ${facts.consumerExecutionMode || 'unknown'}，需先校准执行面`,
    },
    {
      action: 'repair_outbox',
      priority: 15,
      when: (facts) => facts.repairableCount > 0,
      reason: (facts) => `发现 ${facts.repairableCount} 条 outbox 聚合漂移，需先修复再推进 rollout`,
    },
    {
      action: 'rollback_to_node',
      priority: 10,
      when: (facts) =>
        facts.rolloutMode === 'go_canary'
        && (facts.shadowMismatches >= facts.canaryMismatchThreshold || facts.deadLetters >= facts.canaryDeadLetterThreshold),
      reason: () => 'canary mismatch / dead-letter 已触达阈值，应优先回滚到 Node',
    },
    {
      action: 'promote_private_primary',
      priority: 20,
      when: (facts) =>
        facts.rolloutMode === 'go_canary'
        && facts.consumerAvailable
        && facts.shadowCompared >= Math.max(facts.canaryMismatchThreshold, 5)
        && facts.shadowMismatches === 0
        && facts.deadLetters < facts.canaryDeadLetterThreshold
        && facts.repairableCount === 0
        && facts.fallbackEligibleCount === 0,
      reason: () => 'canary 对账稳定，可推进 private 小流量 go_primary',
    },
    {
      action: 'continue_canary',
      priority: 40,
      when: (facts) =>
        facts.rolloutMode === 'go_canary'
        && !(
          facts.shadowMismatches >= facts.canaryMismatchThreshold
          || facts.deadLetters >= facts.canaryDeadLetterThreshold
        )
        && !(
          facts.consumerAvailable
          && facts.shadowCompared >= Math.max(facts.canaryMismatchThreshold, 5)
          && facts.shadowMismatches === 0
          && facts.deadLetters < facts.canaryDeadLetterThreshold
          && facts.repairableCount === 0
          && facts.fallbackEligibleCount === 0
        ),
      reason: () => 'canary 仍在收敛期，继续观测 shadow 对账与死信趋势',
    },
    {
      action: 'activate_legacy_fallback',
      priority: 12,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'private_primary'
        && (facts.fallbackFailedEligibleCount > 0 || facts.fallbackStaleEligibleCount > 0),
      reason: (facts) => `检测到 ${facts.fallbackEligibleCount} 条 go_primary 候选需要 Node fallback-only 接手`,
    },
    {
      action: 'rollback_to_node',
      priority: 10,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'private_primary'
        && facts.primaryFailed > 0
        && facts.primarySucceeded === 0,
      reason: () => 'go_primary 尚未出现成功投影且已存在失败记录，应优先回滚',
    },
    {
      action: 'promote_group_canary',
      priority: 45,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'private_primary'
        && facts.primaryPrivateSucceeded > 0
        && facts.privatePrimarySuccessRate >= 0.99
        && facts.repairableCount === 0
        && facts.fallbackEligibleCount === 0,
      reason: () => 'private primary 已稳定，可准备下一阶段 group canary',
    },
    {
      action: 'activate_legacy_fallback',
      priority: 12,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'group_canary'
        && facts.fallbackEligibleGroupCount > 0,
      reason: (facts) => `检测到 ${facts.fallbackEligibleGroupCount} 条 group canary 候选需要 Node fallback-only 接手`,
    },
    {
      action: 'rollback_to_node',
      priority: 10,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'group_canary'
        && facts.primaryGroupFailed > 0
        && facts.primaryGroupSucceeded === 0,
      reason: () => 'group canary 已出现失败但尚无成功投影，应优先回退到 Node',
    },
    {
      action: 'promote_group_primary',
      priority: 45,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'group_canary'
        && facts.primaryGroupSucceeded > 0
        && facts.groupPrimarySuccessRate >= 0.99
        && facts.repairableCount === 0
        && facts.fallbackEligibleGroupCount === 0,
      reason: () => 'group canary 已稳定，可推进 group primary',
    },
    {
      action: 'continue_group_canary',
      priority: 40,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'group_canary'
        && facts.fallbackEligibleGroupCount === 0
        && !(facts.primaryGroupFailed > 0 && facts.primaryGroupSucceeded === 0)
        && !(
          facts.primaryGroupSucceeded > 0
          && facts.groupPrimarySuccessRate >= 0.99
          && facts.repairableCount === 0
          && facts.fallbackEligibleGroupCount === 0
        ),
      reason: () => 'group canary 正在收敛期，继续观测 group success/failure 与 fallback backlog',
    },
    {
      action: 'activate_legacy_fallback',
      priority: 12,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'full_primary'
        && facts.fallbackEligibleCount > 0,
      reason: (facts) => `检测到 ${facts.fallbackEligibleCount} 条 full_primary backlog 需要 Node fallback-only / replay-only 接手`,
    },
    {
      action: 'rollback_to_node',
      priority: 10,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'full_primary'
        && facts.primaryGroupFailed > 0
        && facts.primaryGroupSucceeded === 0,
      reason: () => 'full_primary 已接管 group，但 group 投影只有失败没有成功，应优先回滚到 Node',
    },
    {
      action: 'monitor',
      priority: 50,
      when: (facts) =>
        facts.rolloutMode === 'go_primary'
        && facts.takeoverStage === 'full_primary',
      reason: () => 'full_primary 已接管 private + group，继续监控 fallback backlog、group success rate 与 outbox 一致性',
    },
    {
      action: 'monitor',
      priority: 50,
      when: (facts) => facts.rolloutMode === 'go_primary',
      reason: () => 'go_primary 正在运行，继续监控 primary success/failure 与一致性摘要',
    },
    {
      action: 'monitor',
      priority: 60,
      when: () => true,
      reason: () => '当前仍以 Node 为主执行面，继续保持观测即可',
    },
  ];
}

export function assessChatDeliveryRollout(
  input: ChatDeliveryRolloutAssessmentInput,
): ChatDeliveryRolloutAssessment {
  const { rollout, canary, consistency, fallback } = input;
  const facts = buildFacts(input);
  const recommendations = buildPolicyRules()
    .filter((rule) => rule.when(facts))
    .map((rule) => ({
      action: rule.action,
      priority: rule.priority,
      reason: rule.reason(facts),
    }))
    .sort((left, right) => left.priority - right.priority);

  const overallStatus: ChatDeliveryRolloutAssessment['overallStatus'] =
    recommendations.some((entry) => ['rollback_to_node', 'investigate_consumer', 'hold_primary'].includes(entry.action))
      ? 'blocked'
      : recommendations.some((entry) => ['repair_outbox', 'continue_canary', 'continue_group_canary', 'activate_legacy_fallback'].includes(entry.action))
        ? 'degraded'
        : 'healthy';

  const lines = [
    'Summary:',
    `- Rollout mode: ${rollout.mode} (${rollout.takeoverStage})`,
    `- Segment stages: private=${facts.privateStage}, group=${facts.groupStage}`,
    `- Fallback strategy: ${facts.fallbackStrategy}`,
    `- Consumer mode: ${facts.consumerExecutionMode || 'unavailable'}`,
    `- Shadow compared/mismatch: ${facts.shadowCompared}/${facts.shadowMismatches}`,
    `- Dead letters: ${facts.deadLetters}`,
    `- Consistency repairable: ${consistency.repairableCount}`,
    `- Primary fallback candidates: ${fallback.eligibleCount}`,
    `- Group fallback candidates: ${fallback.eligibleGroupCount}`,
    `- Canary stream: ${canary.available ? `${canary.streamLength} entries (${canary.lastResult || 'unknown'})` : 'unavailable'}`,
    `- Next action: ${recommendations[0]?.action || 'monitor'}`,
  ];

  return {
    overallStatus,
    recommendations,
    summary: compressSummary(lines.join('\n')),
    facts: {
      rolloutMode: rollout.mode,
      takeoverStage: rollout.takeoverStage,
      privateStage: facts.privateStage,
      groupStage: facts.groupStage,
      fallbackStrategy: facts.fallbackStrategy,
      requestedMode: rollout.requestedMode,
      consumerAvailable: facts.consumerAvailable,
      consumerExecutionMode: facts.consumerExecutionMode || null,
      shadowCompared: facts.shadowCompared,
      shadowMismatches: facts.shadowMismatches,
      deadLetters: facts.deadLetters,
      primarySucceeded: facts.primarySucceeded,
      primaryFailed: facts.primaryFailed,
      primarySuccessRate: facts.primarySuccessRate,
      primaryPrivateSucceeded: facts.primaryPrivateSucceeded,
      primaryPrivateFailed: facts.primaryPrivateFailed,
      primaryGroupSucceeded: facts.primaryGroupSucceeded,
      primaryGroupFailed: facts.primaryGroupFailed,
      privatePrimarySuccessRate: facts.privatePrimarySuccessRate,
      groupPrimarySuccessRate: facts.groupPrimarySuccessRate,
      repairableCount: facts.repairableCount,
      staleRecordCount: facts.staleRecordCount,
      fallbackEligibleCount: facts.fallbackEligibleCount,
      fallbackEligiblePrivateCount: facts.fallbackEligiblePrivateCount,
      fallbackEligibleGroupCount: facts.fallbackEligibleGroupCount,
      fallbackFailedEligibleCount: facts.fallbackFailedEligibleCount,
      fallbackStaleEligibleCount: facts.fallbackStaleEligibleCount,
      canaryAvailable: facts.canaryAvailable,
      canaryStreamLength: facts.canaryStreamLength,
      canaryLastResult: facts.canaryLastResult,
      goPrimaryReady: facts.goPrimaryReady,
    },
  };
}
