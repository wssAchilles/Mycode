import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import { canonicalWireJsonV1 } from '../../../../../offlinePrediction/artifacts/canonical';
import {
  createQualificationArtifactValidatorV1,
  parseQualificationArtifactRecordV1,
} from '../../v2/artifact';
import type { SyntheticInferenceQualificationResultV1 } from '../../v2/contracts';
import { isVerifiedSyntheticInferenceQualificationResultV1 } from '../../v2/evaluate';
import {
  isVerifiedFrozenInferenceQualificationProtocolV1,
  type VerifiedFrozenInferenceQualificationProtocolV1,
} from '../../v2/protocol';
import {
  PHASE13_FAILURE_ATTRIBUTION_CLASSIFICATION_V1,
  PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1,
  VERIFIED_PHASE12_FAILURE_ATTRIBUTION_SOURCE_V1,
  type Phase13FailureAttributionBlockerV1,
  type Phase13FailureAttributionRecordV1,
  type VerifiedPhase12FailureAttributionSourceV1,
} from './contracts';
import {
  createPhase12SemanticReplayStateV1,
  replayPhase12ArtifactRecordV1,
  verifyPhase12WholeResultV1,
} from './replicationReplay';
import {
  buildPhase13SidecarRecordsV1,
  ndjsonDigestV1,
  validatePhase13SidecarV1,
} from './sidecar';

const verifiedSource = Symbol('verifiedPhase12FailureAttributionSourceV1');
const verifiedSources = new WeakSet<object>();
const verifiedSourceDigests = new WeakMap<object, string>();
const sourceSidecars = new WeakMap<object, readonly Phase13FailureAttributionRecordV1[]>();

type BrandedSource = VerifiedPhase12FailureAttributionSourceV1 & {
  readonly [verifiedSource]: true;
};
type VerificationResult =
  | { status: 'verified'; source: BrandedSource }
  | { status: 'not_evaluable'; blocker: Phase13FailureAttributionBlockerV1 };

export async function verifyPhase12FailureAttributionSourceV1(
  input: unknown,
): Promise<VerificationResult> {
  const fields = sourceInput(input);
  if (!fields
    || !isVerifiedFrozenInferenceQualificationProtocolV1(fields.protocol)
    || !isVerifiedSyntheticInferenceQualificationResultV1(fields.qualification)
    || !isIterable(fields.artifact)
    || fields.qualification.protocolSha256 !== fields.protocol.protocolSha256) {
    return failure('failure_attribution_source_unverified');
  }
  const protocol = fields.protocol;
  const qualification = fields.qualification;
  if (!resourcePreflight(protocol, qualification)) {
    return failure('qualification_resource_attribution_unavailable');
  }

  const validator = createQualificationArtifactValidatorV1(protocol);
  const replay = createPhase12SemanticReplayStateV1();
  const hash = createHash('sha256');
  let recordCount = 0;
  let byteCount = 0;
  try {
    for await (const rawRecord of fields.artifact) {
      const record = parseQualificationArtifactRecordV1(rawRecord);
      if (!record) throw stableError('qualification_artifact_binding_mismatch');
      validator.accept(record);
      const wire = `${canonicalWireJsonV1(record)}\n`;
      recordCount += 1;
      byteCount += Buffer.byteLength(wire);
      if (recordCount > PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumInputRecords
        || byteCount > PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumInputBytes) {
        throw stableError('resource_limit_exceeded');
      }
      hash.update(wire);
      replayPhase12ArtifactRecordV1(protocol, replay, record);
    }
    const validated = validator.finish();
    const rawArtifactSha256 = hash.digest('hex');
    verifyPhase12WholeResultV1(protocol, qualification, replay, recordCount);
    if (validated.sha256 !== rawArtifactSha256
      || validated.recordCount !== recordCount
      || validated.byteCount !== byteCount
      || recordCount !== protocol.resources.plannedRecordCount
      || rawArtifactSha256 !== qualification.diagnostics.artifactSha256) {
      throw stableError('qualification_artifact_binding_mismatch');
    }

    const receiptPreimage = sourceReceiptPreimage(protocol, qualification, replay, {
      rawArtifactSha256, rawArtifactByteCount: byteCount,
    });
    const sourceReceiptSha256 = digest(receiptPreimage);
    const sidecarWithoutEnd = buildPhase13SidecarRecordsV1(protocol, replay, {
      sourceReceiptSha256,
      qualificationSha256: qualification.qualificationSha256,
    });
    const sidecar = recursivelyFreeze([...sidecarWithoutEnd, {
      record: 'attribution_end' as const,
      version: 'phase13_failure_attribution_sidecar_end_v1' as const,
      sourceReceiptSha256,
      expectedRecordCount: 984 as const,
      recordsBeforeEndSha256: ndjsonDigestV1(sidecarWithoutEnd),
    }]);
    validatePhase13SidecarV1(sidecar);
    const sourcePreimage = {
      ...receiptPreimage,
      sourceReceiptSha256,
      attributionSha256: ndjsonDigestV1(sidecar),
      attributionRecordCount: 984 as const,
    };
    const source = { ...sourcePreimage } as unknown as BrandedSource;
    Object.defineProperty(source, verifiedSource, {
      value: true, enumerable: false, configurable: false, writable: false,
    });
    verifiedSources.add(source);
    recursivelyFreeze(source);
    verifiedSourceDigests.set(source, digest(sourcePreimage));
    sourceSidecars.set(source, sidecar);
    return { status: 'verified', source };
  } catch (error) {
    return failure(blockerFromError(error));
  }
}

export function isVerifiedPhase12FailureAttributionSourceV1(
  value: unknown,
): value is BrandedSource {
  try {
    if (!value || typeof value !== 'object' || !verifiedSources.has(value)) return false;
    const candidate = value as BrandedSource;
    return candidate[verifiedSource] === true
      && recursivelyFrozen(candidate)
      && candidate.sourceReceiptSha256 === digest(receiptPreimageFromSource(candidate))
      && candidate.attributionRecordCount === 984
      && sourceSidecars.get(candidate)?.length === 984
      && verifiedSourceDigests.get(candidate) === digest({ ...candidate });
  } catch {
    return false;
  }
}

export async function* streamPhase13FailureAttributionSidecarV1(
  source: unknown,
): AsyncGenerator<Phase13FailureAttributionRecordV1> {
  if (!isVerifiedPhase12FailureAttributionSourceV1(source)) {
    throw new Error('failure_attribution_source_unverified');
  }
  for (const record of sourceSidecars.get(source)!) yield record;
}

export function createPhase13FailureAttributionSidecarValidatorV1(source: unknown) {
  if (!isVerifiedPhase12FailureAttributionSourceV1(source)) {
    throw new Error('failure_attribution_source_unverified');
  }
  const expected = sourceSidecars.get(source)!;
  const hash = createHash('sha256');
  let index = 0;
  let byteCount = 0;
  return {
    accept: (record: unknown) => {
      try {
        const wire = canonicalWireJsonV1(record);
        const lineBytes = Buffer.byteLength(wire);
        const bytes = lineBytes + 1;
        if (wire !== canonicalWireJsonV1(expected[index])
          || lineBytes > PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumCanonicalRecordBytes
          || index >= PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.sidecarRecordCount
          || byteCount + bytes > PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumSidecarBytes) {
          throw new Error('failure_attribution_sidecar_validation_mismatch');
        }
        hash.update(`${wire}\n`);
        index += 1;
        byteCount += bytes;
      } catch {
        throw new Error('failure_attribution_sidecar_validation_mismatch');
      }
    },
    finish: () => {
      const sha256 = hash.digest('hex');
      if (index !== expected.length || sha256 !== source.attributionSha256) {
        throw new Error('failure_attribution_sidecar_validation_mismatch');
      }
      return { sha256, recordCount: index, byteCount };
    },
  };
}

function sourceReceiptPreimage(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  qualification: SyntheticInferenceQualificationResultV1,
  replay: ReturnType<typeof createPhase12SemanticReplayStateV1>,
  artifact: { rawArtifactSha256: string; rawArtifactByteCount: number },
) {
  return {
    contractVersion: VERIFIED_PHASE12_FAILURE_ATTRIBUTION_SOURCE_V1,
    protocolSha256: protocol.protocolSha256,
    qualificationSha256: qualification.qualificationSha256,
    generatorSeedSha256: seedDigest('phase12_revealed_generator_seed_v1', protocol.generatorSeedMaterial),
    bootstrapSeedSha256: seedDigest('phase12_revealed_bootstrap_seed_v1', protocol.bootstrapSeedMaterial),
    rawArtifactSha256: artifact.rawArtifactSha256,
    rawArtifactRecordCount: 5_420 as const,
    rawArtifactByteCount: artifact.rawArtifactByteCount,
    failureClassificationVersion: PHASE13_FAILURE_ATTRIBUTION_CLASSIFICATION_V1,
    dgpPrimitiveWorkUnits: 108_812 as const,
    bootstrapWorkUnits: replay.bootstrapWorkUnits,
    peakBufferedClusters: replay.peakBufferedClusters,
    realDatasetEligible: false as const,
  };
}

function receiptPreimageFromSource(source: VerifiedPhase12FailureAttributionSourceV1) {
  return {
    contractVersion: source.contractVersion,
    protocolSha256: source.protocolSha256,
    qualificationSha256: source.qualificationSha256,
    generatorSeedSha256: source.generatorSeedSha256,
    bootstrapSeedSha256: source.bootstrapSeedSha256,
    rawArtifactSha256: source.rawArtifactSha256,
    rawArtifactRecordCount: source.rawArtifactRecordCount,
    rawArtifactByteCount: source.rawArtifactByteCount,
    failureClassificationVersion: source.failureClassificationVersion,
    dgpPrimitiveWorkUnits: source.dgpPrimitiveWorkUnits,
    bootstrapWorkUnits: source.bootstrapWorkUnits,
    peakBufferedClusters: source.peakBufferedClusters,
    realDatasetEligible: source.realDatasetEligible,
  };
}

function resourcePreflight(
  protocol: VerifiedFrozenInferenceQualificationProtocolV1,
  qualification: SyntheticInferenceQualificationResultV1,
): boolean {
  return protocol.resources.plannedRecordCount === 5_420
    && protocol.resources.maximumQualificationBytes <= PHASE13_FAILURE_ATTRIBUTION_RESOURCES_V1.maximumInputBytes
    && protocol.resources.maximumGeneratorPrimitiveWorkUnits <= 131_072
    && protocol.resources.bootstrapWorkUnits <= 892_048
    && qualification.diagnostics.resources.actualRecordCount === 5_420
    && qualification.diagnostics.resources.actualClusterScoreCount === 3_512
    && qualification.diagnostics.resources.actualBootstrapWorkUnits <= 892_048
    && qualification.diagnostics.peakBufferedClusters <= 4
    && typeof qualification.diagnostics.artifactSha256 === 'string';
}

function sourceInput(value: unknown): {
  protocol: unknown; qualification: unknown; artifact: unknown;
} | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return {
      protocol: Reflect.get(value, 'protocol'),
      qualification: Reflect.get(value, 'qualification'),
      artifact: Reflect.get(value, 'artifact'),
    };
  } catch {
    return null;
  }
}

function isIterable(value: unknown): value is AsyncIterable<unknown> | Iterable<unknown> {
  if (!value || typeof value !== 'object') return false;
  try {
    return typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
      || typeof Reflect.get(value, Symbol.iterator) === 'function';
  } catch {
    return false;
  }
}

function blockerFromError(error: unknown): Phase13FailureAttributionBlockerV1 {
  if (error && typeof error === 'object') {
    try {
      const blocker = Reflect.get(error, 'blocker');
      if (STABLE_BLOCKERS.has(blocker)) return blocker as Phase13FailureAttributionBlockerV1;
    } catch { /* map below */ }
  }
  return 'qualification_artifact_binding_mismatch';
}

function stableError(blocker: Phase13FailureAttributionBlockerV1): Error {
  return Object.assign(new Error(blocker), { blocker });
}

function seedDigest(domain: string, seed: string): string {
  return createHash('sha256').update(domain).update('\0').update(seed).digest('hex');
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}

const STABLE_BLOCKERS = new Set<unknown>([
  'failure_attribution_source_unverified',
  'qualification_artifact_binding_mismatch',
  'qualification_artifact_semantics_mismatch',
  'qualification_resource_attribution_unavailable',
  'qualification_control_semantics_unavailable',
  'resource_limit_exceeded',
]);
const failure = (blocker: Phase13FailureAttributionBlockerV1): VerificationResult => ({
  status: 'not_evaluable', blocker,
});
const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
