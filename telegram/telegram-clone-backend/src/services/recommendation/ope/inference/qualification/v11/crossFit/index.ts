import {
  isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
  type VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
} from '../evidenceEnvelope';
import {
  phase21CanonicalBytes,
  phase21CompareText,
  phase21Digest,
  phase21Freeze,
  phase21IsFrozen,
  phase21IsNonnegativeSafeInteger,
  phase21IsObjectLike,
  phase21IsSha256,
  phase21SafeGet,
} from '../privateCore';
import {
  PHASE21_CROSS_FIT_BLOCKERS_V1,
  PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1,
  VERIFIED_PHASE21_CLUSTER_AWARE_CROSS_FIT_AUDIT_V1,
  type Phase21CrossFitBlockerV1,
  type Phase21CrossFitBuildResultV1,
  type Phase21CrossFitRowV1,
  type VerifiedPhase21ClusterAwareCrossFitAuditV1,
} from './contracts';

export * from './contracts';

const verifiedAudit = Symbol('verifiedPhase21ClusterAwareCrossFitAuditV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1>();

type BrandedAudit = VerifiedPhase21ClusterAwareCrossFitAuditV1 & {
  readonly [verifiedAudit]: true;
};

export function buildPhase21ClusterAwareCrossFitAuditV1(
  input: unknown,
): Phase21CrossFitBuildResultV1 {
  try {
    const fields = readInput(input);
    if (!fields) return reject('phase21_cross_fit_source_unverified');
    const envelope = fields.evidenceEnvelope;
    if (!isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(envelope)) {
      return reject('phase21_cross_fit_source_unverified');
    }

    const plannedRows = fields.plannedRows;
    if (plannedRows !== undefined
      && (!phase21IsNonnegativeSafeInteger(plannedRows)
        || plannedRows > PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumRows)) {
      return reject('phase21_cross_fit_resource_limit_exceeded');
    }
    const assignmentDomain = fields.assignmentDomain;
    const foldAssignmentMode = fields.foldAssignmentMode;
    if (assignmentDomain === 'decision_id_v1'
      || assignmentDomain === 'decision_only_v1'
      || foldAssignmentMode === 'decision_only') {
      return reject('phase21_cross_fit_decision_only_fold_rejected');
    }
    if (assignmentDomain !== 'viewer_time_cluster_cross_fit_v1'
      || (foldAssignmentMode !== undefined
        && foldAssignmentMode !== 'viewer_time_cluster')) {
      return reject('phase21_cross_fit_binding_mismatch');
    }
    if ((fields.predictionReceiptSha256 !== undefined
        && fields.predictionReceiptSha256 !== null)
      || (fields.qHatProvenance !== undefined && fields.qHatProvenance !== null)) {
      return reject('phase21_cross_fit_binding_mismatch');
    }

    if (!plannedFieldWithinCap(fields.plannedFolds, PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumFolds)
      || !plannedFieldWithinCap(
        fields.plannedCanonicalInputBytes,
        PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumCanonicalInputBytes,
      )
      || !plannedFieldWithinCap(
        fields.plannedWorkUnits,
        PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumWorkUnits,
      )) {
      return reject('phase21_cross_fit_resource_limit_exceeded');
    }

    const rowFields = readRowsInput(fields.source);
    if (!rowFields) return reject('phase21_cross_fit_source_unverified');
    if (plannedRows !== undefined
      && rowFields.rowCount !== null
      && rowFields.rowCount > plannedRows) {
      return reject('phase21_cross_fit_resource_limit_exceeded');
    }
    const rowsResult = copyRows(rowFields.rows, rowFields.rowCount);
    if ('blocker' in rowsResult) return reject(rowsResult.blocker);
    const rows = rowsResult.rows;
    if (plannedRows !== undefined && rows.length > plannedRows) {
      return reject('phase21_cross_fit_resource_limit_exceeded');
    }
    const foldCountValue = rowFields.foldCount;
    let foldCount: number | null;
    if (foldCountValue === undefined) {
      foldCount = rows.length === 0 ? null : new Set(rows.map((row) => row.foldId)).size;
    } else if (foldCountValue === null && rows.length === 0) {
      foldCount = null;
    } else {
      if (typeof foldCountValue !== 'number'
        || !Number.isSafeInteger(foldCountValue)
        || foldCountValue < 2
        || foldCountValue > PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumFolds) {
        return reject('phase21_cross_fit_binding_mismatch');
      }
      foldCount = foldCountValue;
    }
    const leakage = findLeakage(rows);
    if (leakage) return reject(leakage);
    if (foldCount !== null && foldCount < 2) {
      return reject('phase21_cross_fit_binding_mismatch');
    }
    if (foldCount !== null && !completeFolds(rows, foldCount)) {
      return reject('phase21_cross_fit_binding_mismatch');
    }

    const canonicalInput = {
      evidenceEnvelopeSha256: envelope.envelopeSha256,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1' as const,
      foldCount,
      rows,
    };
    const foldAssignmentSha256 = phase21Digest(canonicalInput);
    if (!phase21IsSha256(fields.foldAssignmentSha256)
      || fields.foldAssignmentSha256 !== foldAssignmentSha256) {
      return reject('phase21_cross_fit_binding_mismatch');
    }
    const canonicalInputBytes = phase21CanonicalBytes(canonicalInput);
    const workUnits = rows.length * 2 + (foldCount ?? 0);
    if (!plannedResourceAllows(fields, rows.length, foldCount ?? 0, canonicalInputBytes, workUnits)) {
      return reject('phase21_cross_fit_resource_limit_exceeded');
    }
    if (canonicalInputBytes > PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumCanonicalInputBytes
      || workUnits > PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumWorkUnits) {
      return reject('phase21_cross_fit_resource_limit_exceeded');
    }

    const preimage = {
      contractVersion: VERIFIED_PHASE21_CLUSTER_AWARE_CROSS_FIT_AUDIT_V1,
      status: 'not_ready' as const,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1' as const,
      foldCount,
      viewerHoldoutLeakageExcluded: false as const,
      timeHoldoutLeakageExcluded: false as const,
      cellLeakageExcluded: false as const,
      decisionOnlyFoldRejected: true as const,
      realViewerTimeProvenancePresent: false as const,
      qHatCrossFitVerified: false as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      sourceBindings: {
        evidenceEnvelopeSha256: envelope.envelopeSha256,
        predictionReceiptSha256: null,
        foldAssignmentSha256,
      },
      rows,
      blockers: PHASE21_CROSS_FIT_BLOCKERS_V1,
      resourceDiagnostics: {
        preflightCompletedBeforeRows: true as const,
        rows: rows.length,
        folds: foldCount ?? 0,
        workUnits,
        canonicalInputBytes,
        candidateCalls: 0 as const,
        inferenceCalls: 0 as const,
      },
    };
    const candidate = {
      ...preimage,
      auditSha256: phase21Digest(preimage),
    } as unknown as BrandedAudit;
    Object.defineProperty(candidate, verifiedAudit, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    verifiedObjects.add(candidate);
    phase21Freeze(candidate);
    verifiedDigests.set(candidate, candidate.auditSha256);
    verifiedOwners.set(candidate, envelope);
    return { status: 'verified', audit: candidate };
  } catch {
    return reject('phase21_cross_fit_source_unverified');
  }
}

export const buildVerifiedPhase21ClusterAwareCrossFitAuditV1 =
  buildPhase21ClusterAwareCrossFitAuditV1;
export const buildPhase21VerifiedClusterAwareCrossFitAuditV1 =
  buildPhase21ClusterAwareCrossFitAuditV1;

export function isVerifiedPhase21ClusterAwareCrossFitAuditV1(
  value: unknown,
): value is BrandedAudit {
  try {
    if (!phase21IsObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedAudit;
    const owner = verifiedOwners.get(candidate);
    if (!owner || !isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(owner)) return false;
    const auditSha256 = phase21SafeGet(candidate, 'auditSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'auditSha256')) return false;
    return phase21SafeGet(candidate, verifiedAudit) === true
      && phase21IsFrozen(candidate)
      && phase21IsSha256(auditSha256)
      && auditSha256 === phase21Digest(preimage)
      && verifiedDigests.get(candidate) === auditSha256
      && phase21SafeGet(candidate, 'status') === 'not_ready'
      && phase21SafeGet(candidate, 'decisionOnlyFoldRejected') === true
      && phase21SafeGet(candidate, 'realDatasetEligible') === false
      && phase21SafeGet(candidate, 'candidateEvidenceEligible') === false
      && phase21SafeGet(candidate, 'qualificationEvidenceEligible') === false
      && stableBlockers(phase21SafeGet(candidate, 'blockers'))
      && auditBindingsMatch(candidate, owner);
  } catch {
    return false;
  }
}

export const isVerifiedClusterAwareCrossFitAuditV1 =
  isVerifiedPhase21ClusterAwareCrossFitAuditV1;

function readInput(value: unknown): Readonly<{
  source: object;
  evidenceEnvelope: unknown;
  assignmentDomain: unknown;
  foldAssignmentMode: unknown;
  foldAssignmentSha256: unknown;
  predictionReceiptSha256: unknown;
  qHatProvenance: unknown;
  plannedRows: unknown;
  plannedFolds: unknown;
  plannedCanonicalInputBytes: unknown;
  plannedWorkUnits: unknown;
}> | null {
  if (!phase21IsObjectLike(value)) return null;
  try {
    return {
      source: value,
      evidenceEnvelope: Reflect.get(value, 'evidenceEnvelope')
        ?? Reflect.get(value, 'envelope'),
      assignmentDomain: Reflect.get(value, 'assignmentDomain'),
      foldAssignmentMode: Reflect.get(value, 'foldAssignmentMode'),
      foldAssignmentSha256: Reflect.get(value, 'foldAssignmentSha256'),
      predictionReceiptSha256: Reflect.get(value, 'predictionReceiptSha256'),
      qHatProvenance: Reflect.get(value, 'qHatProvenance'),
      plannedRows: Reflect.get(value, 'plannedRows'),
      plannedFolds: Reflect.get(value, 'plannedFolds'),
      plannedCanonicalInputBytes: Reflect.get(value, 'plannedCanonicalInputBytes'),
      plannedWorkUnits: Reflect.get(value, 'plannedWorkUnits'),
    };
  } catch {
    return null;
  }
}

function readRowsInput(value: object): Readonly<{
  rows: unknown;
  foldCount: unknown;
  rowCount: number | null;
}> | null {
  try {
    const rows = Reflect.get(value, 'rows');
    let rowCount: number | null = null;
    if (Array.isArray(rows)) {
      const length = Reflect.get(rows, 'length');
      if (!Number.isSafeInteger(length) || length < 0) return null;
      rowCount = length;
    }
    return {
      rows,
      foldCount: Reflect.get(value, 'foldCount'),
      rowCount,
    };
  } catch {
    return null;
  }
}

function plannedFieldWithinCap(value: unknown, maximum: number): boolean {
  return value === undefined
    || (phase21IsNonnegativeSafeInteger(value) && value <= maximum);
}

function plannedResourceAllows(
  fields: Readonly<{
    plannedFolds: unknown;
    plannedCanonicalInputBytes: unknown;
    plannedWorkUnits: unknown;
  }>,
  rows: number,
  folds: number,
  canonicalInputBytes: number,
  workUnits: number,
): boolean {
  const limits = PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1;
  const checks: readonly [unknown, number, number][] = [
    [fields.plannedFolds, folds, limits.maximumFolds],
    [fields.plannedCanonicalInputBytes, canonicalInputBytes, limits.maximumCanonicalInputBytes],
    [fields.plannedWorkUnits, workUnits, limits.maximumWorkUnits],
  ];
  return rows <= limits.maximumRows && checks.every(([planned, actual, maximum]) => (
    planned === undefined
      || (phase21IsNonnegativeSafeInteger(planned)
        && planned >= actual
        && planned <= maximum)
  ));
}

function auditBindingsMatch(
  value: BrandedAudit,
  owner: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
): boolean {
  const rows = phase21SafeGet(value, 'rows');
  const foldCount = phase21SafeGet(value, 'foldCount');
  const assignmentDomain = phase21SafeGet(value, 'assignmentDomain');
  const sourceBindings = phase21SafeGet(value, 'sourceBindings');
  return Array.isArray(rows)
    && (foldCount === null || phase21IsNonnegativeSafeInteger(foldCount))
    && assignmentDomain === 'viewer_time_cluster_cross_fit_v1'
    && phase21IsObjectLike(sourceBindings)
    && phase21SafeGet(sourceBindings, 'evidenceEnvelopeSha256') === owner.envelopeSha256
    && phase21SafeGet(sourceBindings, 'predictionReceiptSha256') === null
    && phase21SafeGet(sourceBindings, 'foldAssignmentSha256') === phase21Digest({
      evidenceEnvelopeSha256: owner.envelopeSha256,
      assignmentDomain,
      foldCount,
      rows,
    });
}

function copyRows(value: unknown, expectedLength: number | null = null):
  | { rows: readonly Phase21CrossFitRowV1[] }
  | { blocker: Phase21CrossFitBlockerV1 } {
  if (value === undefined) return { rows: Object.freeze([]) };
  if (!Array.isArray(value)) return { blocker: 'phase21_cross_fit_source_unverified' };
  let length: number;
  try {
    length = Reflect.get(value, 'length');
  } catch {
    return { blocker: 'phase21_cross_fit_source_unverified' };
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    return { blocker: 'phase21_cross_fit_source_unverified' };
  }
  if (length > PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1.maximumRows
    || (expectedLength !== null && length !== expectedLength)) {
    return { blocker: 'phase21_cross_fit_resource_limit_exceeded' };
  }
  const rows: Phase21CrossFitRowV1[] = [];
  const rowIds = new Set<string>();
  try {
    for (let index = 0; index < length; index += 1) {
      const raw = Reflect.get(value, index);
      if (!phase21IsObjectLike(raw)) return { blocker: 'phase21_cross_fit_source_unverified' };
      const rowId = phase21SafeGet(raw, 'rowId');
      const decisionId = phase21SafeGet(raw, 'decisionId');
      const viewerClusterId = phase21SafeGet(raw, 'viewerClusterId');
      const timeClusterId = phase21SafeGet(raw, 'timeClusterId');
      const foldId = phase21SafeGet(raw, 'foldId');
      const role = phase21SafeGet(raw, 'role');
      if (![rowId, decisionId, viewerClusterId, timeClusterId].every(
        (item) => typeof item === 'string' && item.length > 0,
      ) || typeof foldId !== 'number' || !Number.isSafeInteger(foldId) || foldId < 0
        || (role !== 'train' && role !== 'evaluation')) {
        return { blocker: 'phase21_cross_fit_binding_mismatch' };
      }
      if (rowIds.has(rowId as string)) {
        return { blocker: 'phase21_cross_fit_binding_mismatch' };
      }
      rowIds.add(rowId as string);
      rows.push({
        rowId: rowId as string,
        decisionId: decisionId as string,
        viewerClusterId: viewerClusterId as string,
        timeClusterId: timeClusterId as string,
        foldId: foldId as number,
        role,
      });
    }
  } catch {
    return { blocker: 'phase21_cross_fit_source_unverified' };
  }
  rows.sort((left, right) => phase21CompareText(left.rowId, right.rowId));
  return { rows: phase21Freeze(rows) };
}

function completeFolds(rows: readonly Phase21CrossFitRowV1[], foldCount: number): boolean {
  for (let foldId = 0; foldId < foldCount; foldId += 1) {
    if (!rows.some((row) => row.foldId === foldId && row.role === 'train')
      || !rows.some((row) => row.foldId === foldId && row.role === 'evaluation')) {
      return false;
    }
  }
  return rows.every((row) => row.foldId < foldCount);
}

function findLeakage(rows: readonly Phase21CrossFitRowV1[]): Phase21CrossFitBlockerV1 | null {
  const evaluations = rows.filter((row) => row.role === 'evaluation');
  const training = rows.filter((row) => row.role === 'train');
  for (const evaluation of evaluations) {
    if (training.some((row) => row.foldId === evaluation.foldId
      && (row.viewerClusterId === evaluation.viewerClusterId
        || row.timeClusterId === evaluation.timeClusterId))) {
      return 'phase21_cross_fit_viewer_time_leakage';
    }
  }
  return null;
}

function stableBlockers(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === PHASE21_CROSS_FIT_BLOCKERS_V1.length
    && PHASE21_CROSS_FIT_BLOCKERS_V1.every(
      (blocker, index) => phase21SafeGet(value, index) === blocker,
    );
}

function reject(blocker: Phase21CrossFitBlockerV1): Phase21CrossFitBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
