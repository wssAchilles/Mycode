export type FanoutTopology = 'eager' | 'large_group_compat';

export interface MessageFanoutCommand {
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  recipientIds: string[];
  emittedAt: string;
  metadata: {
    topology: FanoutTopology;
  };
}

export interface MessageFanoutProjectionResult {
  recipientCount: number;
  chunkCount: number;
}

export type MessageFanoutDispatchMode = 'queued' | 'sync_fallback' | 'skipped';

export interface MessageFanoutDispatchResult {
  mode: MessageFanoutDispatchMode;
  recipientCount: number;
  jobId?: string;
  jobCount: number;
  projection?: MessageFanoutProjectionResult;
  skippedReason?: string;
}

export type ChatDeliveryAuditEventKind =
  | 'dispatch_queued'
  | 'dispatch_sync_fallback'
  | 'dispatch_skipped'
  | 'projection_succeeded'
  | 'projection_failed';

export interface ChatDeliveryAuditEvent {
  id: string;
  kind: ChatDeliveryAuditEventKind;
  at: string;
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  recipientCount: number;
  jobId?: string;
  jobCount?: number;
  skippedReason?: string;
  errorMessage?: string;
  projection?: MessageFanoutProjectionResult;
  topology: FanoutTopology;
}

export interface ChatDeliverySnapshot {
  totals: {
    dispatchQueued: number;
    dispatchFallback: number;
    dispatchSkipped: number;
    projectionSuccess: number;
    projectionErrors: number;
  };
  recentEvents: ChatDeliveryAuditEvent[];
}
