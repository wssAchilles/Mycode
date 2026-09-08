import { createHash, createHmac, hkdfSync } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';
import {
  RECOMMENDATION_VIEWER_PSEUDONYM_ALGORITHM_V1,
  RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1,
  RECOMMENDATION_VIEWER_PSEUDONYM_PURPOSE_V1,
  RECOMMENDATION_VIEWER_PSEUDONYM_V1,
  type RecommendationViewerPseudonymBuildBlockerV1,
  type RecommendationViewerPseudonymBuildResultV1,
  type RecommendationViewerPseudonymResourceDiagnosticsV1,
  type VerifiedRecommendationViewerPseudonymV1,
} from './contracts';

export * from './contracts';

const verifiedPseudonym = Symbol('verifiedRecommendationViewerPseudonymV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const METADATA_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const HKDF_SALT = Buffer.from(
  'telegram/recommendation/viewer-pseudonym/hkdf-salt/v1',
  'utf8',
);

type BrandedPseudonym = VerifiedRecommendationViewerPseudonymV1 & {
  readonly [verifiedPseudonym]: true;
};

type CapturedInput = Readonly<{
  masterKey: Buffer;
  viewerId: string;
  keyVersion: string;
  captureEpochId: string;
}>;

type CaptureInputResult = CapturedInput | 'key_invalid' | null;

export function buildRecommendationViewerPseudonymV1(
  input: unknown,
): RecommendationViewerPseudonymBuildResultV1 {
  let masterKeyCopy: Buffer | null = null;
  try {
    const captured = captureInput(input);
    if (captured === 'key_invalid') return reject('viewer_pseudonym_key_invalid');
    if (!captured) return reject('viewer_pseudonym_input_invalid');
    masterKeyCopy = captured.masterKey;
    const viewerIdUtf8Bytes = Buffer.byteLength(captured.viewerId, 'utf8');
    if (viewerIdUtf8Bytes > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumViewerIdUtf8Bytes) {
      return reject('viewer_pseudonym_resource_limit_exceeded');
    }

    if (captured.masterKey.length !== RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.requiredMasterKeyBytes) {
      return reject('viewer_pseudonym_key_invalid');
    }

    const context = {
      contractVersion: RECOMMENDATION_VIEWER_PSEUDONYM_V1,
      purpose: RECOMMENDATION_VIEWER_PSEUDONYM_PURPOSE_V1,
      algorithm: RECOMMENDATION_VIEWER_PSEUDONYM_ALGORITHM_V1,
      keyVersion: captured.keyVersion,
      captureEpochId: captured.captureEpochId,
    } as const;
    const message = {
      domain: 'telegram/recommendation/viewer-pseudonym/message/v1',
      viewerId: captured.viewerId,
    } as const;
    const publicContext = Buffer.from(canonicalDecisionJson(context), 'utf8');
    const hmacMessage = Buffer.from(canonicalDecisionJson(message), 'utf8');
    const workUnits = captured.masterKey.length
      + viewerIdUtf8Bytes
      + publicContext.length
      + hmacMessage.length
      + 3;
    const baseDiagnostics = {
      preflightCompletedBeforeCryptography: true,
      masterKeyBytes: 32,
      viewerIdUtf8Bytes,
      publicContextBytes: publicContext.length,
      hmacMessageBytes: hmacMessage.length,
      cryptographicOperations: 3,
      workUnits,
    } as const;
    const plannedCanonicalOutputBytes = plannedOutputBytes(
      captured,
      baseDiagnostics,
    );
    if (publicContext.length > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumCanonicalOutputBytes
      || hmacMessage.length > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumCanonicalOutputBytes
      || workUnits > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumWorkUnits
      || plannedCanonicalOutputBytes > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumCanonicalOutputBytes) {
      return reject('viewer_pseudonym_resource_limit_exceeded');
    }

    const resourceDiagnostics: RecommendationViewerPseudonymResourceDiagnosticsV1 = {
      ...baseDiagnostics,
      plannedCanonicalOutputBytes,
    };
    const derivedKey = Buffer.from(hkdfSync(
      'sha256',
      captured.masterKey,
      HKDF_SALT,
      publicContext,
      32,
    ));
    let viewerAccountPseudonym: string;
    try {
      viewerAccountPseudonym = createHmac('sha256', derivedKey)
        .update(hmacMessage)
        .digest('hex');
    } finally {
      derivedKey.fill(0);
    }

    const preimage = preimageFor(
      captured,
      viewerAccountPseudonym,
      resourceDiagnostics,
    );
    const candidate = {
      ...preimage,
      pseudonymReceiptSha256: digest(preimage),
    } as unknown as BrandedPseudonym;
    if (canonicalBytes(candidate) !== plannedCanonicalOutputBytes) {
      return reject('viewer_pseudonym_resource_limit_exceeded');
    }
    Object.defineProperty(candidate, verifiedPseudonym, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    deepFreeze(candidate);
    verifiedObjects.add(candidate);
    verifiedDigests.set(candidate, candidate.pseudonymReceiptSha256);
    return { status: 'verified', pseudonym: candidate };
  } catch {
    return reject('viewer_pseudonym_input_invalid');
  } finally {
    masterKeyCopy?.fill(0);
  }
}

export function isVerifiedRecommendationViewerPseudonymV1(
  value: unknown,
): value is BrandedPseudonym {
  try {
    if (!isObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedPseudonym;
    const digestValue = safeGet(candidate, 'pseudonymReceiptSha256');
    const diagnostics = readDiagnostics(safeGet(candidate, 'resourceDiagnostics'));
    if (!diagnostics || !isSha256(digestValue)
      || safeGet(candidate, verifiedPseudonym) !== true
      || !deepFrozen(candidate)
      || safeGet(candidate, 'contractVersion') !== RECOMMENDATION_VIEWER_PSEUDONYM_V1
      || safeGet(candidate, 'purpose') !== RECOMMENDATION_VIEWER_PSEUDONYM_PURPOSE_V1
      || safeGet(candidate, 'algorithm') !== RECOMMENDATION_VIEWER_PSEUDONYM_ALGORITHM_V1
      || safeGet(candidate, 'clusterUnitVersion') !== VIEWER_CLUSTER_UNIT_VERSION
      || safeGet(candidate, 'developmentEvidenceOnly') !== true
      || safeGet(candidate, 'candidateEvidenceEligible') !== false
      || safeGet(candidate, 'qualificationEvidenceEligible') !== false
      || safeGet(candidate, 'realDatasetEligible') !== false
      || safeGet(candidate, 'servable') !== false
      || !isMetadataId(safeGet(candidate, 'keyVersion'))
      || !isMetadataId(safeGet(candidate, 'captureEpochId'))
      || !isSha256(safeGet(candidate, 'viewerAccountPseudonym'))) return false;
    const preimage = preimageFromCandidate(candidate, diagnostics);
    return digestValue === digest(preimage)
      && verifiedDigests.get(candidate) === digestValue
      && canonicalBytes(candidate) === diagnostics.plannedCanonicalOutputBytes;
  } catch {
    return false;
  }
}

function captureInput(value: unknown): CaptureInputResult {
  if (!isObjectLike(value)) return null;
  const masterKey = safeGet(value, 'masterKey');
  const viewerId = safeGet(value, 'viewerId');
  const keyVersion = safeGet(value, 'keyVersion');
  const captureEpochId = safeGet(value, 'captureEpochId');
  if (!Buffer.isBuffer(masterKey)
    || typeof viewerId !== 'string'
    || viewerId.length === 0
    || !isMetadataId(keyVersion)
    || !isMetadataId(captureEpochId)) return null;
  if (masterKey.length !== RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.requiredMasterKeyBytes) {
    return 'key_invalid';
  }
  const keyCopy = Buffer.from(masterKey);
  return Object.freeze({ masterKey: keyCopy, viewerId, keyVersion, captureEpochId });
}

function preimageFor(
  input: Pick<CapturedInput, 'keyVersion' | 'captureEpochId'>,
  viewerAccountPseudonym: string,
  resourceDiagnostics: RecommendationViewerPseudonymResourceDiagnosticsV1,
) {
  return {
    contractVersion: RECOMMENDATION_VIEWER_PSEUDONYM_V1,
    purpose: RECOMMENDATION_VIEWER_PSEUDONYM_PURPOSE_V1,
    algorithm: RECOMMENDATION_VIEWER_PSEUDONYM_ALGORITHM_V1,
    clusterUnitVersion: VIEWER_CLUSTER_UNIT_VERSION,
    keyVersion: input.keyVersion,
    captureEpochId: input.captureEpochId,
    viewerAccountPseudonym,
    resourceDiagnostics,
    developmentEvidenceOnly: true as const,
    candidateEvidenceEligible: false as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
  };
}

function preimageFromCandidate(
  candidate: BrandedPseudonym,
  diagnostics: RecommendationViewerPseudonymResourceDiagnosticsV1,
) {
  return preimageFor(
    {
      keyVersion: safeGet(candidate, 'keyVersion') as string,
      captureEpochId: safeGet(candidate, 'captureEpochId') as string,
    },
    safeGet(candidate, 'viewerAccountPseudonym') as string,
    diagnostics,
  );
}

function plannedOutputBytes(
  input: Pick<CapturedInput, 'keyVersion' | 'captureEpochId'>,
  baseDiagnostics: Omit<RecommendationViewerPseudonymResourceDiagnosticsV1, 'plannedCanonicalOutputBytes'>,
): number {
  let plannedCanonicalOutputBytes = 0;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const resourceDiagnostics = { ...baseDiagnostics, plannedCanonicalOutputBytes };
    const next = canonicalBytes({
      ...preimageFor(input, '0'.repeat(64), resourceDiagnostics),
      pseudonymReceiptSha256: '0'.repeat(64),
    });
    if (next === plannedCanonicalOutputBytes) return next;
    plannedCanonicalOutputBytes = next;
  }
  return Number.POSITIVE_INFINITY;
}

function readDiagnostics(value: unknown): RecommendationViewerPseudonymResourceDiagnosticsV1 | null {
  if (!isObjectLike(value)) return null;
  const candidate = {
    preflightCompletedBeforeCryptography: safeGet(value, 'preflightCompletedBeforeCryptography'),
    masterKeyBytes: safeGet(value, 'masterKeyBytes'),
    viewerIdUtf8Bytes: safeGet(value, 'viewerIdUtf8Bytes'),
    publicContextBytes: safeGet(value, 'publicContextBytes'),
    hmacMessageBytes: safeGet(value, 'hmacMessageBytes'),
    plannedCanonicalOutputBytes: safeGet(value, 'plannedCanonicalOutputBytes'),
    cryptographicOperations: safeGet(value, 'cryptographicOperations'),
    workUnits: safeGet(value, 'workUnits'),
  };
  if (candidate.preflightCompletedBeforeCryptography !== true
    || candidate.masterKeyBytes !== 32
    || candidate.cryptographicOperations !== 3
    || !nonnegativeSafeInteger(candidate.viewerIdUtf8Bytes)
    || !nonnegativeSafeInteger(candidate.publicContextBytes)
    || !nonnegativeSafeInteger(candidate.hmacMessageBytes)
    || !nonnegativeSafeInteger(candidate.plannedCanonicalOutputBytes)
    || !nonnegativeSafeInteger(candidate.workUnits)
    || candidate.viewerIdUtf8Bytes > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumViewerIdUtf8Bytes
    || candidate.plannedCanonicalOutputBytes > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumCanonicalOutputBytes
    || candidate.workUnits > RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumWorkUnits) return null;
  return candidate as RecommendationViewerPseudonymResourceDiagnosticsV1;
}

function canonicalBytes(value: unknown): number {
  return Buffer.byteLength(canonicalDecisionJson(value), 'utf8');
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

function safeGet(value: unknown, key: PropertyKey): unknown {
  try {
    return isObjectLike(value) ? Reflect.get(value, key) : undefined;
  } catch {
    return undefined;
  }
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function isMetadataId(value: unknown): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1.maximumMetadataUtf8Bytes
    && METADATA_ID.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && HEX_SHA256.test(value);
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isObjectLike(value) || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function deepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!isObjectLike(value) || seen.has(value)) return true;
  seen.add(value);
  try {
    return Object.isFrozen(value)
      && Reflect.ownKeys(value).every((key) => deepFrozen(Reflect.get(value, key), seen));
  } catch {
    return false;
  }
}

function reject(
  blocker: RecommendationViewerPseudonymBuildBlockerV1,
): RecommendationViewerPseudonymBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
