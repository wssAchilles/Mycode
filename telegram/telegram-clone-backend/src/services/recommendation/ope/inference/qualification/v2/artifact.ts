import { createHash } from 'crypto';

import { z } from 'zod';

import { canonicalWireJsonV1 } from '../../../../offlinePrediction/artifacts/canonical';
import {
  createCanonicalSpoolWriterV2,
  readCanonicalSpoolRecordsV2,
} from '../../../../offlinePrediction/predictionV2/spool';
import { publishAtomicCanonicalNdjsonV1 } from '../../../../offlinePrediction/snapshotV2/atomicSink';
import { PHASE12_CRITICAL_SCENARIO_IDS_V1 } from './contracts';
import {
  executeSyntheticSequentialDrQualificationV1,
  isVerifiedSyntheticInferenceQualificationResultV1,
} from './evaluate';
import {
  isVerifiedFrozenInferenceQualificationProtocolV1,
  type VerifiedFrozenInferenceQualificationProtocolV1,
} from './protocol';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const boundedText = z.string().min(1).max(128);
const scenarioId = z.enum(PHASE12_CRITICAL_SCENARIO_IDS_V1);
const finiteScore = z.number().finite().min(-1e12).max(1e12);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const clusterId = z.string().min(1).max(32)
  .refine((value) => Buffer.byteLength(value) <= 32);

const artifactStartSchema = z.object({
  record: z.literal('artifact_start'),
  version: z.literal('synthetic_qualification_artifact_v1'),
  protocolSha256: sha256,
  actions: z.tuple([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  slotsPerCluster: z.literal(2),
  expectedRecordCount: z.literal(5_420),
}).strict();

const replicationIdentity = {
  scenarioKind: z.enum(['critical', 'fail_closed_control']),
  scenarioId: z.union([scenarioId, z.literal('invalid_studentizer_control')]),
  replicationIndex: count,
};

const replicationStartSchema = z.object({
  record: z.literal('replication_start'),
  version: z.literal('synthetic_qualification_replication_v1'),
  ...replicationIdentity,
  replicationSha256: sha256,
  expectedClusterCount: z.union([z.literal(2), z.literal(4)]),
}).strict();

const clusterScoreSchema = z.object({
  record: z.literal('cluster_score'),
  version: z.literal('synthetic_qualification_cluster_score_v1'),
  ...replicationIdentity,
  clusterId,
  y: finiteScore,
  a: finiteScore.positive(),
  importanceMass: finiteScore.nonnegative(),
}).strict();

const replicationEndSchema = z.object({
  record: z.literal('replication_end'),
  version: z.literal('synthetic_qualification_replication_end_v1'),
  ...replicationIdentity,
  status: z.enum([
    'evaluated',
    'not_evaluable',
    'expected_failure_observed',
    'control_failed',
  ]),
  blocker: boundedText.nullable(),
  thresholdTestSha256: sha256.nullable(),
  diagnosticCiSha256: sha256.nullable(),
}).strict();

const assumptionControlSchema = z.object({
  record: z.literal('assumption_control'),
  version: z.literal('synthetic_qualification_assumption_control_v1'),
  control: z.enum([
    'viewer_dependence',
    'unhandled_time_shock',
    'propensity_bound_unverified',
    'adaptive_selection_holdout_reuse',
  ]),
  replicationIndex: count.max(7),
  status: z.literal('not_applicable'),
  reasons: z.array(boundedText).min(1).max(8),
}).strict();

const artifactEndSchema = z.object({
  record: z.literal('artifact_end'),
  version: z.literal('synthetic_qualification_artifact_end_v1'),
  protocolSha256: sha256,
  candidateStatus: z.enum(['synthetic_mixture_gates_passed', 'failed']),
  expectedRecordCount: z.literal(5_420),
  recordsBeforeEndSha256: sha256,
}).strict();

const qualificationArtifactRecordSchema = z.discriminatedUnion('record', [
  artifactStartSchema,
  replicationStartSchema,
  clusterScoreSchema,
  replicationEndSchema,
  assumptionControlSchema,
  artifactEndSchema,
]);

export type QualificationArtifactRecordV1 = z.infer<typeof qualificationArtifactRecordSchema>;

// Internal cross-version seam: V3 replays V1 semantics without changing the V1 wire contract.
export function parseQualificationArtifactRecordV1(
  value: unknown,
): QualificationArtifactRecordV1 | null {
  try {
    const parsed = qualificationArtifactRecordSchema.safeParse(value);
    return parsed.success && allStringsWithinUtf8Limit(parsed.data, 128)
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export type QualificationArtifactValidatorV1 = {
  accept: (record: unknown) => void;
  finish: () => { sha256: string; recordCount: number; byteCount: number; peakLineBytes: number };
};

export type PublishSyntheticQualificationArtifactResultV1 =
  | {
    status: 'published';
    publishedByThisAttempt: true;
    finalPathVisibility: 'visible';
    retryDisposition: 'not_required';
    sha256: string;
    recordCount: number;
    durability: 'confirmed';
    spoolCleanupConfirmed: boolean;
    qualificationSha256: string;
  }
  | {
    status: 'published_durability_unconfirmed';
    publishedByThisAttempt: true;
    finalPathVisibility: 'may_be_visible';
    retryDisposition: 'reconciliation_required';
    sha256: string;
    recordCount: number;
    durability: 'unconfirmed';
    reason:
      | 'temporary_cleanup_failed'
      | 'parent_directory_sync_failed'
      | 'temporary_cleanup_and_parent_directory_sync_failed';
    spoolCleanupConfirmed: boolean;
    qualificationSha256: string;
  }
  | {
    status: 'pre_publish_failed';
    publishedByThisAttempt: false;
    finalPathVisibility: 'must_recheck';
    retryDisposition: 'only_after_absence_confirmed';
    reason: string;
    spoolCleanupConfirmed: boolean;
  };

export function createQualificationArtifactValidatorV1(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
): QualificationArtifactValidatorV1 {
  if (!isVerifiedFrozenInferenceQualificationProtocolV1(protocol)) {
    throw new Error('qualification_artifact_contract_invalid');
  }
  const hash = createHash('sha256');
  let recordCount = 0;
  let byteCount = 0;
  let peakLineBytes = 0;
  let phase: 'start' | 'critical_start' | 'critical_cluster' | 'critical_end'
    | 'invalid_start' | 'invalid_cluster' | 'invalid_end' | 'assumption' | 'end' | 'done' = 'start';
  let scenarioIndex = 0;
  let replicationIndex = 0;
  let clusterIndex = 0;
  let assumptionIndex = 0;
  let assumptionReplicationIndex = 0;

  const accept = (rawRecord: unknown) => {
    const parsed = parseQualificationArtifactRecordV1(rawRecord);
    if (!parsed) {
      throw new Error('qualification_artifact_contract_invalid');
    }
    const record = parsed;
    const wire = canonicalWireJsonV1(record);
    const lineBytes = Buffer.byteLength(wire);
    if (lineBytes > protocol.resources.maximumCanonicalRecordBytes) {
      throw new Error('resource_limit_exceeded');
    }
    assertExpected(record);
    if (record.record === 'artifact_end'
      && record.recordsBeforeEndSha256 !== hash.copy().digest('hex')) {
      throw new Error('qualification_artifact_digest_mismatch');
    }
    const bytes = Buffer.byteLength(wire) + 1;
    if (recordCount >= protocol.resources.maximumQualificationRecords
      || byteCount + bytes > protocol.resources.maximumQualificationBytes) {
      throw new Error('resource_limit_exceeded');
    }
    hash.update(`${wire}\n`);
    recordCount += 1;
    byteCount += bytes;
    peakLineBytes = Math.max(peakLineBytes, lineBytes);
  };

  const assertExpected = (record: QualificationArtifactRecordV1) => {
    if (phase === 'start') {
      if (record.record !== 'artifact_start'
        || record.protocolSha256 !== protocol.protocolSha256) invalidGrammar();
      phase = 'critical_start';
      return;
    }
    if (phase === 'critical_start') {
      const scenario = protocol.scenarios[scenarioIndex];
      if (!scenario || record.record !== 'replication_start'
        || record.scenarioKind !== 'critical'
        || record.scenarioId !== scenario.scenarioId
        || record.replicationIndex !== replicationIndex
        || record.expectedClusterCount !== scenario.clusterCount) invalidGrammar();
      clusterIndex = 0;
      phase = 'critical_cluster';
      return;
    }
    if (phase === 'critical_cluster') {
      const scenario = protocol.scenarios[scenarioIndex]!;
      if (record.record !== 'cluster_score'
        || record.scenarioKind !== 'critical'
        || record.scenarioId !== scenario.scenarioId
        || record.replicationIndex !== replicationIndex
        || record.clusterId !== `cluster-${String(clusterIndex).padStart(2, '0')}`) invalidGrammar();
      clusterIndex += 1;
      if (clusterIndex === scenario.clusterCount) phase = 'critical_end';
      return;
    }
    if (phase === 'critical_end') {
      const scenario = protocol.scenarios[scenarioIndex]!;
      if (record.record !== 'replication_end'
        || record.scenarioKind !== 'critical'
        || record.scenarioId !== scenario.scenarioId
        || record.replicationIndex !== replicationIndex) invalidGrammar();
      replicationIndex += 1;
      if (replicationIndex === protocol.resources.criticalReplicationsPerScenario) {
        replicationIndex = 0;
        scenarioIndex += 1;
      }
      phase = scenarioIndex === protocol.scenarios.length ? 'invalid_start' : 'critical_start';
      return;
    }
    if (phase === 'invalid_start') {
      if (record.record !== 'replication_start'
        || record.scenarioKind !== 'fail_closed_control'
        || record.scenarioId !== 'invalid_studentizer_control'
        || record.replicationIndex !== 0
        || record.expectedClusterCount !== 2) invalidGrammar();
      clusterIndex = 0;
      phase = 'invalid_cluster';
      return;
    }
    if (phase === 'invalid_cluster') {
      if (record.record !== 'cluster_score'
        || record.scenarioKind !== 'fail_closed_control'
        || record.scenarioId !== 'invalid_studentizer_control'
        || record.replicationIndex !== 0
        || record.clusterId !== (clusterIndex === 0 ? 'cluster-a' : 'cluster-b')) invalidGrammar();
      clusterIndex += 1;
      if (clusterIndex === 2) phase = 'invalid_end';
      return;
    }
    if (phase === 'invalid_end') {
      if (record.record !== 'replication_end'
        || record.scenarioKind !== 'fail_closed_control'
        || record.scenarioId !== 'invalid_studentizer_control'
        || record.replicationIndex !== 0) invalidGrammar();
      phase = 'assumption';
      return;
    }
    if (phase === 'assumption') {
      const control = protocol.assumptionControlKinds[assumptionIndex];
      if (!control || record.record !== 'assumption_control'
        || record.control !== control
        || record.replicationIndex !== assumptionReplicationIndex) invalidGrammar();
      assumptionReplicationIndex += 1;
      if (assumptionReplicationIndex === protocol.resources.assumptionReplicationsPerKind) {
        assumptionReplicationIndex = 0;
        assumptionIndex += 1;
      }
      if (assumptionIndex === protocol.assumptionControlKinds.length) phase = 'end';
      return;
    }
    if (phase === 'end') {
      if (record.record !== 'artifact_end'
        || record.protocolSha256 !== protocol.protocolSha256
        || record.expectedRecordCount !== protocol.resources.plannedRecordCount) invalidGrammar();
      phase = 'done';
      return;
    }
    invalidGrammar();
  };

  return {
    accept,
    finish: () => {
      if (phase !== 'done' || recordCount !== protocol.resources.plannedRecordCount) {
        throw new Error('qualification_artifact_grammar_invalid');
      }
      return {
        sha256: hash.digest('hex'), recordCount, byteCount, peakLineBytes,
      };
    },
  };
}

export async function publishSyntheticQualificationArtifactV1(input: {
  protocol: unknown;
  targetPath: string;
}): Promise<PublishSyntheticQualificationArtifactResultV1> {
  if (!isVerifiedFrozenInferenceQualificationProtocolV1(input.protocol)
    || typeof input.targetPath !== 'string'
    || input.targetPath.length === 0) {
    return prePublishFailure('qualification_artifact_contract_invalid', true);
  }
  const protocol = input.protocol;
  const limits = {
    maxLineBytes: protocol.resources.maximumCanonicalRecordBytes,
    maxFileBytes: protocol.resources.maximumQualificationBytes,
    maxRecords: protocol.resources.maximumQualificationRecords,
  };
  let writer: Awaited<ReturnType<typeof createCanonicalSpoolWriterV2>> | undefined;
  let spool: Awaited<ReturnType<Awaited<ReturnType<typeof createCanonicalSpoolWriterV2>>['finish']>>
    | undefined;
  try {
    writer = await createCanonicalSpoolWriterV2(limits);
    const writeValidator = createQualificationArtifactValidatorV1(protocol);
    const qualification = await executeSyntheticSequentialDrQualificationV1(
      protocol,
      async (record) => {
        writeValidator.accept(record);
        await writer!.write(record);
      },
    );
    const written = writeValidator.finish();
    if (!isVerifiedSyntheticInferenceQualificationResultV1(qualification)) {
      throw new Error('qualification_result_invalid');
    }
    spool = await writer.finish();
    writer = undefined;
    if (spool.sha256 !== written.sha256
      || spool.sha256 !== qualification.diagnostics.artifactSha256
      || spool.recordCount !== written.recordCount
      || spool.recordCount !== protocol.resources.plannedRecordCount
      || spool.byteCount !== written.byteCount
      || spool.byteCount > protocol.resources.plannedBytesUpperBound
      || spool.peakLineBytes !== written.peakLineBytes) {
      throw new Error('qualification_artifact_validation_mismatch');
    }
    const replayValidator = createQualificationArtifactValidatorV1(protocol);
    const records = async function* () {
      for await (const record of readCanonicalSpoolRecordsV2(spool!.stream, limits)) {
        replayValidator.accept(record.value);
        yield record.value;
      }
      const replayed = replayValidator.finish();
      if (replayed.sha256 !== spool!.sha256
        || replayed.recordCount !== spool!.recordCount
        || replayed.byteCount !== spool!.byteCount) {
        throw new Error('qualification_artifact_validation_mismatch');
      }
    };
    const published = await publishAtomicCanonicalNdjsonV1({
      targetPath: input.targetPath,
      records: records(),
      expectedSha256: spool.sha256,
      expectedRecordCount: spool.recordCount,
    });
    const spoolCleanupConfirmed = await cleanupSpool(spool);
    spool = undefined;
    return published.status === 'published'
      ? {
        status: 'published',
        publishedByThisAttempt: true,
        finalPathVisibility: 'visible',
        retryDisposition: 'not_required',
        sha256: published.sha256,
        recordCount: published.recordCount,
        durability: published.durability,
        spoolCleanupConfirmed,
        qualificationSha256: qualification.qualificationSha256,
      }
      : {
        status: 'published_durability_unconfirmed',
        publishedByThisAttempt: true,
        finalPathVisibility: 'may_be_visible',
        retryDisposition: 'reconciliation_required',
        sha256: published.sha256,
        recordCount: published.recordCount,
        durability: published.durability,
        reason: published.reason,
        spoolCleanupConfirmed,
        qualificationSha256: qualification.qualificationSha256,
      };
  } catch (error) {
    const spoolCleanupConfirmed = spool
      ? await cleanupSpool(spool)
      : writer
        ? await writer.abort().then(() => true, () => false)
        : true;
    return prePublishFailure(stableReason(error), spoolCleanupConfirmed);
  }
}

export function qualificationWorstCaseCanonicalRecordBytesV1(): number {
  const digest = 'f'.repeat(64);
  const maximumText = 'x'.repeat(128);
  const records: QualificationArtifactRecordV1[] = [
    { record: 'artifact_start', version: 'synthetic_qualification_artifact_v1', protocolSha256: digest, actions: [0, 1, 2, 3], slotsPerCluster: 2, expectedRecordCount: 5_420 },
    { record: 'replication_start', version: 'synthetic_qualification_replication_v1', scenarioKind: 'critical', scenarioId: 'synthetic_dr_score_misspecification', replicationIndex: Number.MAX_SAFE_INTEGER, replicationSha256: digest, expectedClusterCount: 4 },
    { record: 'cluster_score', version: 'synthetic_qualification_cluster_score_v1', scenarioKind: 'critical', scenarioId: 'synthetic_dr_score_misspecification', replicationIndex: Number.MAX_SAFE_INTEGER, clusterId: 'x'.repeat(32), y: -1e12, a: 1e12, importanceMass: 1e12 },
    { record: 'replication_end', version: 'synthetic_qualification_replication_end_v1', scenarioKind: 'critical', scenarioId: 'synthetic_dr_score_misspecification', replicationIndex: Number.MAX_SAFE_INTEGER, status: 'not_evaluable', blocker: maximumText, thresholdTestSha256: digest, diagnosticCiSha256: digest },
    { record: 'assumption_control', version: 'synthetic_qualification_assumption_control_v1', control: 'adaptive_selection_holdout_reuse', replicationIndex: 7, status: 'not_applicable', reasons: Array.from({ length: 8 }, () => maximumText) },
    { record: 'artifact_end', version: 'synthetic_qualification_artifact_end_v1', protocolSha256: digest, candidateStatus: 'synthetic_mixture_gates_passed', expectedRecordCount: 5_420, recordsBeforeEndSha256: digest },
  ];
  return Math.max(...records.map((record) => Buffer.byteLength(canonicalWireJsonV1(record))));
}

function allStringsWithinUtf8Limit(value: unknown, maximumBytes: number): boolean {
  if (typeof value === 'string') return Buffer.byteLength(value) <= maximumBytes;
  if (Array.isArray(value)) return value.every((item) => allStringsWithinUtf8Limit(item, maximumBytes));
  if (value && typeof value === 'object') {
    return Object.values(value).every((item) => allStringsWithinUtf8Limit(item, maximumBytes));
  }
  return true;
}

function invalidGrammar(): never {
  throw new Error('qualification_artifact_grammar_invalid');
}

async function cleanupSpool(spool: { cleanup: () => Promise<void> }): Promise<boolean> {
  return spool.cleanup().then(() => true, () => false);
}

function stableReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return STABLE_PRE_PUBLISH_REASONS.has(message)
    ? message
    : 'qualification_artifact_publish_failed';
}

const STABLE_PRE_PUBLISH_REASONS = new Set([
  'atomic_artifact_contract_invalid',
  'atomic_artifact_publish_locked',
  'atomic_artifact_target_exists',
  'atomic_artifact_validation_mismatch',
  'atomic_artifact_write_failed',
  'prediction_spool_closed',
  'prediction_spool_contract_invalid',
  'prediction_spool_io_failed',
  'prediction_spool_resource_config_invalid',
  'prediction_spool_resource_limit_exceeded',
  'qualification_artifact_contract_invalid',
  'qualification_artifact_digest_mismatch',
  'qualification_artifact_grammar_invalid',
  'qualification_artifact_validation_mismatch',
  'qualification_result_invalid',
  'resource_limit_exceeded',
]);

function prePublishFailure(
  reason: string,
  spoolCleanupConfirmed: boolean,
): PublishSyntheticQualificationArtifactResultV1 {
  return {
    status: 'pre_publish_failed',
    publishedByThisAttempt: false,
    finalPathVisibility: 'must_recheck',
    retryDisposition: 'only_after_absence_confirmed',
    reason,
    spoolCleanupConfirmed,
  };
}
