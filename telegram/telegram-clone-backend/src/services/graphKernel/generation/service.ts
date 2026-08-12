import { randomUUID } from 'node:crypto';

import { canonicalizeGenerationEdges } from './canonical';
import type {
  GenerationCursor,
  GenerationGarbageCollectionPlan,
  GenerationLease,
  GenerationManifest,
  GenerationPage,
  GenerationPageRequest,
  GenerationPointer,
  GenerationWireManifest,
} from './contracts';
import {
  mongoGenerationRepository,
  type GenerationRepository,
} from './repository';

const DEFAULT_LEASE_DURATION_MS = 30_000;
const MAX_PAGE_LIMIT = 5000;

export class GenerationUnavailableError extends Error {}
export class GenerationCasError extends Error {}
export class GenerationLeaseError extends Error {}

interface GenerationServiceOptions {
  now?: () => Date;
  leaseDurationMs?: number;
  createLeaseId?: () => string;
}

export class GenerationService {
  private readonly now: () => Date;
  private readonly leaseDurationMs: number;
  private readonly createLeaseId: () => string;

  constructor(
    private readonly repository: GenerationRepository,
    options: GenerationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.createLeaseId = options.createLeaseId ?? randomUUID;
    if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs < 1) {
      throw new Error('generation_lease_duration_invalid');
    }
  }

  async buildGeneration(): Promise<GenerationManifest> {
    let sourceEdges;
    try {
      sourceEdges = await this.repository.readSourceSnapshotEdges();
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : String(error);
      throw new GenerationUnavailableError(`generation_source_snapshot_quarantined:${diagnostic}`);
    }
    const canonical = canonicalizeGenerationEdges(sourceEdges);
    const existing = await this.repository.getManifest(canonical.generationId);
    if (existing) return this.resumeExistingGeneration(existing);

    const manifest: GenerationManifest = {
      generationId: canonical.generationId,
      contentVersion: canonical.contentVersion,
      status: 'building',
      edgeCount: canonical.edges.length,
      canonicalSha256: canonical.canonicalSha256,
      createdAt: this.serverNow(),
    };
    const staged = await this.repository.stageGeneration(manifest, canonical.edges);
    if (!staged) {
      const concurrent = await this.repository.getManifest(manifest.generationId);
      if (!concurrent) {
        throw new GenerationUnavailableError('generation_stage_duplicate_manifest_missing');
      }
      return this.resumeExistingGeneration(concurrent);
    }

    if (manifest.edgeCount === 0) {
      return this.transitionOrThrow(manifest, 'quarantined', 'empty_generation');
    }
    return this.verifyBuildingGeneration(manifest);
  }

  async buildAndActivate(
    expectedActiveGenerationId: string | null,
  ): Promise<{ manifest: GenerationManifest; pointer: GenerationPointer | null }> {
    const manifest = await this.buildGeneration();
    if (manifest.status !== 'ready') return { manifest, pointer: null };
    return {
      manifest,
      pointer: await this.activateGeneration(manifest.generationId, expectedActiveGenerationId),
    };
  }

  async activateGeneration(
    generationId: string,
    expectedActiveGenerationId: string | null,
  ): Promise<GenerationPointer> {
    if (generationId === expectedActiveGenerationId) {
      throw new GenerationCasError('generation_activation_target_already_active');
    }
    await this.requireVerifiedReadyGeneration(generationId);
    const pointer = await this.repository.compareAndSwapActive(
      expectedActiveGenerationId,
      generationId,
    );
    if (!pointer) throw new GenerationCasError('generation_activation_stale_cas');
    return pointer;
  }

  async rollbackGeneration(expectedActiveGenerationId: string): Promise<GenerationPointer> {
    const pointer = await this.repository.getPointer();
    if (pointer.activeGenerationId !== expectedActiveGenerationId) {
      throw new GenerationCasError('generation_rollback_stale_active');
    }
    const target = pointer.previousGenerationId;
    if (!target) throw new GenerationUnavailableError('generation_rollback_target_missing');
    await this.requireVerifiedReadyGeneration(target);
    const swapped = await this.repository.compareAndSwapRollback(
      expectedActiveGenerationId,
      target,
    );
    if (!swapped) throw new GenerationCasError('generation_rollback_stale_cas');
    return swapped;
  }

  async pageGeneration(request: GenerationPageRequest): Promise<GenerationPage> {
    const limit = requirePageLimit(request.limit);
    const serverNow = this.serverNow();
    const continuation = request.leaseId !== undefined || request.cursor !== undefined;
    let generationId: string;
    let lease: GenerationLease;
    let manifest: GenerationManifest & { status: 'ready' };

    if (continuation) {
      if (!request.leaseId || !request.cursor) {
        throw new GenerationLeaseError('generation_lease_continuation_incomplete');
      }
      generationId = request.cursor.generationId;
      const expiresAt = this.leaseExpiry(serverNow);
      const renewed = await this.repository.renewLease(
        generationId,
        request.leaseId,
        serverNow,
        expiresAt,
      );
      if (!renewed) throw new GenerationLeaseError('generation_lease_invalid_or_expired');
      lease = renewed;
      manifest = await this.requireReadyGeneration(generationId);
    } else {
      const pointer = await this.repository.getPointer();
      generationId = pointer.activeGenerationId ?? '';
      if (!generationId) throw new GenerationUnavailableError('generation_active_missing');
      manifest = await this.requireReadyGeneration(generationId);
      lease = {
        generationId,
        leaseId: this.createLeaseId(),
        expiresAt: this.leaseExpiry(serverNow),
      };
      await this.repository.createLease(lease);
    }

    const cursor = continuation ? request.cursor! : null;
    const rows = await this.repository.readGenerationPage(generationId, cursor, limit + 1);
    if (rows.length === 0) {
      throw new GenerationUnavailableError('generation_page_empty_before_manifest_end');
    }
    const hasMore = rows.length > limit;
    const edges = rows.slice(0, limit);
    const last = edges[edges.length - 1];
    const nextCursor: GenerationCursor | null = hasMore && last
      ? {
          generationId,
          afterSourceUserId: last.sourceUserId,
          afterTargetUserId: last.targetUserId,
          afterEdgeId: last.edgeId,
        }
      : null;

    return {
      generationId,
      leaseId: lease.leaseId,
      expiresAt: epochMs(lease.expiresAt, 'generation_lease_expires_at_invalid'),
      manifest: wireManifest(manifest),
      edges,
      nextCursor,
      done: !hasMore,
    };
  }

  async releaseGenerationLease(generationId: string, leaseId: string): Promise<void> {
    if (!await this.repository.releaseLease(generationId, leaseId)) {
      throw new GenerationLeaseError('generation_lease_not_found');
    }
  }

  async planGarbageCollection(): Promise<GenerationGarbageCollectionPlan> {
    const serverNow = this.serverNow();
    const snapshot = await this.repository.readGarbageCollectionSnapshot(serverNow);
    const retained = new Set<string>([
      ...snapshot.unexpiredLeaseGenerationIds,
      ...snapshot.buildingGenerationIds,
    ]);
    if (snapshot.pointer.activeGenerationId) retained.add(snapshot.pointer.activeGenerationId);
    if (snapshot.pointer.previousGenerationId) retained.add(snapshot.pointer.previousGenerationId);
    return {
      dryRun: true,
      serverNow,
      retainedGenerationIds: Array.from(retained),
      candidateGenerationIds: snapshot.generationIds
        .filter((generationId) => !retained.has(generationId)),
    };
  }

  private async verifyBuildingGeneration(manifest: GenerationManifest): Promise<GenerationManifest> {
    const stored = await this.canonicalStoredGeneration(manifest.generationId, 'building');
    if (!manifestMatchesCanonical(manifest, stored)) {
      return this.transitionOrThrow(manifest, 'quarantined', 'stored_count_or_hash_mismatch');
    }
    return this.transitionOrThrow(manifest, 'ready');
  }

  private async resumeExistingGeneration(manifest: GenerationManifest): Promise<GenerationManifest> {
    if (manifest.status === 'ready') {
      return this.requireVerifiedReadyGeneration(manifest.generationId);
    }
    if (manifest.status === 'building') {
      if (manifest.edgeCount === 0) {
        return this.transitionOrThrow(manifest, 'quarantined', 'empty_generation');
      }
      return this.verifyBuildingGeneration(manifest);
    }
    return manifest;
  }

  private async requireReadyGeneration(
    generationId: string,
  ): Promise<GenerationManifest & { status: 'ready' }> {
    const manifest = await this.repository.getManifest(generationId);
    if (!manifest || manifest.status !== 'ready' || manifest.edgeCount < 1) {
      throw new GenerationUnavailableError('generation_not_ready');
    }
    return { ...manifest, status: 'ready' };
  }

  private async requireVerifiedReadyGeneration(generationId: string): Promise<GenerationManifest> {
    const manifest = await this.requireReadyGeneration(generationId);
    const stored = await this.canonicalStoredGeneration(generationId, 'ready');
    if (!manifestMatchesCanonical(manifest, stored)) {
      await this.transitionOrThrow(manifest, 'quarantined', 'stored_count_or_hash_mismatch');
      throw new GenerationUnavailableError('generation_verification_failed');
    }
    return manifest;
  }

  private async canonicalStoredGeneration(
    generationId: string,
    expectedStatus: 'building' | 'ready',
  ) {
    try {
      return canonicalizeGenerationEdges(await this.repository.readGenerationEdges(generationId));
    } catch (error) {
      const manifest = await this.repository.getManifest(generationId);
      if (manifest && manifest.status === expectedStatus) {
        const message = error instanceof Error ? error.message : String(error);
        await this.transitionOrThrow(manifest, 'quarantined', `stored_canonical_invalid:${message}`);
      }
      throw new GenerationUnavailableError('generation_stored_canonical_invalid');
    }
  }

  private async transitionOrThrow(
    manifest: GenerationManifest,
    status: 'ready' | 'quarantined',
    diagnostic?: string,
  ): Promise<GenerationManifest> {
    const transitioned = await this.repository.transitionManifest(
      manifest.generationId,
      manifest.status,
      status,
      diagnostic,
    );
    if (!transitioned) {
      const current = await this.repository.getManifest(manifest.generationId);
      if (status === 'ready' && current?.status === 'ready') {
        return this.requireVerifiedReadyGeneration(current.generationId);
      }
      if (status === 'quarantined' && current?.status === 'quarantined') return current;
      throw new GenerationCasError('generation_manifest_stale_cas');
    }
    return transitioned;
  }

  private serverNow(): Date {
    const now = this.now();
    epochMs(now, 'generation_server_time_invalid');
    return now;
  }

  private leaseExpiry(serverNow: Date): Date {
    const expiresAtMs = serverNow.getTime() + this.leaseDurationMs;
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) {
      throw new GenerationLeaseError('generation_lease_expiry_invalid');
    }
    return new Date(expiresAtMs);
  }
}

function requirePageLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new GenerationLeaseError('generation_page_limit_invalid');
  }
  return value;
}

function epochMs(value: Date, error: string): number {
  const milliseconds = value.getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error(error);
  return milliseconds;
}

function wireManifest(
  manifest: GenerationManifest & { status: 'ready' },
): GenerationWireManifest {
  return {
    generationId: manifest.generationId,
    contentVersion: manifest.contentVersion,
    status: manifest.status,
    edgeCount: manifest.edgeCount,
    canonicalSha256: manifest.canonicalSha256,
    createdAt: epochMs(manifest.createdAt, 'generation_manifest_created_at_invalid'),
    ...(manifest.diagnostic ? { diagnostic: manifest.diagnostic } : {}),
  };
}

function manifestMatchesCanonical(
  manifest: GenerationManifest,
  canonical: ReturnType<typeof canonicalizeGenerationEdges>,
): boolean {
  return /^[a-f0-9]{64}$/.test(manifest.canonicalSha256)
    && manifest.edgeCount === canonical.edges.length
    && manifest.canonicalSha256 === canonical.canonicalSha256
    && manifest.generationId === canonical.generationId
    && manifest.contentVersion === canonical.contentVersion;
}

export const graphKernelGenerationService = new GenerationService(mongoGenerationRepository);
