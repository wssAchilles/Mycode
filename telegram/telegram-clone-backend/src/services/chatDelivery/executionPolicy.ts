import { CHAT_DELIVERY_EVENT_DLQ_STREAM_KEY, CHAT_DELIVERY_EVENT_STREAM_KEY } from './busContracts';
import type { MessageFanoutCommand } from './contracts';

export type ChatDeliveryExecutionMode =
  | 'node_primary'
  | 'shadow_go'
  | 'go_canary'
  | 'go_primary'
  | 'rollback_node';

export type ChatDeliveryCanarySegment = 'projection_bookkeeping';

export interface ChatDeliveryExecutionPolicySummary {
  mode: ChatDeliveryExecutionMode;
  requestedMode: string;
  nodePrimary: boolean;
  goShadow: boolean;
  goCanary: boolean;
  goPrimary: boolean;
  goPrimaryReady: boolean;
  rollbackActive: boolean;
  streamKey: string;
  dlqStreamKey: string;
  maxRecipientsPerChunk: number;
  primary: {
    privateEnabled: boolean;
    groupEnabled: boolean;
    maxRecipients: number;
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
    | 'go_primary_not_enabled'
    | 'go_primary_command_missing'
    | 'go_primary_segment_not_enabled'
    | 'go_primary_recipient_limit_exceeded';
  segment?: 'private' | 'group';
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

function readBoolEnv(name: string, fallback: boolean): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
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

export function getChatDeliveryExecutionPolicySummary(): ChatDeliveryExecutionPolicySummary {
  const requestedMode = String(process.env.DELIVERY_EXECUTION_MODE || 'shadow_go').trim() || 'shadow_go';
  const mode = normalizeMode(requestedMode);
  const canaryEnabled = mode === 'go_canary' || mode === 'go_primary';
  const primaryMaxRecipients = readIntEnv('DELIVERY_GO_PRIMARY_MAX_RECIPIENTS', 2, 1, 10000);
  return {
    mode,
    requestedMode,
    nodePrimary: mode !== 'go_primary',
    goShadow: mode === 'shadow_go' || mode === 'go_canary' || mode === 'go_primary',
    goCanary: canaryEnabled,
    goPrimary: mode === 'go_primary',
    goPrimaryReady:
      mode === 'go_primary'
      && String(process.env.DELIVERY_GO_PRIMARY_READY || '').trim().toLowerCase() === 'true',
    rollbackActive: mode === 'rollback_node',
    streamKey: CHAT_DELIVERY_EVENT_STREAM_KEY,
    dlqStreamKey: CHAT_DELIVERY_EVENT_DLQ_STREAM_KEY,
    maxRecipientsPerChunk: readMaxRecipientsPerChunk(),
    primary: {
      privateEnabled: readBoolEnv('DELIVERY_GO_PRIMARY_PRIVATE_ENABLED', true),
      groupEnabled: readBoolEnv('DELIVERY_GO_PRIMARY_GROUP_ENABLED', false),
      maxRecipients: primaryMaxRecipients,
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
    if (command.recipientIds.length > policy.primary.maxRecipients) {
      return {
        execute: true,
        reason: 'go_primary_recipient_limit_exceeded',
        segment,
      };
    }
    return {
      execute: false,
      reason: 'go_primary',
      segment,
    };
  }

  return {
    execute: true,
    reason: policy.mode === 'go_primary' ? 'go_primary_not_enabled' : policy.mode,
  };
}
