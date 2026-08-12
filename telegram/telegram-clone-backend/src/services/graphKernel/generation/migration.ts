import {
  GRAPH_GENERATION_INDEX_DEFINITIONS,
  type GraphGenerationIndexSnapshot,
  verifyGraphGenerationIndexSnapshot,
} from './repository';

export function buildGraphGenerationMigrationDryRunPlan(
  plannedAt = new Date(),
  indexSnapshot?: GraphGenerationIndexSnapshot,
) {
  const plannedAtMs = plannedAt.getTime();
  if (!Number.isSafeInteger(plannedAtMs) || plannedAtMs < 0) {
    throw new Error('graph_generation_migration_time_invalid');
  }

  return {
    mode: 'dry-run' as const,
    plannedAt: plannedAtMs,
    productionApplyAuthorized: false as const,
    applySafe: false as const,
    requiresAuthorization: true as const,
    requiresLeaseGcAtomicity: true as const,
    requiresBoundedInputOrExternalSort: true as const,
    requiresSourceSnapshotTransactionCapacityProof: true as const,
    requiresAtlasIndexExplainAndDdl: true as const,
    requiresGcDeleteLeaseLock: true as const,
    writesPlanned: 0 as const,
    indexVerification: {
      operation: 'verify-only' as const,
      indexes: GRAPH_GENERATION_INDEX_DEFINITIONS,
      result: indexSnapshot
        ? verifyGraphGenerationIndexSnapshot(indexSnapshot)
        : {
            status: 'not_run' as const,
            reason: 'index_snapshot_not_provided' as const,
          },
    },
    build: {
      operation: 'plan-only' as const,
      sourceRead: 'mongodb-snapshot-transaction' as const,
      ordering: ['sourceUserId', 'targetUserId', 'edgeId'] as const,
      collation: 'simple' as const,
      emptyGeneration: 'quarantine' as const,
      storedVerification: ['edgeCount', 'canonicalSha256', 'generationId', 'contentVersion'] as const,
    },
    activation: {
      operation: 'plan-only' as const,
      preconditions: ['ready', 'non-empty', 'stored-verification'] as const,
      pointerWrite: 'compare-and-swap-active-to-previous' as const,
    },
    garbageCollection: {
      operation: 'dry-run' as const,
      retain: ['active', 'previous', 'building', 'unexpired-lease'] as const,
      leaseExpiryClock: 'serverNow' as const,
      ttlPhysicalDeletionRequired: false as const,
    },
  };
}
