import mongoose, { Schema, Types, type ClientSession, type Model } from 'mongoose';

import RealGraphEdge from '../../../models/RealGraphEdge';
import type {
  GenerationCursor,
  GenerationEdge,
  GenerationGarbageCollectionSnapshot,
  GenerationLease,
  GenerationManifest,
  GenerationPointer,
  GenerationSignalCounts,
  GenerationStatus,
} from './contracts';

const SIMPLE_COLLATION = { locale: 'simple' } as const;
const POINTER_SINGLETON_KEY = 'graph-kernel-generation';
const SCAN_BATCH_SIZE = 1000;

export const GRAPH_GENERATION_COLLECTIONS = {
  edges: 'graph_kernel_generation_edges',
  manifests: 'graph_kernel_generation_manifests',
  pointer: 'graph_kernel_generation_pointer',
  leases: 'graph_kernel_generation_leases',
} as const;

export const GRAPH_GENERATION_INDEX_DEFINITIONS = [
  {
    collection: 'real_graph_edges',
    key: { sourceUserId: 1, targetUserId: 1, _id: 1 },
    options: { collation: SIMPLE_COLLATION },
  },
  {
    collection: GRAPH_GENERATION_COLLECTIONS.edges,
    key: { generationId: 1, sourceUserId: 1, targetUserId: 1, edgeId: 1 },
    options: { unique: true, collation: SIMPLE_COLLATION },
  },
  {
    collection: GRAPH_GENERATION_COLLECTIONS.manifests,
    key: { generationId: 1 },
    options: { unique: true },
  },
  {
    collection: GRAPH_GENERATION_COLLECTIONS.manifests,
    key: { status: 1, generationId: 1 },
    options: {},
  },
  {
    collection: GRAPH_GENERATION_COLLECTIONS.pointer,
    key: { singletonKey: 1 },
    options: { unique: true },
  },
  {
    collection: GRAPH_GENERATION_COLLECTIONS.leases,
    key: { leaseId: 1 },
    options: { unique: true },
  },
  {
    collection: GRAPH_GENERATION_COLLECTIONS.leases,
    key: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 },
  },
  {
    collection: GRAPH_GENERATION_COLLECTIONS.leases,
    key: { generationId: 1, expiresAt: 1 },
    options: {},
  },
] as const;

export interface GraphGenerationListIndex {
  key: Record<string, number>;
  unique?: boolean;
  collation?: { locale?: string };
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
  sparse?: boolean;
  hidden?: boolean;
}

export type GraphGenerationIndexSnapshot = Record<
  string,
  readonly GraphGenerationListIndex[] | undefined
>;

export function verifyGraphGenerationIndexSnapshot(snapshot: GraphGenerationIndexSnapshot) {
  const missing: Array<(typeof GRAPH_GENERATION_INDEX_DEFINITIONS)[number]> = [];
  const mismatched: Array<{
    collection: string;
    required: (typeof GRAPH_GENERATION_INDEX_DEFINITIONS)[number];
    actual: GraphGenerationListIndex;
    differences: string[];
  }> = [];

  for (const required of GRAPH_GENERATION_INDEX_DEFINITIONS) {
    const requiredFields = Object.keys(required.key);
    const indexes = snapshot[required.collection] ?? [];
    const sameFields = (index: GraphGenerationListIndex) => {
      const actualFields = Object.keys(index.key);
      return actualFields.length === requiredFields.length
        && requiredFields.every((field) => actualFields.includes(field));
    };
    const actual = indexes.find((index) => (
      sameFields(index) && sameIndexKey(required.key, index.key)
    )) ?? indexes.find(sameFields);
    if (!actual) {
      missing.push(required);
      continue;
    }

    const options = required.options as {
      unique?: boolean;
      collation?: { locale?: string };
      expireAfterSeconds?: number;
    };
    const differences: string[] = [];
    if (!sameIndexKey(required.key, actual.key)) differences.push('key');
    if (Boolean(options.unique) !== Boolean(actual.unique)) differences.push('unique');
    if ((options.collation?.locale ?? null) !== (actual.collation?.locale ?? null)) {
      differences.push('collation');
    }
    if ((options.expireAfterSeconds ?? null) !== (actual.expireAfterSeconds ?? null)) {
      differences.push('expireAfterSeconds');
    }
    if (actual.partialFilterExpression !== undefined) differences.push('partialFilterExpression');
    if (actual.sparse === true) differences.push('sparse');
    if (actual.hidden === true) differences.push('hidden');
    if (differences.length > 0) {
      mismatched.push({ collection: required.collection, required, actual, differences });
    }
  }

  return {
    status: missing.length === 0 && mismatched.length === 0 ? 'ok' as const : 'mismatch' as const,
    missing,
    mismatched,
  };
}

function sameIndexKey(
  required: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): boolean {
  const requiredEntries = Object.entries(required);
  const actualEntries = Object.entries(actual);
  return requiredEntries.length === actualEntries.length
    && requiredEntries.every(([field, direction], index) => (
      actualEntries[index]?.[0] === field && actualEntries[index]?.[1] === direction
    ));
}

interface StoredGenerationEdge extends GenerationEdge {
  generationId: string;
}

interface StoredGenerationPointer extends GenerationPointer {
  singletonKey: string;
}

export const GenerationEdgeSchema = new Schema<StoredGenerationEdge>({
  generationId: { type: String, required: true },
  sourceUserId: { type: String, required: true },
  targetUserId: { type: String, required: true },
  edgeId: { type: String, required: true },
  decayedSum: { type: Number, required: true },
  interactionProbability: { type: Number, required: true },
  dailySignalCounts: { type: Schema.Types.Mixed, required: true },
  rollupSignalCounts: { type: Schema.Types.Mixed, required: true },
  edgeKinds: { type: [String], required: true },
  lastInteractionAtMs: { type: Number, default: null },
  updatedAtMs: { type: Number, default: null },
}, {
  collection: GRAPH_GENERATION_COLLECTIONS.edges,
  autoIndex: false,
  autoCreate: false,
  versionKey: false,
});
GenerationEdgeSchema.index(
  { generationId: 1, sourceUserId: 1, targetUserId: 1, edgeId: 1 },
  { unique: true, collation: SIMPLE_COLLATION },
);

export const GenerationManifestSchema = new Schema<GenerationManifest>({
  generationId: { type: String, required: true },
  contentVersion: { type: String, required: true },
  status: { type: String, enum: ['building', 'ready', 'quarantined'], required: true },
  controlRevision: { type: Number, default: 0, min: 0 },
  edgeCount: { type: Number, required: true, min: 0 },
  canonicalSha256: { type: String, required: true },
  createdAt: { type: Date, required: true },
  diagnostic: { type: String },
}, {
  collection: GRAPH_GENERATION_COLLECTIONS.manifests,
  autoIndex: false,
  autoCreate: false,
  versionKey: false,
});
GenerationManifestSchema.index({ generationId: 1 }, { unique: true });
GenerationManifestSchema.index({ status: 1, generationId: 1 });

export const GenerationPointerSchema = new Schema<StoredGenerationPointer>({
  singletonKey: { type: String, required: true },
  activeGenerationId: { type: String, default: null },
  previousGenerationId: { type: String, default: null },
}, {
  collection: GRAPH_GENERATION_COLLECTIONS.pointer,
  autoIndex: false,
  autoCreate: false,
  versionKey: false,
});
GenerationPointerSchema.index({ singletonKey: 1 }, { unique: true });

export const GenerationLeaseSchema = new Schema<GenerationLease>({
  generationId: { type: String, required: true },
  leaseId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, {
  collection: GRAPH_GENERATION_COLLECTIONS.leases,
  autoIndex: false,
  autoCreate: false,
  versionKey: false,
});
GenerationLeaseSchema.index({ leaseId: 1 }, { unique: true });
GenerationLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
GenerationLeaseSchema.index({ generationId: 1, expiresAt: 1 });

const GenerationEdgeModel = model<StoredGenerationEdge>(
  'GraphKernelGenerationEdge',
  GenerationEdgeSchema,
);
const GenerationManifestModel = model<GenerationManifest>(
  'GraphKernelGenerationManifest',
  GenerationManifestSchema,
);
const GenerationPointerModel = model<StoredGenerationPointer>(
  'GraphKernelGenerationPointer',
  GenerationPointerSchema,
);
const GenerationLeaseModel = model<GenerationLease>(
  'GraphKernelGenerationLease',
  GenerationLeaseSchema,
);

function model<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export interface GenerationRepository {
  readSourceSnapshotEdges(): Promise<GenerationEdge[]>;
  stageGeneration(manifest: GenerationManifest, edges: readonly GenerationEdge[]): Promise<boolean>;
  getManifest(generationId: string): Promise<GenerationManifest | null>;
  transitionManifest(
    generationId: string,
    expectedStatus: GenerationStatus,
    status: GenerationStatus,
    diagnostic?: string,
  ): Promise<GenerationManifest | null>;
  readGenerationEdges(generationId: string): Promise<GenerationEdge[]>;
  readGenerationPage(
    generationId: string,
    cursor: GenerationCursor | null,
    limit: number,
  ): Promise<GenerationEdge[]>;
  getPointer(): Promise<GenerationPointer>;
  compareAndSwapActive(
    expectedActiveGenerationId: string | null,
    generationId: string,
  ): Promise<GenerationPointer | null>;
  compareAndSwapRollback(
    expectedActiveGenerationId: string,
    expectedPreviousGenerationId: string,
  ): Promise<GenerationPointer | null>;
  createLease(lease: GenerationLease): Promise<void>;
  renewLease(
    generationId: string,
    leaseId: string,
    serverNow: Date,
    expiresAt: Date,
  ): Promise<GenerationLease | null>;
  releaseLease(generationId: string, leaseId: string): Promise<boolean>;
  readGarbageCollectionSnapshot(
    serverNow: Date,
  ): Promise<GenerationGarbageCollectionSnapshot>;
}

export class MongoGenerationRepository implements GenerationRepository {
  async readSourceSnapshotEdges(): Promise<GenerationEdge[]> {
    const session = await mongoose.startSession();
    let result: GenerationEdge[] | undefined;
    try {
      if (typeof session.withTransaction !== 'function') {
        throw new Error('generation_source_snapshot_transaction_unsupported');
      }
      await session.withTransaction(async () => {
        result = await scanSourceEdges(session);
      }, { readConcern: { level: 'snapshot' } });
      if (!result) throw new Error('generation_source_snapshot_transaction_incomplete');
      return result;
    } finally {
      await session.endSession();
    }
  }

  async stageGeneration(
    manifest: GenerationManifest,
    edges: readonly GenerationEdge[],
  ): Promise<boolean> {
    const session = await mongoose.startSession();
    let completed = false;
    try {
      if (typeof session.withTransaction !== 'function') {
        throw new Error('generation_stage_transaction_unsupported');
      }
      await session.withTransaction(async () => {
        completed = false;
        await GenerationManifestModel.create([manifest], { session });
        if (edges.length > 0) {
          await GenerationEdgeModel.insertMany(edges.map((edge) => ({
            ...edge,
            generationId: manifest.generationId,
          })), { ordered: true, session });
        }
        completed = true;
      });
      if (!completed) throw new Error('generation_stage_transaction_incomplete');
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async getManifest(generationId: string): Promise<GenerationManifest | null> {
    return GenerationManifestModel.findOne({ generationId }).lean();
  }

  async transitionManifest(
    generationId: string,
    expectedStatus: GenerationStatus,
    status: GenerationStatus,
    diagnostic?: string,
  ): Promise<GenerationManifest | null> {
    const $set: { status: GenerationStatus; diagnostic?: string } = { status };
    if (diagnostic) $set.diagnostic = diagnostic;
    return GenerationManifestModel.findOneAndUpdate(
      { generationId, status: expectedStatus },
      { $set },
      { new: true },
    ).lean();
  }

  async readGenerationEdges(generationId: string): Promise<GenerationEdge[]> {
    const edges: GenerationEdge[] = [];
    let cursor: GenerationCursor | null = null;
    while (true) {
      const page = await this.readGenerationPage(generationId, cursor, SCAN_BATCH_SIZE);
      edges.push(...page);
      if (page.length < SCAN_BATCH_SIZE) return edges;
      const last = page[page.length - 1];
      cursor = {
        generationId,
        afterSourceUserId: last.sourceUserId,
        afterTargetUserId: last.targetUserId,
        afterEdgeId: last.edgeId,
      };
    }
  }

  async readGenerationPage(
    generationId: string,
    cursor: GenerationCursor | null,
    limit: number,
  ): Promise<GenerationEdge[]> {
    const filter: Record<string, unknown> = { generationId };
    if (cursor) filter.$or = keysetFilter(cursor);
    const rows = await GenerationEdgeModel.find(filter)
      .select({
        _id: 0,
        generationId: 0,
        sourceUserId: 1,
        targetUserId: 1,
        edgeId: 1,
        decayedSum: 1,
        interactionProbability: 1,
        dailySignalCounts: 1,
        rollupSignalCounts: 1,
        edgeKinds: 1,
        lastInteractionAtMs: 1,
        updatedAtMs: 1,
      })
      .sort({ sourceUserId: 1, targetUserId: 1, edgeId: 1 })
      .collation(SIMPLE_COLLATION)
      .limit(limit)
      .lean();
    return rows as unknown as GenerationEdge[];
  }

  async getPointer(): Promise<GenerationPointer> {
    const pointer = await GenerationPointerModel.findOne({
      singletonKey: POINTER_SINGLETON_KEY,
    }).lean();
    return pointer
      ? {
          activeGenerationId: pointer.activeGenerationId ?? null,
          previousGenerationId: pointer.previousGenerationId ?? null,
        }
      : { activeGenerationId: null, previousGenerationId: null };
  }

  async compareAndSwapActive(
    expectedActiveGenerationId: string | null,
    generationId: string,
  ): Promise<GenerationPointer | null> {
    const session = await mongoose.startSession();
    let completed = false;
    let result: GenerationPointer | null = null;
    try {
      if (typeof session.withTransaction !== 'function') {
        throw new Error('generation_activation_transaction_unsupported');
      }
      await session.withTransaction(async () => {
        completed = false;
        result = null;
        const target = await GenerationManifestModel.findOneAndUpdate(
          { generationId, status: 'ready', edgeCount: { $gte: 1 } },
          { $inc: { controlRevision: 1 } },
          { new: true, session },
        ).lean();
        if (!target) {
          completed = true;
          return;
        }
        const pointer = await GenerationPointerModel.findOneAndUpdate(
          {
            singletonKey: POINTER_SINGLETON_KEY,
            activeGenerationId: expectedActiveGenerationId,
          },
          {
            $set: {
              activeGenerationId: generationId,
              previousGenerationId: expectedActiveGenerationId,
            },
            $setOnInsert: { singletonKey: POINTER_SINGLETON_KEY },
          },
          { new: true, upsert: expectedActiveGenerationId === null, session },
        ).lean();
        if (pointer) {
          result = {
            activeGenerationId: pointer.activeGenerationId ?? null,
            previousGenerationId: pointer.previousGenerationId ?? null,
          };
        }
        completed = true;
      }, { readConcern: { level: 'snapshot' } });
      if (!completed) throw new Error('generation_activation_transaction_incomplete');
      return result;
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async compareAndSwapRollback(
    expectedActiveGenerationId: string,
    expectedPreviousGenerationId: string,
  ): Promise<GenerationPointer | null> {
    const session = await mongoose.startSession();
    let completed = false;
    let result: GenerationPointer | null = null;
    try {
      if (typeof session.withTransaction !== 'function') {
        throw new Error('generation_rollback_transaction_unsupported');
      }
      await session.withTransaction(async () => {
        completed = false;
        result = null;
        const target = await GenerationManifestModel.findOneAndUpdate(
          {
            generationId: expectedPreviousGenerationId,
            status: 'ready',
            edgeCount: { $gte: 1 },
          },
          { $inc: { controlRevision: 1 } },
          { new: true, session },
        ).lean();
        if (!target) {
          completed = true;
          return;
        }
        const pointer = await GenerationPointerModel.findOneAndUpdate(
          {
            singletonKey: POINTER_SINGLETON_KEY,
            activeGenerationId: expectedActiveGenerationId,
            previousGenerationId: expectedPreviousGenerationId,
          },
          {
            $set: {
              activeGenerationId: expectedPreviousGenerationId,
              previousGenerationId: expectedActiveGenerationId,
            },
          },
          { new: true, session },
        ).lean();
        if (pointer) {
          result = {
            activeGenerationId: pointer.activeGenerationId ?? null,
            previousGenerationId: pointer.previousGenerationId ?? null,
          };
        }
        completed = true;
      }, { readConcern: { level: 'snapshot' } });
      if (!completed) throw new Error('generation_rollback_transaction_incomplete');
      return result;
    } finally {
      await session.endSession();
    }
  }

  async createLease(lease: GenerationLease): Promise<void> {
    await GenerationLeaseModel.create(lease);
  }

  async renewLease(
    generationId: string,
    leaseId: string,
    serverNow: Date,
    expiresAt: Date,
  ): Promise<GenerationLease | null> {
    return GenerationLeaseModel.findOneAndUpdate(
      { generationId, leaseId, expiresAt: { $gt: serverNow } },
      { $set: { expiresAt } },
      { new: true },
    ).lean();
  }

  async releaseLease(generationId: string, leaseId: string): Promise<boolean> {
    const result = await GenerationLeaseModel.deleteOne({ generationId, leaseId });
    return result.deletedCount === 1;
  }

  async readGarbageCollectionSnapshot(
    serverNow: Date,
  ): Promise<GenerationGarbageCollectionSnapshot> {
    const session = await mongoose.startSession();
    let result: GenerationGarbageCollectionSnapshot | undefined;
    try {
      if (typeof session.withTransaction !== 'function') {
        throw new Error('generation_gc_snapshot_transaction_unsupported');
      }
      await session.withTransaction(async () => {
        const pointer = await GenerationPointerModel.findOne({
          singletonKey: POINTER_SINGLETON_KEY,
        }).session(session).lean();
        const manifestIds = await GenerationManifestModel
          .distinct('generationId')
          .session(session);
        const edgeIds = await GenerationEdgeModel
          .distinct('generationId')
          .session(session);
        const buildingGenerationIds = await GenerationManifestModel
          .distinct('generationId', { status: 'building' })
          .session(session);
        const unexpiredLeaseGenerationIds = await GenerationLeaseModel
          .distinct('generationId', { expiresAt: { $gt: serverNow } })
          .session(session);
        result = {
          pointer: pointer
            ? {
                activeGenerationId: pointer.activeGenerationId ?? null,
                previousGenerationId: pointer.previousGenerationId ?? null,
              }
            : { activeGenerationId: null, previousGenerationId: null },
          generationIds: Array.from(new Set([...manifestIds, ...edgeIds])),
          buildingGenerationIds,
          unexpiredLeaseGenerationIds,
        };
      }, { readConcern: { level: 'snapshot' } });
      if (!result) throw new Error('generation_gc_snapshot_transaction_incomplete');
      return result;
    } finally {
      await session.endSession();
    }
  }
}

async function scanSourceEdges(session: ClientSession): Promise<GenerationEdge[]> {
  const edges: GenerationEdge[] = [];
  let cursor: { sourceUserId: string; targetUserId: string; edgeId: Types.ObjectId } | null = null;
  while (true) {
    const filter: Record<string, unknown> = {};
    if (cursor) {
      filter.$or = [
        { sourceUserId: { $gt: cursor.sourceUserId } },
        {
          sourceUserId: cursor.sourceUserId,
          targetUserId: { $gt: cursor.targetUserId },
        },
        {
          sourceUserId: cursor.sourceUserId,
          targetUserId: cursor.targetUserId,
          _id: { $gt: cursor.edgeId },
        },
      ];
    }
    const rows = await RealGraphEdge.find(filter)
      .select({
        _id: 1,
        sourceUserId: 1,
        targetUserId: 1,
        decayedSum: 1,
        interactionProbability: 1,
        dailyCounts: 1,
        rollupCounts: 1,
        lastInteractionAt: 1,
        updatedAt: 1,
      })
      .sort({ sourceUserId: 1, targetUserId: 1, _id: 1 })
      .collation(SIMPLE_COLLATION)
      .session(session)
      .limit(SCAN_BATCH_SIZE)
      .lean();
    const typedRows = rows as unknown as SourceEdgeRow[];
    edges.push(...typedRows.map(mapSourceEdge));
    if (typedRows.length < SCAN_BATCH_SIZE) return edges;
    const last = typedRows[typedRows.length - 1];
    if (!(last._id instanceof Types.ObjectId)) {
      throw new Error('generation_source_edge_id_invalid');
    }
    cursor = {
      sourceUserId: String(last.sourceUserId),
      targetUserId: String(last.targetUserId),
      edgeId: last._id,
    };
  }
}

interface SourceEdgeRow {
  _id: Types.ObjectId;
  sourceUserId: unknown;
  targetUserId: unknown;
  decayedSum?: unknown;
  interactionProbability?: unknown;
  dailyCounts?: Partial<GenerationSignalCounts>;
  rollupCounts?: Partial<GenerationSignalCounts>;
  lastInteractionAt?: Date | null;
  updatedAt?: Date | null;
}

function mapSourceEdge(edge: SourceEdgeRow): GenerationEdge {
  const dailySignalCounts = edge.dailyCounts ?? {};
  const rollupSignalCounts = edge.rollupCounts ?? {};
  return {
    sourceUserId: String(edge.sourceUserId),
    targetUserId: String(edge.targetUserId),
    edgeId: String(edge._id),
    decayedSum: typeof edge.decayedSum === 'number' ? edge.decayedSum : Number.NaN,
    interactionProbability: typeof edge.interactionProbability === 'number'
      ? edge.interactionProbability
      : Number.NaN,
    dailySignalCounts,
    rollupSignalCounts,
    edgeKinds: deriveEdgeKinds(rollupSignalCounts, dailySignalCounts),
    lastInteractionAtMs: edge.lastInteractionAt?.getTime() ?? null,
    updatedAtMs: edge.updatedAt?.getTime() ?? null,
  };
}

function deriveEdgeKinds(
  rollup: Partial<GenerationSignalCounts>,
  daily: Partial<GenerationSignalCounts>,
): string[] {
  const value = (counts: Partial<GenerationSignalCounts>, key: keyof GenerationSignalCounts) => (
    counts[key] ?? 0
  );
  const kinds = new Set<string>();
  if (value(rollup, 'followCount') > 0 || value(rollup, 'addressBookCount') > 0) {
    kinds.add('follow');
  }
  if (value(rollup, 'addressBookCount') > 0 || value(rollup, 'directMessageCount') > 0) {
    kinds.add('chat_dm');
  }
  if (value(rollup, 'replyCount') > 0 || value(rollup, 'mentionCount') > 0) {
    kinds.add('reply_mention');
  }
  if (value(rollup, 'retweetCount') > 0 || value(rollup, 'quoteCount') > 0) {
    kinds.add('repost');
  }
  if (value(rollup, 'likeCount') > 0) kinds.add('like');
  if (
    value(daily, 'likeCount') > 0
    || value(daily, 'replyCount') > 0
    || value(daily, 'retweetCount') > 0
    || value(daily, 'quoteCount') > 0
    || value(daily, 'mentionCount') > 0
    || value(daily, 'directMessageCount') > 0
    || value(daily, 'coEngagementCount') > 0
  ) kinds.add('recent_engagement');
  if (
    value(rollup, 'coEngagementCount') > 0
    || value(rollup, 'replyCount')
      + value(rollup, 'likeCount')
      + value(rollup, 'retweetCount')
      + value(rollup, 'quoteCount') >= 3
  ) kinds.add('co_engagement');
  if (
    value(rollup, 'contentAffinityCount') > 0
    || value(rollup, 'profileViewCount') > 0
    || value(rollup, 'tweetClickCount') > 0
    || value(rollup, 'dwellTimeMs') > 0
  ) kinds.add('content_affinity');
  return Array.from(kinds);
}

function keysetFilter(cursor: GenerationCursor): Array<Record<string, unknown>> {
  return [
    { sourceUserId: { $gt: cursor.afterSourceUserId } },
    {
      sourceUserId: cursor.afterSourceUserId,
      targetUserId: { $gt: cursor.afterTargetUserId },
    },
    {
      sourceUserId: cursor.afterSourceUserId,
      targetUserId: cursor.afterTargetUserId,
      edgeId: { $gt: cursor.afterEdgeId },
    },
  ];
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export const mongoGenerationRepository = new MongoGenerationRepository();
