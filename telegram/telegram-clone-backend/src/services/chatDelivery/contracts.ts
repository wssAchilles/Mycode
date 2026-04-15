export type FanoutTopology = 'eager' | 'large_group_compat';

export type ChatDeliveryDispatchMode = 'queued' | 'go_primary' | 'sync_fallback' | 'skipped';
export type ChatDeliveryChunkStatus = 'pending' | 'queued' | 'projecting' | 'completed' | 'failed';
export type ChatDeliveryOutboxStatus =
  | 'pending_dispatch'
  | 'queued'
  | 'projecting'
  | 'partially_completed'
  | 'completed'
  | 'failed'
  | 'sync_fallback_completed';

export interface MessageFanoutDeliveryMetadata {
  outboxId?: string;
  chunkIndex?: number;
  chunkCount?: number;
  totalRecipientCount?: number;
  replayCount?: number;
}

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
  delivery?: MessageFanoutDeliveryMetadata;
}

export interface MessageFanoutProjectionResult {
  recipientCount: number;
  chunkCount: number;
}

export interface MessageFanoutDispatchResult {
  mode: ChatDeliveryDispatchMode;
  recipientCount: number;
  jobId?: string;
  jobCount: number;
  projection?: MessageFanoutProjectionResult;
  skippedReason?: string;
  outboxId?: string;
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

export interface ChatDeliveryOutboxChunkSnapshot {
  chunkIndex: number;
  recipientCount: number;
  recipientIds: string[];
  status: ChatDeliveryChunkStatus;
  jobId?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  lastErrorMessage?: string;
  projection?: MessageFanoutProjectionResult;
}

export interface ChatDeliveryOutboxRecordSnapshot {
  id: string;
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  emittedAt: string;
  topology: FanoutTopology;
  dispatchMode: ChatDeliveryDispatchMode | null;
  status: ChatDeliveryOutboxStatus;
  totalRecipientCount: number;
  chunkCountExpected: number;
  queuedChunkCount: number;
  completedChunkCount: number;
  failedChunkCount: number;
  projectedRecipientCount: number;
  projectedChunkCount: number;
  replayCount: number;
  queuedJobIds: string[];
  lastDispatchedAt?: string;
  lastCompletedAt?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  chunks: ChatDeliveryOutboxChunkSnapshot[];
}

export interface ChatDeliveryOutboxSummary {
  countsByStatus: Partial<Record<ChatDeliveryOutboxStatus, number>>;
  countsByDispatchMode: Partial<Record<Exclude<ChatDeliveryDispatchMode, 'skipped'>, number>>;
  recentRecords: ChatDeliveryOutboxRecordSnapshot[];
}

export interface ChatDeliveryReplayResult {
  scannedRecords: number;
  replayedRecords: number;
  replayedChunks: number;
  skippedRecords: number;
  queuedJobIds: string[];
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
  outbox?: ChatDeliveryOutboxSummary;
}
