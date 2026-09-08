import { describe, expect, it, vi } from 'vitest';

import { buildGraphGenerationMigrationDryRunPlan } from '../../src/services/graphKernel/generation/migration';
import {
  GRAPH_GENERATION_INDEX_DEFINITIONS,
  GRAPH_GENERATION_COLLECTIONS,
  GenerationEdgeSchema,
  GenerationLeaseSchema,
  GenerationManifestSchema,
  GenerationPointerSchema,
  verifyGraphGenerationIndexSnapshot,
} from '../../src/services/graphKernel/generation/repository';
import {
  parseGraphGenerationMigrationArgs,
  runGraphGenerationMigrationCli,
} from '../../src/scripts/migrateGraphKernelGeneration';

function currentIndexSnapshot() {
  return Object.fromEntries(Array.from(
    new Set(GRAPH_GENERATION_INDEX_DEFINITIONS.map(({ collection }) => collection)),
    (collection) => [collection, GRAPH_GENERATION_INDEX_DEFINITIONS
      .filter((definition) => definition.collection === collection)
      .map(({ key, options }) => ({ key: { ...key }, ...options }))],
  ));
}

describe('graph generation migration dry-run contract', () => {
  it('keeps all generation schemas import-safe without implicit collection or index creation', () => {
    for (const schema of [
      GenerationEdgeSchema,
      GenerationManifestSchema,
      GenerationPointerSchema,
      GenerationLeaseSchema,
    ]) {
      expect(schema.options.autoIndex).toBe(false);
      expect(schema.options.autoCreate).toBe(false);
    }
  });

  it('plans index verification, build, activation and GC with no authorized writes', () => {
    const plan = buildGraphGenerationMigrationDryRunPlan(new Date(1000));

    expect(plan).toEqual(expect.objectContaining({
      mode: 'dry-run',
      plannedAt: 1000,
      productionApplyAuthorized: false,
      applySafe: false,
      requiresAuthorization: true,
      requiresLeaseGcAtomicity: true,
      writesPlanned: 0,
      indexVerification: expect.any(Object),
      build: expect.any(Object),
      activation: expect.any(Object),
      garbageCollection: expect.any(Object),
    }));
    expect(plan.indexVerification.indexes).toEqual(GRAPH_GENERATION_INDEX_DEFINITIONS);
    expect(plan.indexVerification.result).toEqual({
      status: 'not_run',
      reason: 'index_snapshot_not_provided',
    });
    expect(GRAPH_GENERATION_INDEX_DEFINITIONS).toContainEqual({
      collection: 'graph_kernel_generation_leases',
      key: { leaseId: 1 },
      options: { unique: true },
    });
    expect(GRAPH_GENERATION_INDEX_DEFINITIONS).toContainEqual({
      collection: GRAPH_GENERATION_COLLECTIONS.manifests,
      key: { status: 1, generationId: 1 },
      options: {},
    });
    expect(GRAPH_GENERATION_INDEX_DEFINITIONS).toContainEqual({
      collection: 'real_graph_edges',
      key: { sourceUserId: 1, targetUserId: 1, _id: 1 },
      options: { collation: { locale: 'simple' } },
    });
    expect(plan).toEqual(expect.objectContaining({
      requiresBoundedInputOrExternalSort: true,
      requiresSourceSnapshotTransactionCapacityProof: true,
      requiresAtlasIndexExplainAndDdl: true,
      requiresGcDeleteLeaseLock: true,
    }));
    expect(GenerationManifestSchema.indexes()).toContainEqual([
      { status: 1, generationId: 1 },
      { background: true },
    ]);
  });

  it('compares injected listIndexes snapshots without database access', () => {
    const snapshot = currentIndexSnapshot();
    expect(verifyGraphGenerationIndexSnapshot(snapshot)).toEqual({
      status: 'ok',
      missing: [],
      mismatched: [],
    });
    const badSnapshot = structuredClone(snapshot);
    badSnapshot[GRAPH_GENERATION_COLLECTIONS.edges][0] = {
      key: { generationId: 1, targetUserId: 1, sourceUserId: 1, edgeId: 1 },
      unique: false,
      collation: { locale: 'en' },
    };
    badSnapshot[GRAPH_GENERATION_COLLECTIONS.leases][1].expireAfterSeconds = 60;
    delete badSnapshot[GRAPH_GENERATION_COLLECTIONS.pointer];

    const result = verifyGraphGenerationIndexSnapshot(badSnapshot);
    expect(result.status).toBe('mismatch');
    expect(result.missing).toContainEqual(expect.objectContaining({
      collection: GRAPH_GENERATION_COLLECTIONS.pointer,
    }));
    expect(result.mismatched).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: GRAPH_GENERATION_COLLECTIONS.edges,
        differences: ['key', 'unique', 'collation'],
      }),
      expect.objectContaining({
        collection: GRAPH_GENERATION_COLLECTIONS.leases,
        differences: ['expireAfterSeconds'],
      }),
    ]));

    expect(buildGraphGenerationMigrationDryRunPlan(new Date(1000), snapshot)
      .indexVerification.result.status).toBe('ok');
  });

  it('rejects partial, sparse or hidden variants of a required index', () => {
    const snapshot = currentIndexSnapshot();
    const actual = {
      key: { generationId: 1, sourceUserId: 1, targetUserId: 1, edgeId: 1 },
      unique: true,
      collation: { locale: 'simple' },
      partialFilterExpression: { generationId: { $exists: true } },
      sparse: true,
      hidden: true,
    };
    snapshot[GRAPH_GENERATION_COLLECTIONS.edges][0] = actual;

    expect(verifyGraphGenerationIndexSnapshot(snapshot).mismatched).toContainEqual(
      expect.objectContaining({
        collection: GRAPH_GENERATION_COLLECTIONS.edges,
        actual,
        differences: ['partialFilterExpression', 'sparse', 'hidden'],
      }),
    );
  });

  it('is import-safe and defaults to a zero-write dry run while rejecting apply', async () => {
    expect(parseGraphGenerationMigrationArgs([])).toEqual({ mode: 'dry-run' });
    expect(parseGraphGenerationMigrationArgs(['--dry-run'])).toEqual({ mode: 'dry-run' });
    expect(() => parseGraphGenerationMigrationArgs(['--apply'])).toThrow(
      'graph_generation_migration_dry_run_only',
    );
    const writeJson = vi.fn();
    const writeError = vi.fn();
    const loadIndexSnapshot = vi.fn().mockResolvedValue(currentIndexSnapshot());

    await expect(runGraphGenerationMigrationCli([], {
      writeJson,
      writeError,
      loadIndexSnapshot,
    })).resolves.toBe(0);
    expect(loadIndexSnapshot).toHaveBeenCalledOnce();
    expect(writeError).not.toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'dry-run',
      productionApplyAuthorized: false,
      writesPlanned: 0,
      indexVerification: expect.objectContaining({
        result: expect.objectContaining({ status: 'ok' }),
      }),
    }));

    const writeVerifiedJson = vi.fn();
    const unusedLoader = vi.fn();
    await expect(runGraphGenerationMigrationCli([], {
      writeJson: writeVerifiedJson,
      writeError,
      loadIndexSnapshot: unusedLoader,
      indexSnapshot: currentIndexSnapshot(),
    })).resolves.toBe(0);
    expect(unusedLoader).not.toHaveBeenCalled();
    expect(writeVerifiedJson).toHaveBeenCalledWith(expect.objectContaining({
      indexVerification: expect.objectContaining({
        result: expect.objectContaining({ status: 'ok' }),
      }),
    }));

    const writeMismatchJson = vi.fn();
    const writeMismatchError = vi.fn();
    await expect(runGraphGenerationMigrationCli([], {
      writeJson: writeMismatchJson,
      writeError: writeMismatchError,
      indexSnapshot: {},
    })).resolves.toBe(3);
    expect(writeMismatchJson).toHaveBeenCalledWith(expect.objectContaining({
      indexVerification: expect.objectContaining({
        result: expect.objectContaining({ status: 'mismatch' }),
      }),
    }));
    expect(writeMismatchError).toHaveBeenCalledWith(
      '[GraphGenerationMigration] failed: graph_generation_index_mismatch',
    );
  });
});
