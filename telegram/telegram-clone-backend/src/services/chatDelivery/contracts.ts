export type FanoutTopology = 'eager' | 'large_group_compat';

export type ChatDeliveryDispatchMode = 'queued' | 'go_primary' | 'go_group_canary' | 'sync_fallback' | 'skipped';
export type ChatDeliveryRecoveryMode = 'legacy_replay';
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
  dispatchMode?: ChatDeliveryDispatchMode;
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
  recovery?: {
    mode: ChatDeliveryRecoveryMode;
    recoveredFromDispatchMode?: ChatDeliveryDispatchMode;
    lastRecoveryAt?: string;
  };
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
  countsByRecoveryMode: Partial<Record<ChatDeliveryRecoveryMode, number>>;
  recentRecords: ChatDeliveryOutboxRecordSnapshot[];
}

export type ChatDeliveryPrimaryFallbackReason = 'failed_outbox' | 'stale_outbox';

export interface ChatDeliveryPrimaryFallbackCandidate {
  outboxId: string;
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  dispatchMode: Extract<ChatDeliveryDispatchMode, 'go_primary' | 'go_group_canary'>;
  status: ChatDeliveryOutboxStatus;
  reason: ChatDeliveryPrimaryFallbackReason;
  replayCount: number;
  updatedAt: string;
  pendingChunkCount: number;
  recoverable: boolean;
  blockedReason?: 'no_replayable_chunks';
}

export interface ChatDeliveryPrimaryFallbackSummary {
  scannedRecords: number;
  staleThresholdMinutes: number;
  eligibleCount: number;
  failedEligibleCount: number;
  staleEligibleCount: number;
  eligiblePrivateCount: number;
  eligibleGroupCount: number;
  countsByDispatchMode: Partial<Record<Extract<ChatDeliveryDispatchMode, 'go_primary' | 'go_group_canary'>, number>>;
  blockedCount: number;
  recentCandidates: ChatDeliveryPrimaryFallbackCandidate[];
  lastScannedAt: string;
}

export interface ChatDeliveryPrimaryFallbackReplayResult extends ChatDeliveryPrimaryFallbackSummary {
  replayedRecords: number;
  replayedChunks: number;
  skippedRecords: number;
  queuedJobIds: string[];
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
    dispatchQueuedLegacy: number;
    dispatchQueuedGoPrimary: number;
    dispatchQueuedGoGroupCanary: number;
    dispatchFallback: number;
    dispatchSkipped: number;
    projectionSuccess: number;
    projectionErrors: number;
  };
  recentEvents: ChatDeliveryAuditEvent[];
  outbox?: ChatDeliveryOutboxSummary;
}
