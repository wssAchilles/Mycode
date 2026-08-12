import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canonicalizeGenerationEdges } from '../../src/services/graphKernel/generation/canonical';
import type {
  GenerationCursor,
  GenerationEdge,
  GenerationLease,
  GenerationManifest,
  GenerationPointer,
  GenerationStatus,
} from '../../src/services/graphKernel/generation/contracts';
import {
  GenerationManifestSchema,
  MongoGenerationRepository,
  type GenerationRepository,
} from '../../src/services/graphKernel/generation/repository';
import {
  GenerationCasError,
  GenerationLeaseError,
  GenerationService,
  GenerationUnavailableError,
} from '../../src/services/graphKernel/generation/service';

const zeroCounts = {
  followCount: 0,
  likeCount: 0,
  replyCount: 0,
  retweetCount: 0,
  quoteCount: 0,
  mentionCount: 0,
  profileViewCount: 0,
  tweetClickCount: 0,
  dwellTimeMs: 0,
  addressBookCount: 0,
  directMessageCount: 0,
  coEngagementCount: 0,
  contentAffinityCount: 0,
  muteCount: 0,
  blockCount: 0,
  reportCount: 0,
};

function graphEdge(edgeId: string, score = 1): GenerationEdge {
  return {
    sourceUserId: `source-${edgeId}`,
    targetUserId: `target-${edgeId}`,
    edgeId,
    decayedSum: score,
    interactionProbability: 0.5,
    dailySignalCounts: zeroCounts,
    rollupSignalCounts: zeroCounts,
    edgeKinds: ['follow'],
    lastInteractionAtMs: null,
    updatedAtMs: 1,
  };
}

function compareKeyset(edge: GenerationEdge, cursor: GenerationCursor): number {
  return edge.sourceUserId.localeCompare(cursor.afterSourceUserId)
    || edge.targetUserId.localeCompare(cursor.afterTargetUserId)
    || edge.edgeId.localeCompare(cursor.afterEdgeId);
}

function twoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals > 2) return;
    if (arrivals === 2) release();
    await ready;
  };
}

class MemoryGenerationRepository implements GenerationRepository {
  sourceEdges: GenerationEdge[] = [];
  manifests = new Map<string, GenerationManifest>();
  generationEdges = new Map<string, GenerationEdge[]>();
  leases = new Map<string, GenerationLease>();
  pointer: GenerationPointer = {
    activeGenerationId: null,
    previousGenerationId: null,
  };
  storedReadTransform: (edges: GenerationEdge[]) => GenerationEdge[] = (edges) => edges;
  storedReads = 0;
  stageCalls = 0;
  stagedWrites = 0;
  beforeManifestRead?: () => Promise<void>;
  beforeStoredRead?: () => Promise<void>;
  beforeActiveCompare?: () => void;
  beforeRollbackCompare?: () => void;
  gcSnapshotReads = 0;

  async readSourceSnapshotEdges(): Promise<GenerationEdge[]> {
    return this.sourceEdges.map((edge) => structuredClone(edge));
  }

  async stageGeneration(
    manifest: GenerationManifest,
    edges: readonly GenerationEdge[],
  ): Promise<boolean> {
    this.stageCalls += 1;
    if (this.manifests.has(manifest.generationId)) return false;
    this.stagedWrites += 1;
    this.manifests.set(manifest.generationId, {
      ...structuredClone(manifest),
      controlRevision: manifest.controlRevision ?? 0,
    });
    this.generationEdges.set(manifest.generationId, structuredClone(edges));
    return true;
  }

  async getManifest(generationId: string): Promise<GenerationManifest | null> {
    await this.beforeManifestRead?.();
    return structuredClone(this.manifests.get(generationId) ?? null);
  }

  async transitionManifest(
    generationId: string,
    expectedStatus: GenerationStatus,
    status: GenerationStatus,
    diagnostic?: string,
  ): Promise<GenerationManifest | null> {
    const manifest = this.manifests.get(generationId);
    if (!manifest || manifest.status !== expectedStatus) return null;
    const next = { ...manifest, status, ...(diagnostic ? { diagnostic } : {}) };
    this.manifests.set(generationId, next);
    return structuredClone(next);
  }

  async readGenerationEdges(generationId: string): Promise<GenerationEdge[]> {
    this.storedReads += 1;
    await this.beforeStoredRead?.();
    const edges = structuredClone(this.generationEdges.get(generationId) ?? []);
    return this.storedReadTransform(edges);
  }

  async readGenerationPage(
    generationId: string,
    cursor: GenerationCursor | null,
    limit: number,
  ): Promise<GenerationEdge[]> {
    return structuredClone(this.generationEdges.get(generationId) ?? [])
      .filter((edge) => !cursor || compareKeyset(edge, cursor) > 0)
      .slice(0, limit);
  }

  async getPointer(): Promise<GenerationPointer> {
    return { ...this.pointer };
  }

  async compareAndSwapActive(
    expectedActiveGenerationId: string | null,
    generationId: string,
  ): Promise<GenerationPointer | null> {
    this.beforeActiveCompare?.();
    const target = this.manifests.get(generationId);
    if (
      this.pointer.activeGenerationId !== expectedActiveGenerationId
      || target?.status !== 'ready'
      || target.edgeCount < 1
    ) return null;
    target.controlRevision = (target.controlRevision ?? 0) + 1;
    this.pointer = {
      activeGenerationId: generationId,
      previousGenerationId: this.pointer.activeGenerationId,
    };
    return { ...this.pointer };
  }

  async compareAndSwapRollback(
    expectedActiveGenerationId: string,
    expectedPreviousGenerationId: string,
  ): Promise<GenerationPointer | null> {
    this.beforeRollbackCompare?.();
    const target = this.manifests.get(expectedPreviousGenerationId);
    if (
      this.pointer.activeGenerationId !== expectedActiveGenerationId
      || this.pointer.previousGenerationId !== expectedPreviousGenerationId
      || target?.status !== 'ready'
      || target.edgeCount < 1
    ) return null;
    target.controlRevision = (target.controlRevision ?? 0) + 1;
    this.pointer = {
      activeGenerationId: expectedPreviousGenerationId,
      previousGenerationId: expectedActiveGenerationId,
    };
    return { ...this.pointer };
  }

  async createLease(lease: GenerationLease): Promise<void> {
    this.leases.set(lease.leaseId, structuredClone(lease));
  }

  async renewLease(
    generationId: string,
    leaseId: string,
    serverNow: Date,
    expiresAt: Date,
  ): Promise<GenerationLease | null> {
    const lease = this.leases.get(leaseId);
    if (
      !lease
      || lease.generationId !== generationId
      || lease.expiresAt.getTime() <= serverNow.getTime()
    ) return null;
    const renewed = { ...lease, expiresAt };
    this.leases.set(leaseId, renewed);
    return structuredClone(renewed);
  }

  async releaseLease(generationId: string, leaseId: string): Promise<boolean> {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.generationId !== generationId) return false;
    return this.leases.delete(leaseId);
  }

  async readGarbageCollectionSnapshot(serverNow: Date) {
    this.gcSnapshotReads += 1;
    return {
      pointer: { ...this.pointer },
      generationIds: Array.from(new Set([
        ...this.manifests.keys(),
        ...this.generationEdges.keys(),
      ])),
      buildingGenerationIds: Array.from(this.manifests.values())
        .filter((manifest) => manifest.status === 'building')
        .map((manifest) => manifest.generationId),
      unexpiredLeaseGenerationIds: Array.from(this.leases.values())
        .filter((lease) => lease.expiresAt.getTime() > serverNow.getTime())
        .map((lease) => lease.generationId),
    };
  }

  async listGenerationIds(): Promise<string[]> {
    throw new Error('generation_gc_scattered_read_forbidden');
  }

  async listBuildingGenerationIds(): Promise<string[]> {
    throw new Error('generation_gc_scattered_read_forbidden');
  }

  async listUnexpiredLeaseGenerationIds(_serverNow: Date): Promise<string[]> {
    throw new Error('generation_gc_scattered_read_forbidden');
  }
}

async function seedReadyGeneration(
  repository: MemoryGenerationRepository,
  edge: GenerationEdge,
  createdAt = new Date(0),
): Promise<GenerationManifest> {
  const canonical = canonicalizeGenerationEdges([edge]);
  const manifest: GenerationManifest = {
    generationId: canonical.generationId,
    contentVersion: canonical.contentVersion,
    status: 'ready',
    edgeCount: canonical.edges.length,
    canonicalSha256: canonical.canonicalSha256,
    createdAt,
  };
  await repository.stageGeneration(manifest, canonical.edges);
  return manifest;
}

describe('graph generation lifecycle contract', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stages manifest and ordered edges atomically in one required Mongo transaction', async () => {
    const canonical = canonicalizeGenerationEdges([graphEdge('stage-failure')]);
    const manifest: GenerationManifest = {
      generationId: canonical.generationId,
      contentVersion: canonical.contentVersion,
      status: 'building',
      edgeCount: 1,
      canonicalSha256: canonical.canonicalSha256,
      createdAt: new Date(1),
    };
    let manifestVisible = false;
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => {
        try {
          await operation();
        } catch (error) {
          manifestVisible = false;
          throw error;
        }
      }),
      endSession: vi.fn(),
    };
    const startSession = vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const manifestCreate = vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'create',
    ).mockImplementation(async () => {
      manifestVisible = true;
      return [] as never;
    });
    const edgeInsert = vi.spyOn(
      mongoose.models.GraphKernelGenerationEdge!,
      'insertMany',
    ).mockRejectedValue(new Error('stage_edge_insert_failed'));

    await expect(new MongoGenerationRepository().stageGeneration(
      manifest,
      canonical.edges,
    )).rejects.toThrow('stage_edge_insert_failed');

    expect(startSession).toHaveBeenCalledOnce();
    expect(session.withTransaction).toHaveBeenCalledOnce();
    expect(manifestCreate).toHaveBeenCalledWith([manifest], { session });
    expect(edgeInsert).toHaveBeenCalledWith([
      { ...canonical.edges[0], generationId: manifest.generationId },
    ], { ordered: true, session });
    expect(manifestVisible).toBe(false);
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('fails closed before staging when Mongo transactions are unavailable', async () => {
    const canonical = canonicalizeGenerationEdges([graphEdge('no-transaction')]);
    const manifest: GenerationManifest = {
      generationId: canonical.generationId,
      contentVersion: canonical.contentVersion,
      status: 'building',
      edgeCount: 1,
      canonicalSha256: canonical.canonicalSha256,
      createdAt: new Date(1),
    };
    const session = { endSession: vi.fn() };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const manifestCreate = vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'create',
    ).mockResolvedValue([] as never);
    const edgeInsert = vi.spyOn(
      mongoose.models.GraphKernelGenerationEdge!,
      'insertMany',
    ).mockResolvedValue([] as never);

    await expect(new MongoGenerationRepository().stageGeneration(
      manifest,
      canonical.edges,
    )).rejects.toThrow('generation_stage_transaction_unsupported');
    expect(manifestCreate).not.toHaveBeenCalled();
    expect(edgeInsert).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('normalizes only duplicate-key staging races to false', async () => {
    const canonical = canonicalizeGenerationEdges([graphEdge('duplicate-stage')]);
    const manifest: GenerationManifest = {
      generationId: canonical.generationId,
      contentVersion: canonical.contentVersion,
      status: 'building',
      edgeCount: 1,
      canonicalSha256: canonical.canonicalSha256,
      createdAt: new Date(1),
    };
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => operation()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'create',
    ).mockRejectedValue(Object.assign(new Error('duplicate generation'), { code: 11000 }));
    const edgeInsert = vi.spyOn(
      mongoose.models.GraphKernelGenerationEdge!,
      'insertMany',
    ).mockResolvedValue([] as never);

    await expect(new MongoGenerationRepository().stageGeneration(
      manifest,
      canonical.edges,
    )).resolves.toBe(false);
    expect(edgeInsert).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('rechecks a ready activation target with the pointer CAS in one Mongo transaction', async () => {
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => operation()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const targetLean = vi.fn().mockResolvedValue({ generationId: 'target', status: 'ready' });
    const targetUpdate = vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: targetLean } as never);
    const pointerLean = vi.fn().mockResolvedValue({
      activeGenerationId: 'target',
      previousGenerationId: null,
    });
    const pointerUpdate = vi.spyOn(
      mongoose.models.GraphKernelGenerationPointer!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: pointerLean } as never);

    await expect(new MongoGenerationRepository().compareAndSwapActive(
      null,
      'target',
    )).resolves.toEqual({
      activeGenerationId: 'target',
      previousGenerationId: null,
    });

    expect(session.withTransaction).toHaveBeenCalledOnce();
    expect(GenerationManifestSchema.path('controlRevision')?.options.default).toBe(0);
    expect(targetUpdate).toHaveBeenCalledWith(
      { generationId: 'target', status: 'ready', edgeCount: { $gte: 1 } },
      { $inc: { controlRevision: 1 } },
      { new: true, session },
    );
    expect(pointerUpdate).toHaveBeenCalledWith(
      { singletonKey: 'graph-kernel-generation', activeGenerationId: null },
      {
        $set: { activeGenerationId: 'target', previousGenerationId: null },
        $setOnInsert: { singletonKey: 'graph-kernel-generation' },
      },
      { new: true, upsert: true, session },
    );
    expect(targetUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      pointerUpdate.mock.invocationCallOrder[0],
    );
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('does not leak an activation result across transaction callback retries', async () => {
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => {
        await operation();
        await operation();
      }),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const targetLean = vi.fn()
      .mockResolvedValueOnce({ generationId: 'target', status: 'ready' })
      .mockResolvedValueOnce(null);
    vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: targetLean } as never);
    const pointerLean = vi.fn().mockResolvedValue({
      activeGenerationId: 'target',
      previousGenerationId: null,
    });
    vi.spyOn(
      mongoose.models.GraphKernelGenerationPointer!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: pointerLean } as never);

    await expect(new MongoGenerationRepository().compareAndSwapActive(
      null,
      'target',
    )).resolves.toBeNull();
    expect(targetLean).toHaveBeenCalledTimes(2);
    expect(pointerLean).toHaveBeenCalledOnce();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('rechecks a ready rollback target with the pointer CAS in one Mongo transaction', async () => {
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => operation()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const targetLean = vi.fn().mockResolvedValue({ generationId: 'previous', status: 'ready' });
    const targetUpdate = vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: targetLean } as never);
    const pointerLean = vi.fn().mockResolvedValue({
      activeGenerationId: 'previous',
      previousGenerationId: 'active',
    });
    const pointerUpdate = vi.spyOn(
      mongoose.models.GraphKernelGenerationPointer!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: pointerLean } as never);

    await expect(new MongoGenerationRepository().compareAndSwapRollback(
      'active',
      'previous',
    )).resolves.toEqual({
      activeGenerationId: 'previous',
      previousGenerationId: 'active',
    });

    expect(session.withTransaction).toHaveBeenCalledOnce();
    expect(targetUpdate).toHaveBeenCalledWith(
      { generationId: 'previous', status: 'ready', edgeCount: { $gte: 1 } },
      { $inc: { controlRevision: 1 } },
      { new: true, session },
    );
    expect(pointerUpdate).toHaveBeenCalledWith(
      {
        singletonKey: 'graph-kernel-generation',
        activeGenerationId: 'active',
        previousGenerationId: 'previous',
      },
      {
        $set: {
          activeGenerationId: 'previous',
          previousGenerationId: 'active',
        },
      },
      { new: true, session },
    );
    expect(targetUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      pointerUpdate.mock.invocationCallOrder[0],
    );
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('does not leak a rolled-back pointer result across transaction callback retries', async () => {
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => {
        await operation();
        await operation();
      }),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const targetLean = vi.fn()
      .mockResolvedValueOnce({ generationId: 'previous', status: 'ready' })
      .mockResolvedValueOnce(null);
    vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: targetLean } as never);
    const pointerLean = vi.fn().mockResolvedValue({
      activeGenerationId: 'previous',
      previousGenerationId: 'active',
    });
    vi.spyOn(
      mongoose.models.GraphKernelGenerationPointer!,
      'findOneAndUpdate',
    ).mockReturnValue({ lean: pointerLean } as never);

    await expect(new MongoGenerationRepository().compareAndSwapRollback(
      'active',
      'previous',
    )).resolves.toBeNull();
    expect(targetLean).toHaveBeenCalledTimes(2);
    expect(pointerLean).toHaveBeenCalledOnce();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('reads all garbage-collection state from one Mongo snapshot transaction', async () => {
    const session = {
      withTransaction: vi.fn(async (operation: () => Promise<void>) => operation()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const pointerLean = vi.fn().mockResolvedValue({
      activeGenerationId: 'active',
      previousGenerationId: 'previous',
    });
    const pointerSession = vi.fn().mockReturnValue({ lean: pointerLean });
    vi.spyOn(
      mongoose.models.GraphKernelGenerationPointer!,
      'findOne',
    ).mockReturnValue({ session: pointerSession } as never);
    const allManifestSession = vi.fn().mockResolvedValue(['active', 'building', 'orphan']);
    const buildingSession = vi.fn().mockResolvedValue(['building']);
    const manifestDistinct = vi.spyOn(
      mongoose.models.GraphKernelGenerationManifest!,
      'distinct',
    )
      .mockReturnValueOnce({ session: allManifestSession } as never)
      .mockReturnValueOnce({ session: buildingSession } as never);
    const edgeSession = vi.fn().mockResolvedValue(['edge-only']);
    vi.spyOn(
      mongoose.models.GraphKernelGenerationEdge!,
      'distinct',
    ).mockReturnValue({ session: edgeSession } as never);
    const leaseSession = vi.fn().mockResolvedValue(['leased']);
    const leaseDistinct = vi.spyOn(
      mongoose.models.GraphKernelGenerationLease!,
      'distinct',
    ).mockReturnValue({ session: leaseSession } as never);
    const serverNow = new Date(1000);

    await expect(new MongoGenerationRepository().readGarbageCollectionSnapshot(
      serverNow,
    )).resolves.toEqual({
      pointer: {
        activeGenerationId: 'active',
        previousGenerationId: 'previous',
      },
      generationIds: ['active', 'building', 'orphan', 'edge-only'],
      buildingGenerationIds: ['building'],
      unexpiredLeaseGenerationIds: ['leased'],
    });

    expect(session.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { readConcern: { level: 'snapshot' } },
    );
    expect(pointerSession).toHaveBeenCalledWith(session);
    expect(manifestDistinct).toHaveBeenNthCalledWith(1, 'generationId');
    expect(manifestDistinct).toHaveBeenNthCalledWith(2, 'generationId', { status: 'building' });
    expect(allManifestSession).toHaveBeenCalledWith(session);
    expect(buildingSession).toHaveBeenCalledWith(session);
    expect(edgeSession).toHaveBeenCalledWith(session);
    expect(leaseDistinct).toHaveBeenCalledWith(
      'generationId',
      { expiresAt: { $gt: serverNow } },
    );
    expect(leaseSession).toHaveBeenCalledWith(session);
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('classifies a source snapshot failure once while preserving its cause message', async () => {
    const session = {
      withTransaction: vi.fn().mockRejectedValue(new Error('snapshot_failed')),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);

    await expect(new GenerationService(
      new MongoGenerationRepository(),
    ).buildGeneration()).rejects.toThrow(
      /^generation_source_snapshot_quarantined:snapshot_failed$/,
    );
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('does not move the pointer or expose partial state when staging fails', async () => {
    const repository = new MemoryGenerationRepository();
    repository.sourceEdges = [graphEdge('stage-failure')];
    repository.stageGeneration = async () => {
      throw new Error('stage_failed');
    };
    const service = new GenerationService(repository);

    await expect(service.buildAndActivate(null)).rejects.toThrow('stage_failed');
    expect(repository.pointer).toEqual({
      activeGenerationId: null,
      previousGenerationId: null,
    });
    expect(repository.manifests.size).toBe(0);
    expect(repository.generationEdges.size).toBe(0);
  });

  it('quarantines an empty source generation without touching the pointer', async () => {
    const repository = new MemoryGenerationRepository();
    const service = new GenerationService(repository, { now: () => new Date(1000) });

    const result = await service.buildAndActivate(null);

    expect(result.manifest.status).toBe('quarantined');
    expect(result.manifest.edgeCount).toBe(0);
    expect(result.pointer).toBeNull();
    expect(repository.pointer.activeGenerationId).toBeNull();
  });

  it('reuses the same verified ready generation without staging it twice', async () => {
    const repository = new MemoryGenerationRepository();
    repository.sourceEdges = [graphEdge('unchanged-ready')];
    const service = new GenerationService(repository, { now: () => new Date(1000) });

    const first = await service.buildGeneration();
    const second = await service.buildGeneration();

    expect(second).toEqual(first);
    expect(second.status).toBe('ready');
    expect(repository.stageCalls).toBe(1);
    expect(repository.storedReads).toBe(2);
  });

  it('converges concurrent first builds on one ready generation without duplicate failure', async () => {
    const repository = new MemoryGenerationRepository();
    repository.sourceEdges = [graphEdge('concurrent-first-build')];
    repository.beforeManifestRead = twoPartyBarrier();
    repository.beforeStoredRead = twoPartyBarrier();
    const firstService = new GenerationService(repository, { now: () => new Date(1000) });
    const secondService = new GenerationService(repository, { now: () => new Date(1000) });

    const [first, second] = await Promise.all([
      firstService.buildGeneration(),
      secondService.buildGeneration(),
    ]);

    expect(first).toEqual(second);
    expect(first.status).toBe('ready');
    expect(repository.stageCalls).toBe(2);
    expect(repository.stagedWrites).toBe(1);
    expect(repository.manifests.size).toBe(1);
    expect(repository.generationEdges.size).toBe(1);
  });

  it('finishes a committed building generation without staging it twice', async () => {
    const repository = new MemoryGenerationRepository();
    const canonical = canonicalizeGenerationEdges([graphEdge('unchanged-building')]);
    const building: GenerationManifest = {
      generationId: canonical.generationId,
      contentVersion: canonical.contentVersion,
      status: 'building',
      edgeCount: canonical.edges.length,
      canonicalSha256: canonical.canonicalSha256,
      createdAt: new Date(500),
    };
    await repository.stageGeneration(building, canonical.edges);
    repository.sourceEdges = canonical.edges;

    const recovered = await new GenerationService(repository).buildGeneration();

    expect(recovered).toEqual({ ...building, status: 'ready', controlRevision: 0 });
    expect(repository.stageCalls).toBe(1);
  });

  it('keeps an unchanged quarantined generation fail closed without restaging', async () => {
    const repository = new MemoryGenerationRepository();
    const service = new GenerationService(repository, { now: () => new Date(1000) });

    const first = await service.buildGeneration();
    const second = await service.buildGeneration();

    expect(second).toEqual(first);
    expect(second.status).toBe('quarantined');
    expect(repository.stageCalls).toBe(1);
  });

  it('quarantines stored count or hash drift before touching the pointer', async () => {
    for (const transform of [
      (edges: GenerationEdge[]) => edges.slice(1),
      (edges: GenerationEdge[]) => edges.map((edge) => ({ ...edge, decayedSum: edge.decayedSum + 1 })),
    ]) {
      const repository = new MemoryGenerationRepository();
      repository.sourceEdges = [graphEdge('a'), graphEdge('b')];
      repository.storedReadTransform = transform;
      const service = new GenerationService(repository, { now: () => new Date(1000) });

      const result = await service.buildAndActivate(null);

      expect(result.manifest.status).toBe('quarantined');
      expect(result.pointer).toBeNull();
      expect(repository.pointer.activeGenerationId).toBeNull();
    }
  });

  it('activates only verified generations with CAS and atomically rolls back to ready previous', async () => {
    const repository = new MemoryGenerationRepository();
    const service = new GenerationService(repository, { now: () => new Date(1000) });
    repository.sourceEdges = [graphEdge('first')];
    const first = await service.buildAndActivate(null);
    expect(first.manifest.status).toBe('ready');
    expect(first.pointer?.activeGenerationId).toBe(first.manifest.generationId);

    repository.sourceEdges = [graphEdge('second')];
    const second = await service.buildGeneration();
    await expect(
      service.activateGeneration(second.generationId, 'stale-active'),
    ).rejects.toBeInstanceOf(GenerationCasError);
    expect(repository.pointer.activeGenerationId).toBe(first.manifest.generationId);

    const activated = await service.activateGeneration(
      second.generationId,
      first.manifest.generationId,
    );
    expect(activated).toEqual({
      activeGenerationId: second.generationId,
      previousGenerationId: first.manifest.generationId,
    });

    const rolledBack = await service.rollbackGeneration(second.generationId);
    expect(rolledBack).toEqual({
      activeGenerationId: first.manifest.generationId,
      previousGenerationId: second.generationId,
    });

    repository.manifests.get(second.generationId)!.status = 'quarantined';
    await expect(
      service.rollbackGeneration(first.manifest.generationId),
    ).rejects.toBeInstanceOf(GenerationUnavailableError);
    expect(repository.pointer.activeGenerationId).toBe(first.manifest.generationId);
  });

  it('fails rollback CAS if the verified target is quarantined concurrently', async () => {
    const repository = new MemoryGenerationRepository();
    const previous = await seedReadyGeneration(repository, graphEdge('previous-race'));
    const active = await seedReadyGeneration(repository, graphEdge('active-race'));
    repository.pointer = {
      activeGenerationId: active.generationId,
      previousGenerationId: previous.generationId,
    };
    repository.beforeRollbackCompare = () => {
      repository.manifests.get(previous.generationId)!.status = 'quarantined';
    };

    await expect(new GenerationService(repository).rollbackGeneration(
      active.generationId,
    )).rejects.toBeInstanceOf(GenerationCasError);
    expect(repository.pointer).toEqual({
      activeGenerationId: active.generationId,
      previousGenerationId: previous.generationId,
    });
  });

  it('fails activation CAS if the verified target is quarantined concurrently', async () => {
    const repository = new MemoryGenerationRepository();
    const target = await seedReadyGeneration(repository, graphEdge('activation-race'));
    repository.beforeActiveCompare = () => {
      repository.manifests.get(target.generationId)!.status = 'quarantined';
    };

    await expect(new GenerationService(repository).activateGeneration(
      target.generationId,
      null,
    )).rejects.toBeInstanceOf(GenerationCasError);
    expect(repository.pointer).toEqual({
      activeGenerationId: null,
      previousGenerationId: null,
    });
  });

  it('fails closed when manifest generation identity does not match its stored digest', async () => {
    for (const mismatch of ['generationId', 'contentVersion'] as const) {
      const repository = new MemoryGenerationRepository();
      const canonical = canonicalizeGenerationEdges([graphEdge(mismatch)]);
      const manifest: GenerationManifest = {
        generationId: mismatch === 'generationId'
          ? `graph_generation_v2:${'0'.repeat(64)}`
          : canonical.generationId,
        contentVersion: mismatch === 'contentVersion'
          ? `sha256:${'0'.repeat(64)}`
          : canonical.contentVersion,
        status: 'ready',
        edgeCount: canonical.edges.length,
        canonicalSha256: canonical.canonicalSha256,
        createdAt: new Date(1),
      };
      await repository.stageGeneration(manifest, canonical.edges);
      const service = new GenerationService(repository);

      await expect(
        service.activateGeneration(manifest.generationId, null),
      ).rejects.toBeInstanceOf(GenerationUnavailableError);
      expect(repository.pointer.activeGenerationId).toBeNull();
      expect(repository.manifests.get(manifest.generationId)?.status).toBe('quarantined');
    }
  });

  it('fails closed when a continuation cursor reads zero ready-generation edges', async () => {
    const repository = new MemoryGenerationRepository();
    const manifest = await seedReadyGeneration(repository, graphEdge('page-empty'));
    await repository.createLease({
      generationId: manifest.generationId,
      leaseId: 'lease-empty-page',
      expiresAt: new Date(20_000),
    });
    const service = new GenerationService(repository, { now: () => new Date(10_000) });

    await expect(service.pageGeneration({
      limit: 1,
      leaseId: 'lease-empty-page',
      cursor: {
        generationId: manifest.generationId,
        afterSourceUserId: 'zzzz',
        afterTargetUserId: 'zzzz',
        afterEdgeId: 'zzzz',
      },
    })).rejects.toBeInstanceOf(GenerationUnavailableError);
  });

  it('renews leases by server time and GC retains only pointer and unexpired lease generations', async () => {
    let nowMs = 10_000;
    let leaseSequence = 0;
    const repository = new MemoryGenerationRepository();
    const previous = await seedReadyGeneration(repository, graphEdge('previous'));
    const activeCanonical = canonicalizeGenerationEdges([graphEdge('active-a'), graphEdge('active-b')]);
    const active: GenerationManifest = {
      generationId: activeCanonical.generationId,
      contentVersion: activeCanonical.contentVersion,
      status: 'ready',
      edgeCount: 2,
      canonicalSha256: activeCanonical.canonicalSha256,
      createdAt: new Date(1),
    };
    await repository.stageGeneration(active, activeCanonical.edges);
    const leased = await seedReadyGeneration(repository, graphEdge('leased'));
    const expired = await seedReadyGeneration(repository, graphEdge('expired'));
    const buildingCanonical = canonicalizeGenerationEdges([graphEdge('building')]);
    const building: GenerationManifest = {
      generationId: buildingCanonical.generationId,
      contentVersion: buildingCanonical.contentVersion,
      status: 'building',
      edgeCount: 1,
      canonicalSha256: buildingCanonical.canonicalSha256,
      createdAt: new Date(2),
    };
    await repository.stageGeneration(building, buildingCanonical.edges);
    repository.pointer = {
      activeGenerationId: 'not-ready',
      previousGenerationId: previous.generationId,
    };
    const service = new GenerationService(repository, {
      now: () => new Date(nowMs),
      leaseDurationMs: 5_000,
      createLeaseId: () => `lease-${++leaseSequence}`,
    });

    await expect(service.pageGeneration({ limit: 1 })).rejects.toBeInstanceOf(
      GenerationUnavailableError,
    );
    expect(repository.leases.size).toBe(0);
    repository.pointer.activeGenerationId = active.generationId;

    const firstPage = await service.pageGeneration({ limit: 1 });
    expect(firstPage.expiresAt).toBe(15_000);
    expect(firstPage.manifest.createdAt).toBe(1);
    expect(firstPage.edges).toHaveLength(1);
    expect(firstPage.done).toBe(false);
    expect(firstPage.nextCursor?.generationId).toBe(active.generationId);

    nowMs = 12_000;
    const nextPage = await service.pageGeneration({
      limit: 1,
      leaseId: firstPage.leaseId,
      cursor: firstPage.nextCursor!,
    });
    expect(nextPage.expiresAt).toBe(17_000);
    expect(nextPage.done).toBe(true);

    await service.releaseGenerationLease(active.generationId, firstPage.leaseId);
    await expect(service.pageGeneration({
      limit: 1,
      leaseId: firstPage.leaseId,
      cursor: firstPage.nextCursor!,
    })).rejects.toBeInstanceOf(GenerationLeaseError);

    const expiringPage = await service.pageGeneration({ limit: 1 });
    nowMs = expiringPage.expiresAt;
    await expect(service.pageGeneration({
      limit: 1,
      leaseId: expiringPage.leaseId,
      cursor: expiringPage.nextCursor!,
    })).rejects.toBeInstanceOf(GenerationLeaseError);
    expect(repository.leases.has(expiringPage.leaseId)).toBe(true);

    await repository.createLease({
      generationId: leased.generationId,
      leaseId: 'unexpired-loader',
      expiresAt: new Date(nowMs + 1),
    });
    await repository.createLease({
      generationId: expired.generationId,
      leaseId: 'expired-loader',
      expiresAt: new Date(nowMs),
    });
    const gc = await service.planGarbageCollection();
    expect(repository.gcSnapshotReads).toBe(1);
    expect(gc.dryRun).toBe(true);
    expect(new Set(gc.retainedGenerationIds)).toEqual(new Set([
      active.generationId,
      previous.generationId,
      leased.generationId,
      building.generationId,
    ]));
    expect(gc.candidateGenerationIds).toEqual([expired.generationId]);
  });
});
