import type {
  ChatDeliveryChunkStatus,
  ChatDeliveryDispatchMode,
  ChatDeliveryRecoveryMode,
  ChatDeliveryOutboxRecordSnapshot,
  ChatDeliveryOutboxStatus,
  FanoutTopology,
} from './contracts';

export type MinimalChatDeliveryOutboxChunk = {
  chunkIndex: number;
  recipientIds: string[];
  status: ChatDeliveryChunkStatus;
  jobId?: string | null;
  attemptCount: number;
  lastAttemptAt?: Date | null;
  lastErrorMessage?: string | null;
  projection?: {
    recipientCount: number;
    chunkCount: number;
  } | null;
};

export type MinimalChatDeliveryOutbox = {
  _id?: unknown;
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  emittedAt: Date;
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
  recoveryMode?: ChatDeliveryRecoveryMode | null;
  recoveredFromDispatchMode?: ChatDeliveryDispatchMode | null;
  lastRecoveryAt?: Date | null;
  lastDispatchedAt?: Date | null;
  lastCompletedAt?: Date | null;
  lastErrorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
  chunks: MinimalChatDeliveryOutboxChunk[];
};

export type ChatDeliveryConsistencyIssueKind =
  | 'aggregate_drift'
  | 'status_drift'
  | 'queued_jobs_drift'
  | 'stale_record';

export type ChatDeliveryConsistencyInspection = {
  hasIssues: boolean;
  issueKinds: ChatDeliveryConsistencyIssueKind[];
  expectedStatus: ChatDeliveryOutboxStatus;
  expectedQueuedChunkCount: number;
  expectedCompletedChunkCount: number;
  expectedFailedChunkCount: number;
  expectedProjectedRecipientCount: number;
  expectedProjectedChunkCount: number;
  expectedQueuedJobIds: string[];
  repairable: boolean;
  stale: boolean;
};

function toIso(value?: Date | null): string | undefined {
  return value instanceof Date ? value.toISOString() : undefined;
}

function mapChunk(doc: MinimalChatDeliveryOutboxChunk) {
  return {
    chunkIndex: doc.chunkIndex,
    recipientCount: Array.isArray(doc.recipientIds) ? doc.recipientIds.length : 0,
    recipientIds: [...(doc.recipientIds || [])],
    status: doc.status,
    jobId: doc.jobId || undefined,
    attemptCount: doc.attemptCount || 0,
    lastAttemptAt: toIso(doc.lastAttemptAt),
    lastErrorMessage: doc.lastErrorMessage || undefined,
    projection: doc.projection || undefined,
  };
}

function calculateDerivedState(doc: MinimalChatDeliveryOutbox) {
  const chunks = doc.chunks || [];
  const queuedChunkCount = chunks.filter((chunk) => chunk.status === 'queued').length;
  const completedChunkCount = chunks.filter((chunk) => chunk.status === 'completed').length;
  const failedChunkCount = chunks.filter((chunk) => chunk.status === 'failed').length;
  const projectedRecipientCount = chunks.reduce(
    (sum, chunk) => sum + (chunk.projection?.recipientCount || 0),
    0,
  );
  const projectedChunkCount = chunks.reduce(
    (sum, chunk) => sum + (chunk.projection?.chunkCount || 0),
    0,
  );
  const queuedJobIds = chunks.map((chunk) => chunk.jobId).filter((value): value is string => Boolean(value));

  let status: ChatDeliveryOutboxStatus;
  if (doc.dispatchMode === 'sync_fallback') {
    status = 'sync_fallback_completed';
  } else if (!chunks.length) {
    status = 'pending_dispatch';
  } else if (failedChunkCount > 0) {
    status = 'failed';
  } else if (completedChunkCount === chunks.length) {
    status = 'completed';
  } else if (completedChunkCount > 0) {
    status = 'partially_completed';
  } else if (chunks.some((chunk) => chunk.status === 'projecting')) {
    status = 'projecting';
  } else if (queuedChunkCount > 0) {
    status = 'queued';
  } else {
    status = 'pending_dispatch';
  }

  return {
    status,
    queuedChunkCount,
    completedChunkCount,
    failedChunkCount,
    projectedRecipientCount,
    projectedChunkCount,
    queuedJobIds,
  };
}

export function mapOutbox(doc: MinimalChatDeliveryOutbox): ChatDeliveryOutboxRecordSnapshot {
  const rawId = (doc as any)._id;
  return {
    id: String(rawId),
    messageId: doc.messageId,
    chatId: doc.chatId,
    chatType: doc.chatType,
    seq: doc.seq,
    senderId: doc.senderId,
    emittedAt: doc.emittedAt.toISOString(),
    topology: doc.topology,
    dispatchMode: doc.dispatchMode,
    status: doc.status,
    totalRecipientCount: doc.totalRecipientCount,
    chunkCountExpected: doc.chunkCountExpected,
    queuedChunkCount: doc.queuedChunkCount,
    completedChunkCount: doc.completedChunkCount,
    failedChunkCount: doc.failedChunkCount,
    projectedRecipientCount: doc.projectedRecipientCount,
    projectedChunkCount: doc.projectedChunkCount,
    replayCount: doc.replayCount,
    queuedJobIds: [...(doc.queuedJobIds || [])],
    recovery: doc.recoveryMode ? {
      mode: doc.recoveryMode,
      recoveredFromDispatchMode: doc.recoveredFromDispatchMode || undefined,
      lastRecoveryAt: toIso(doc.lastRecoveryAt),
    } : undefined,
    lastDispatchedAt: toIso(doc.lastDispatchedAt),
    lastCompletedAt: toIso(doc.lastCompletedAt),
    lastErrorMessage: doc.lastErrorMessage || undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    chunks: (doc.chunks || []).map(mapChunk),
  };
}

export function recomputeOutboxAggregates(doc: MinimalChatDeliveryOutbox): void {
  const derived = calculateDerivedState(doc);
  doc.queuedChunkCount = derived.queuedChunkCount;
  doc.completedChunkCount = derived.completedChunkCount;
  doc.failedChunkCount = derived.failedChunkCount;
  doc.projectedRecipientCount = derived.projectedRecipientCount;
  doc.projectedChunkCount = derived.projectedChunkCount;
  doc.status = derived.status;
  doc.queuedJobIds = derived.queuedJobIds;
  if ((doc.status === 'completed' || doc.status === 'sync_fallback_completed') && !doc.lastCompletedAt) {
    doc.lastCompletedAt = new Date();
  }
}

export function inspectOutboxConsistency(
  doc: MinimalChatDeliveryOutbox,
  staleBefore: Date,
): ChatDeliveryConsistencyInspection {
  const derived = calculateDerivedState(doc);
  const issueKinds: ChatDeliveryConsistencyIssueKind[] = [];

  if (
    doc.queuedChunkCount !== derived.queuedChunkCount
    || doc.completedChunkCount !== derived.completedChunkCount
    || doc.failedChunkCount !== derived.failedChunkCount
    || doc.projectedRecipientCount !== derived.projectedRecipientCount
    || doc.projectedChunkCount !== derived.projectedChunkCount
  ) {
    issueKinds.push('aggregate_drift');
  }

  if (doc.status !== derived.status) {
    issueKinds.push('status_drift');
  }

  const queuedJobIds = doc.queuedJobIds || [];
  if (
    queuedJobIds.length !== derived.queuedJobIds.length
    || queuedJobIds.some((value, index) => value !== derived.queuedJobIds[index])
  ) {
    issueKinds.push('queued_jobs_drift');
  }

  const staleStatuses = new Set<ChatDeliveryOutboxStatus>(['queued', 'projecting', 'partially_completed']);
  const stale = staleStatuses.has(doc.status) && doc.updatedAt < staleBefore;
  if (stale) {
    issueKinds.push('stale_record');
  }

  return {
    hasIssues: issueKinds.length > 0,
    issueKinds,
    expectedStatus: derived.status,
    expectedQueuedChunkCount: derived.queuedChunkCount,
    expectedCompletedChunkCount: derived.completedChunkCount,
    expectedFailedChunkCount: derived.failedChunkCount,
    expectedProjectedRecipientCount: derived.projectedRecipientCount,
    expectedProjectedChunkCount: derived.projectedChunkCount,
    expectedQueuedJobIds: derived.queuedJobIds,
    repairable: issueKinds.some((kind) => kind !== 'stale_record'),
    stale,
  };
}
