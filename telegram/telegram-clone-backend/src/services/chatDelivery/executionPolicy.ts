import { CHAT_DELIVERY_EVENT_DLQ_STREAM_KEY, CHAT_DELIVERY_EVENT_STREAM_KEY } from './busContracts';

export type ChatDeliveryExecutionMode = 'node_primary' | 'shadow_go';

export interface ChatDeliveryExecutionPolicySummary {
  mode: ChatDeliveryExecutionMode;
  requestedMode: string;
  nodePrimary: boolean;
  goShadow: boolean;
  goPrimaryReady: boolean;
  streamKey: string;
  dlqStreamKey: string;
  maxRecipientsPerChunk: number;
}

function readMaxRecipientsPerChunk(): number {
  return Math.min(
    Math.max(Number.parseInt(process.env.FANOUT_JOB_RECIPIENTS_MAX || '1500', 10) || 1500, 100),
    10000,
  );
}

function normalizeMode(raw: string): ChatDeliveryExecutionMode {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'shadow_go') {
    return 'shadow_go';
  }
  return 'node_primary';
}

export function getChatDeliveryExecutionPolicySummary(): ChatDeliveryExecutionPolicySummary {
  const requestedMode = String(process.env.DELIVERY_EXECUTION_MODE || 'shadow_go').trim() || 'shadow_go';
  const mode = normalizeMode(requestedMode);
  return {
    mode,
    requestedMode,
    nodePrimary: true,
    goShadow: mode === 'shadow_go',
    goPrimaryReady: false,
    streamKey: CHAT_DELIVERY_EVENT_STREAM_KEY,
    dlqStreamKey: CHAT_DELIVERY_EVENT_DLQ_STREAM_KEY,
    maxRecipientsPerChunk: readMaxRecipientsPerChunk(),
  };
}
