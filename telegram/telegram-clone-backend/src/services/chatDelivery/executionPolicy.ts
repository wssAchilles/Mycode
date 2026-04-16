import { CHAT_DELIVERY_EVENT_DLQ_STREAM_KEY, CHAT_DELIVERY_EVENT_STREAM_KEY } from './busContracts';
import type { ChatDeliveryDispatchMode, MessageFanoutCommand } from './contracts';

export type ChatDeliveryExecutionMode =
  | 'node_primary'
  | 'shadow_go'
  | 'go_canary'
  | 'go_primary'
  | 'rollback_node';

export type ChatDeliveryCanarySegment = 'projection_bookkeeping';
export type ChatDeliveryTakeoverStage =
  | 'node_primary'
  | 'shadow_go'
  | 'go_canary'
  | 'private_primary'
  | 'group_canary'
  | 'full_primary'
  | 'rollback_node';

export type ChatDeliverySegmentTakeoverStage =
  | 'node_primary'
  | 'go_group_canary'
  | 'go_primary';

export interface ChatDeliveryExecutionPolicySummary {
  mode: ChatDeliveryExecutionMode;
  takeoverStage: ChatDeliveryTakeoverStage;
  requestedMode: string;
  nodePrimary: boolean;
  nodeFallbackOnly: boolean;
  goShadow: boolean;
  goCanary: boolean;
  goPrimary: boolean;
  goPrimaryReady: boolean;
  rollbackActive: boolean;
  segmentStages?: {
    private: ChatDeliverySegmentTakeoverStage;
    group: ChatDeliverySegmentTakeoverStage;
  };
  fallbackStrategy?: 'node_primary' | 'fallback_only';
  streamKey: string;
  dlqStreamKey: string;
  maxRecipientsPerChunk: number;
  primary: {
    privateEnabled: boolean;
    groupEnabled: boolean;
    maxRecipients: number;
    privateMaxRecipients: number;
    groupMaxRecipients: number;
  };
  rollout: {
    bucketStrategy: 'chat_id_hash_mod_100';
    privatePercent: number;
    groupPercent: number;
    chatAllowlistCount: number;
    senderAllowlistCount: number;
    groupChatAllowlistCount: number;
    groupSenderAllowlistCount: number;
  };
  canary: {
    enabled: boolean;
    segment: ChatDeliveryCanarySegment;
    mismatchThreshold: number;
    deadLetterThreshold: number;
    fallbackMode: Extract<ChatDeliveryExecutionMode, 'shadow_go' | 'rollback_node'>;
  };
}

export interface NodeFanoutExecutorDecision {
  execute: boolean;
  reason:
    | ChatDeliveryExecutionMode
    | 'go_group_canary'
    | 'go_primary_not_enabled'
    | 'go_primary_command_missing'
    | 'go_primary_segment_not_enabled'
    | 'go_primary_recipient_limit_exceeded'
    | 'go_primary_chat_not_allowlisted'
    | 'go_primary_sender_not_allowlisted'
    | 'go_primary_rollout_not_selected';
  segment?: 'private' | 'group';
  bucket?: number;
  rolloutPercent?: number;
  dispatchMode?: Extract<ChatDeliveryDispatchMode, 'go_primary' | 'go_group_canary'>;
}

function readMaxRecipientsPerChunk(): number {
  return Math.min(
    Math.max(Number.parseInt(process.env.FANOUT_JOB_RECIPIENTS_MAX || '1500', 10) || 1500, 100),
    10000,
  );
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function readCanarySegment(): ChatDeliveryCanarySegment {
  const value = String(process.env.DELIVERY_CANARY_SEGMENT || 'projection_bookkeeping').trim();
  if (value === 'projection_bookkeeping') {
    return value;
  }
  return 'projection_bookkeeping';
}

function readCsvSet(name: string): Set<string> {
  return new Set(
    String(process.env[name] || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}

function readRolloutPercent(name: string, fallback = 100): number {
  return readIntEnv(name, fallback, 0, 100);
}

function readSegmentMaxRecipients(name: string, fallback: number): number {
  return readIntEnv(name, fallback, 1, 10000);
}

function computeStableBucket(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function normalizeMode(raw: string): ChatDeliveryExecutionMode {
  const value = String(raw || '').trim().toLowerCase();
  if (
    value === 'node_primary'
    || value === 'shadow_go'
    || value === 'go_canary'
    || value === 'go_primary'
    || value === 'rollback_node'
  ) {
    return value;
  }
  return 'node_primary';
}

function resolveTakeoverStage(
  mode: ChatDeliveryExecutionMode,
  goPrimaryReady: boolean,
  privateEnabled: boolean,
  groupEnabled: boolean,
  groupPercent: number,
  groupChatAllowlistCount: number,
  groupSenderAllowlistCount: number,
): ChatDeliveryTakeoverStage {
  if (mode === 'rollback_node') return 'rollback_node';
  if (mode === 'go_canary') return 'go_canary';
  if (mode === 'shadow_go') return 'shadow_go';
  if (mode === 'go_primary' && goPrimaryReady) {
    if (!groupEnabled) {
      return 'private_primary';
    }
    if (groupPercent >= 100 && groupChatAllowlistCount === 0 && groupSenderAllowlistCount === 0) {
      return 'full_primary';
    }
    return 'group_canary';
  }
  return 'node_primary';
}

function resolveSegmentStages(
  takeoverStage: ChatDeliveryTakeoverStage,
  privateEnabled: boolean,
  groupEnabled: boolean,
): { private: ChatDeliverySegmentTakeoverStage; group: ChatDeliverySegmentTakeoverStage } {
  return {
    private:
      privateEnabled
      && (takeoverStage === 'private_primary' || takeoverStage === 'group_canary' || takeoverStage === 'full_primary')
        ? 'go_primary'
        : 'node_primary',
    group:
      !groupEnabled
        ? 'node_primary'
        : takeoverStage === 'full_primary'
          ? 'go_primary'
          : takeoverStage === 'group_canary'
            ? 'go_group_canary'
            : 'node_primary',
  };
}

export function getChatDeliveryExecutionPolicySummary(): ChatDeliveryExecutionPolicySummary {
  const requestedMode = String(process.env.DELIVERY_EXECUTION_MODE || 'shadow_go').trim() || 'shadow_go';
  const mode = normalizeMode(requestedMode);
  const canaryEnabled = mode === 'go_canary' || mode === 'go_primary';
  const privateMaxRecipients = readSegmentMaxRecipients('DELIVERY_GO_PRIMARY_MAX_RECIPIENTS', 2);
  const groupMaxRecipients = readSegmentMaxRecipients(
    'DELIVERY_GO_PRIMARY_GROUP_MAX_RECIPIENTS',
    privateMaxRecipients,
  );
  const chatAllowlist = readCsvSet('DELIVERY_GO_PRIMARY_ALLOW_CHAT_IDS');
  const senderAllowlist = readCsvSet('DELIVERY_GO_PRIMARY_ALLOW_SENDER_IDS');
  const groupChatAllowlist = readCsvSet('DELIVERY_GO_PRIMARY_GROUP_ALLOW_CHAT_IDS');
  const groupSenderAllowlist = readCsvSet('DELIVERY_GO_PRIMARY_GROUP_ALLOW_SENDER_IDS');
  const privateEnabled = readBoolEnv('DELIVERY_GO_PRIMARY_PRIVATE_ENABLED', true);
  const groupEnabled = readBoolEnv('DELIVERY_GO_PRIMARY_GROUP_ENABLED', false);
  const groupPercent = readRolloutPercent('DELIVERY_GO_PRIMARY_GROUP_ROLLOUT_PERCENT', 100);
  const goPrimaryReady =
    mode === 'go_primary'
    && String(process.env.DELIVERY_GO_PRIMARY_READY || '').trim().toLowerCase() === 'true';
  const takeoverStage = resolveTakeoverStage(
    mode,
    goPrimaryReady,
    privateEnabled,
    groupEnabled,
    groupPercent,
    groupChatAllowlist.size,
    groupSenderAllowlist.size,
  );
  const segmentStages = resolveSegmentStages(takeoverStage, privateEnabled, groupEnabled);

  return {
    mode,
    takeoverStage,
    requestedMode,
    nodePrimary: takeoverStage === 'node_primary' || takeoverStage === 'shadow_go' || takeoverStage === 'go_canary' || takeoverStage === 'rollback_node',
    nodeFallbackOnly: takeoverStage === 'private_primary' || takeoverStage === 'group_canary' || takeoverStage === 'full_primary',
    goShadow: mode === 'shadow_go' || mode === 'go_canary' || mode === 'go_primary',
    goCanary: canaryEnabled || takeoverStage === 'group_canary',
    goPrimary: mode === 'go_primary',
    goPrimaryReady,
    rollbackActive: mode === 'rollback_node',
    segmentStages,
    fallbackStrategy: takeoverStage === 'node_primary' || takeoverStage === 'shadow_go' || takeoverStage === 'go_canary' || takeoverStage === 'rollback_node'
      ? 'node_primary'
      : 'fallback_only',
    streamKey: CHAT_DELIVERY_EVENT_STREAM_KEY,
    dlqStreamKey: CHAT_DELIVERY_EVENT_DLQ_STREAM_KEY,
    maxRecipientsPerChunk: readMaxRecipientsPerChunk(),
    primary: {
      privateEnabled,
      groupEnabled,
      maxRecipients: privateMaxRecipients,
      privateMaxRecipients,
      groupMaxRecipients,
    },
    rollout: {
      bucketStrategy: 'chat_id_hash_mod_100',
      privatePercent: readRolloutPercent('DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT', 100),
      groupPercent,
      chatAllowlistCount: chatAllowlist.size,
      senderAllowlistCount: senderAllowlist.size,
      groupChatAllowlistCount: groupChatAllowlist.size,
      groupSenderAllowlistCount: groupSenderAllowlist.size,
    },
    canary: {
      enabled: canaryEnabled,
      segment: readCanarySegment(),
      mismatchThreshold: readIntEnv('DELIVERY_CANARY_MISMATCH_THRESHOLD', 5, 1, 1000),
      deadLetterThreshold: readIntEnv('DELIVERY_CANARY_DLQ_THRESHOLD', 3, 1, 1000),
      fallbackMode: mode === 'rollback_node' ? 'rollback_node' : 'shadow_go',
    },
  };
}

export function shouldNodeExecuteFanoutProjection(
  policy: ChatDeliveryExecutionPolicySummary = getChatDeliveryExecutionPolicySummary(),
  command?: MessageFanoutCommand,
): NodeFanoutExecutorDecision {
  if (policy.mode === 'go_primary' && policy.goPrimaryReady) {
    if (!command) {
      return {
        execute: true,
        reason: 'go_primary_command_missing',
      };
    }
    const segment = command.chatType === 'group' ? 'group' : 'private';
    if (segment === 'private' && !policy.primary.privateEnabled) {
      return {
        execute: true,
        reason: 'go_primary_segment_not_enabled',
        segment,
      };
    }
    if (segment === 'group' && !policy.primary.groupEnabled) {
      return {
        execute: true,
        reason: 'go_primary_segment_not_enabled',
        segment,
      };
    }
    const maxRecipients = segment === 'group'
      ? policy.primary.groupMaxRecipients
      : policy.primary.privateMaxRecipients;
    if (command.recipientIds.length > maxRecipients) {
      return {
        execute: true,
        reason: 'go_primary_recipient_limit_exceeded',
        segment,
      };
    }
    const chatAllowlist = segment === 'group'
      ? readCsvSet('DELIVERY_GO_PRIMARY_GROUP_ALLOW_CHAT_IDS')
      : readCsvSet('DELIVERY_GO_PRIMARY_ALLOW_CHAT_IDS');
    if (chatAllowlist.size && !chatAllowlist.has(command.chatId)) {
      return {
        execute: true,
        reason: 'go_primary_chat_not_allowlisted',
        segment,
      };
    }
    const senderAllowlist = segment === 'group'
      ? readCsvSet('DELIVERY_GO_PRIMARY_GROUP_ALLOW_SENDER_IDS')
      : readCsvSet('DELIVERY_GO_PRIMARY_ALLOW_SENDER_IDS');
    if (senderAllowlist.size && !senderAllowlist.has(command.senderId)) {
      return {
        execute: true,
        reason: 'go_primary_sender_not_allowlisted',
        segment,
      };
    }
    const rolloutPercent = segment === 'group' ? policy.rollout.groupPercent : policy.rollout.privatePercent;
    const bucket = computeStableBucket(command.chatId);
    if (bucket >= rolloutPercent) {
      return {
        execute: true,
        reason: 'go_primary_rollout_not_selected',
        segment,
        bucket,
        rolloutPercent,
      };
    }
    const segmentStage = policy.segmentStages?.[segment]
      || (segment === 'group' && policy.takeoverStage !== 'full_primary' ? 'go_group_canary' : 'go_primary');
    const dispatchMode: Extract<ChatDeliveryDispatchMode, 'go_primary' | 'go_group_canary'> =
      segmentStage === 'go_group_canary' ? 'go_group_canary' : 'go_primary';
    return {
      execute: false,
      reason: dispatchMode === 'go_group_canary' ? 'go_group_canary' : 'go_primary',
      segment,
      bucket,
      rolloutPercent,
      dispatchMode,
    };
  }

  return {
    execute: true,
    reason: policy.mode === 'go_primary' ? 'go_primary_not_enabled' : policy.mode,
  };
}
