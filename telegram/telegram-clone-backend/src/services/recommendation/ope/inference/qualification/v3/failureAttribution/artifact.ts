import {
  createCanonicalSpoolWriterV2,
  readCanonicalSpoolRecordsV2,
} from '../../../../../offlinePrediction/predictionV2/spool';
import { publishAtomicCanonicalNdjsonV1 } from '../../../../../offlinePrediction/snapshotV2/atomicSink';
import { PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1 } from './contracts';
import {
  createPhase13FailureAttributionSidecarValidatorV1,
  isVerifiedPhase12FailureAttributionSourceV1,
  streamPhase13FailureAttributionSidecarV1,
} from './source';

export type PublishPhase13FailureAttributionSidecarResultV1 =
  | {
    status: 'published';
    publishedByThisAttempt: true;
    finalPathVisibility: 'visible';
    retryDisposition: 'not_required';
    sha256: string;
    recordCount: 984;
    durability: 'confirmed';
    spoolCleanupConfirmed: boolean;
    sourceReceiptSha256: string;
  }
  | {
    status: 'published_durability_unconfirmed';
    publishedByThisAttempt: true;
    finalPathVisibility: 'may_be_visible';
    retryDisposition: 'reconciliation_required';
    sha256: string;
    recordCount: 984;
    durability: 'unconfirmed';
    reason:
      | 'temporary_cleanup_failed'
      | 'parent_directory_sync_failed'
      | 'temporary_cleanup_and_parent_directory_sync_failed';
    spoolCleanupConfirmed: boolean;
    sourceReceiptSha256: string;
  }
  | {
    status: 'pre_publish_failed';
    publishedByThisAttempt: false;
    finalPathVisibility: 'must_recheck';
    retryDisposition: 'only_after_absence_confirmed';
    reason: string;
    spoolCleanupConfirmed: boolean;
  };

export async function publishPhase13FailureAttributionSidecarV1(
  input: unknown,
): Promise<PublishPhase13FailureAttributionSidecarResultV1> {
  const fields = publishInput(input);
  if (!fields || !isVerifiedPhase12FailureAttributionSourceV1(fields.source)
    || typeof fields.targetPath !== 'string' || fields.targetPath.length === 0) {
    return prePublishFailure('failure_attribution_source_unverified', true);
  }
  const source = fields.source;
  const limits = {
    maxLineBytes: PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumCanonicalRecordBytes,
    maxFileBytes: PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumSidecarBytes,
    maxRecords: PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.sidecarRecordCount,
  };
  let writer: Awaited<ReturnType<typeof createCanonicalSpoolWriterV2>> | undefined;
  let spool: Awaited<ReturnType<Awaited<ReturnType<typeof createCanonicalSpoolWriterV2>>['finish']>>
    | undefined;
  try {
    writer = await createCanonicalSpoolWriterV2(limits);
    const writeValidator = createPhase13FailureAttributionSidecarValidatorV1(source);
    for await (const record of streamPhase13FailureAttributionSidecarV1(source)) {
      writeValidator.accept(record);
      await writer.write(record);
    }
    const written = writeValidator.finish();
    spool = await writer.finish();
    writer = undefined;
    if (spool.sha256 !== source.attributionSha256
      || spool.sha256 !== written.sha256
      || spool.recordCount !== source.attributionRecordCount
      || spool.recordCount !== written.recordCount
      || spool.byteCount !== written.byteCount) {
      throw new Error('failure_attribution_sidecar_validation_mismatch');
    }
    const replayValidator = createPhase13FailureAttributionSidecarValidatorV1(source);
    const records = async function* () {
      for await (const record of readCanonicalSpoolRecordsV2(spool!.stream, limits)) {
        replayValidator.accept(record.value);
        yield record.value;
      }
      const replayed = replayValidator.finish();
      if (replayed.sha256 !== spool!.sha256
        || replayed.recordCount !== spool!.recordCount
        || replayed.byteCount !== spool!.byteCount) {
        throw new Error('failure_attribution_sidecar_validation_mismatch');
      }
    };
    const published = await publishAtomicCanonicalNdjsonV1({
      targetPath: fields.targetPath,
      records: records(),
      expectedSha256: source.attributionSha256,
      expectedRecordCount: source.attributionRecordCount,
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
        recordCount: 984,
        durability: 'confirmed',
        spoolCleanupConfirmed,
        sourceReceiptSha256: source.sourceReceiptSha256,
      }
      : {
        status: 'published_durability_unconfirmed',
        publishedByThisAttempt: true,
        finalPathVisibility: 'may_be_visible',
        retryDisposition: 'reconciliation_required',
        sha256: published.sha256,
        recordCount: 984,
        durability: 'unconfirmed',
        reason: published.reason,
        spoolCleanupConfirmed,
        sourceReceiptSha256: source.sourceReceiptSha256,
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

function publishInput(value: unknown): { source: unknown; targetPath: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return { source: Reflect.get(value, 'source'), targetPath: Reflect.get(value, 'targetPath') };
  } catch {
    return null;
  }
}

async function cleanupSpool(spool: { cleanup: () => Promise<void> }): Promise<boolean> {
  return spool.cleanup().then(() => true, () => false);
}

function stableReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return STABLE_PRE_PUBLISH_REASONS.has(message)
    ? message
    : 'failure_attribution_sidecar_publish_failed';
}

const STABLE_PRE_PUBLISH_REASONS = new Set([
  'atomic_artifact_contract_invalid',
  'atomic_artifact_publish_locked',
  'atomic_artifact_target_exists',
  'atomic_artifact_validation_mismatch',
  'atomic_artifact_write_failed',
  'failure_attribution_sidecar_validation_mismatch',
  'failure_attribution_source_unverified',
  'prediction_spool_closed',
  'prediction_spool_contract_invalid',
  'prediction_spool_io_failed',
  'prediction_spool_resource_config_invalid',
  'prediction_spool_resource_limit_exceeded',
]);

function prePublishFailure(
  reason: string,
  spoolCleanupConfirmed: boolean,
): PublishPhase13FailureAttributionSidecarResultV1 {
  return {
    status: 'pre_publish_failed',
    publishedByThisAttempt: false,
    finalPathVisibility: 'must_recheck',
    retryDisposition: 'only_after_absence_confirmed',
    reason,
    spoolCleanupConfirmed,
  };
}
