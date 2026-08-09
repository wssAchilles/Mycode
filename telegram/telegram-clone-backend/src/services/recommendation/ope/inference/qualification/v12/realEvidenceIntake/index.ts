import {
  isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1,
  type Phase21SameProcessHonestNoCandidateHandoffV1,
} from '../../v11/handoff';
import {
  isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
  type VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
} from '../../v11/evidenceEnvelope';
import {
  isVerifiedPhase21DataAdequacyAssessmentV1,
  type VerifiedPhase21DataAdequacyAssessmentV1,
} from '../../v11/adequacy';
import {
  isVerifiedPhase21ClusterAwareCrossFitAuditV1,
  type VerifiedPhase21ClusterAwareCrossFitAuditV1,
} from '../../v11/crossFit';
import {
  phase22CanonicalBytes,
  phase22Digest,
  phase22Freeze,
  phase22IsFrozen,
  phase22IsNonnegativeSafeInteger,
  phase22IsObjectLike,
  phase22IsSha256,
  phase22SafeGet,
} from '../privateCore';
import {
  PHASE22_REAL_EVIDENCE_ESTIMAND_V1,
  PHASE22_REAL_EVIDENCE_GAPS_V1,
  PHASE22_REAL_EVIDENCE_INTAKE_BLOCKERS_V1,
  PHASE22_REAL_EVIDENCE_INTAKE_V1,
  PHASE22_REAL_EVIDENCE_RESOURCE_LIMITS_V1,
  type Phase22RealEvidenceBoundsV1,
  type Phase22RealEvidenceBytesV1,
  type Phase22RealEvidenceCountsV1,
  type Phase22RealEvidenceCrossFitV1,
  type Phase22RealEvidenceIntakeBlockerV1,
  type Phase22RealEvidenceIntakeBuildResultV1,
  type Phase22RealEvidenceResourceDiagnosticsV1,
  type Phase22RealEvidenceSourceBindingsV1,
  type Phase22RealEvidenceStoppingRuleV1,
  type VerifiedPhase22RealEvidenceIntakeV1,
} from './contracts';

export * from './contracts';

const verifiedIntake = Symbol('verifiedPhase22RealEvidenceIntakeV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Phase21Sources>();

type BrandedIntake = VerifiedPhase22RealEvidenceIntakeV1 & {
  readonly [verifiedIntake]: true;
};

export function buildPhase22RealEvidenceIntakeV1(
  input: unknown,
): Phase22RealEvidenceIntakeBuildResultV1 {
  try {
    if (!phase22IsObjectLike(input)) return reject('phase22_intake_source_unverified');
    // Resource rejection must happen before any source or attestation property is read.
    const plannedResourceRead = readProperty(input, 'plannedResources');
    if (!plannedResourceRead.ok) return reject('phase22_intake_source_unverified');
    if (!resourcePlanWithinLimits(plannedResourceRead.value)) {
      return reject('phase22_intake_resource_limit_exceeded');
    }
    const fields = readInput(input, plannedResourceRead.value);
    if (!fields) return reject('phase22_intake_source_unverified');

    // There is no trusted real-evidence producer in this phase. A caller may
    // not mint a receipt by supplying hashes or boolean attestations.
    if (callerAttestationPresent(input)) {
      return reject('phase22_intake_source_unverified');
    }

    const sourceResult = validateSources(
      fields.phase21Handoff,
      fields.evidenceEnvelope,
      fields.assessment,
      fields.crossFit,
    );
    if (sourceResult.status === 'source_unverified') {
      return reject('phase22_intake_source_unverified');
    }
    if (sourceResult.status === 'binding_mismatch') {
      return reject('phase22_intake_binding_mismatch');
    }
    const sources = sourceResult.sources;

    const sourceBindings: Phase22RealEvidenceSourceBindingsV1 = {
      phase21HandoffSha256: sources.phase21HandoffSha256,
      phase21EvidenceEnvelopeSha256: sources.phase21EvidenceEnvelopeSha256,
      phase21AssessmentSha256: sources.phase21AssessmentSha256,
      phase21CrossFitAuditSha256: sources.phase21CrossFitAuditSha256,
      pitSnapshotSha256: null,
      decisionContextSha256: null,
      targetEvidenceSha256: null,
      outcomeEvidenceSha256: null,
      opeReceiptSha256: null,
      predictionReceiptSha256: null,
      viewerTimeMembershipSha256: null,
      crossFitReceiptSha256: null,
      realEvidenceReceiptSha256: null,
    };
    const canonicalInputBytes = phase22CanonicalBytes(sourceBindings);
    const resourceDiagnostics: Phase22RealEvidenceResourceDiagnosticsV1 = {
      preflightCompletedBeforeSourceScan: true,
      records: 0,
      sourceBytes: 0,
      canonicalInputBytes,
      workUnits: 0,
      candidateCalls: 0,
      inferenceCalls: 0,
      publicationCalls: 0,
    };
    if (!resourcePlanAllows(fields.plannedResources, resourceDiagnostics)) {
      return reject('phase22_intake_resource_limit_exceeded');
    }

    const preimage = {
      contractVersion: PHASE22_REAL_EVIDENCE_INTAKE_V1,
      intakeKind: 'real_evidence_intake_v1' as const,
      status: 'not_ready' as const,
      intakeStatus: 'not_ready' as const,
      sourceStatus: 'unavailable' as const,
      receiptIntegrityStatus: 'not_ready' as const,
      evidenceStatus: 'not_ready' as const,
      qualificationReadiness: 'not_ready' as const,
      sealedQualificationStatus: 'not_ready' as const,
      estimand: PHASE22_REAL_EVIDENCE_ESTIMAND_V1,
      datasetVersion: null,
      sourceRoots: null,
      sourceBindings,
      recordCount: 0 as const,
      byteCount: 0 as const,
      sealedAt: null,
      maxObservationAt: null,
      clusterUnitVersion: null,
      timeClusterUnitVersion: null,
      cellUnitVersion: null,
      viewerTimeCellMembershipPresent: false as const,
      viewerClusterProvenancePresent: false as const,
      timeClusterProvenancePresent: false as const,
      realMultiwayClusterProvenancePresent: false as const,
      counts: { records: 0, viewers: 0, times: 0, cells: 0 } as const,
      bytes: { source: 0, canonicalInput: canonicalInputBytes },
      support: {
        fullSupportVerified: false,
        randomizedPropensityVerified: false,
        minimumBehaviorPropensity: null,
        maximumPrefixWeight: null,
      } as const,
      bounds: {
        rewardMinimum: null,
        rewardMaximum: null,
        weightMaximum: null,
        qHatMinimum: null,
        qHatMaximum: null,
      } as const,
      crossFit: {
        viewerTimeCellLeakageExcluded: false,
        qHatCrossFitVerified: false,
        foldAssignmentSha256: null,
      } as const,
      stoppingRule: { verified: false, ruleVersion: null } as const,
      evidenceGaps: PHASE22_REAL_EVIDENCE_GAPS_V1,
      blockers: PHASE22_REAL_EVIDENCE_INTAKE_BLOCKERS_V1,
      candidateSelectionStatus: 'no_candidate_selected' as const,
      candidateQualificationStatus: 'not_run' as const,
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      resourceDiagnostics,
    } satisfies Omit<VerifiedPhase22RealEvidenceIntakeV1, 'intakeSha256'>;

    const candidate = {
      ...preimage,
      intakeSha256: phase22Digest(preimage),
    } as unknown as BrandedIntake;
    Object.defineProperty(candidate, verifiedIntake, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    phase22Freeze(candidate);
    verifiedObjects.add(candidate);
    verifiedDigests.set(candidate, candidate.intakeSha256);
    verifiedOwners.set(candidate, Object.freeze(sources));
    return { status: 'verified', intake: candidate };
  } catch {
    return reject('phase22_intake_source_unverified');
  }
}

export const buildVerifiedPhase22RealEvidenceIntakeV1 =
  buildPhase22RealEvidenceIntakeV1;
export const buildPhase22VerifiedRealEvidenceIntakeV1 =
  buildPhase22RealEvidenceIntakeV1;

export function isVerifiedPhase22RealEvidenceIntakeV1(
  value: unknown,
): value is BrandedIntake {
  try {
    if (!phase22IsObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedIntake;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || phase22SafeGet(candidate, verifiedIntake) !== true
      || !phase22IsFrozen(candidate)
      || !isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(owners.phase21Handoff)
      || !isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(owners.evidenceEnvelope)
      || !isVerifiedPhase21DataAdequacyAssessmentV1(owners.assessment)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(owners.crossFit)) return false;
    const digest = phase22SafeGet(candidate, 'intakeSha256');
    if (!phase22IsSha256(digest)) return false;
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'intakeSha256')) return false;
    return digest === phase22Digest(preimage)
      && verifiedDigests.get(candidate) === digest
      && fixedIntakeState(candidate)
      && sourceBindingsMatch(candidate, owners);
  } catch {
    return false;
  }
}

export const isVerifiedRealEvidenceIntakeV1 = isVerifiedPhase22RealEvidenceIntakeV1;

type IntakeFields = Readonly<{
  phase21Handoff: unknown;
  evidenceEnvelope: unknown;
  assessment: unknown;
  crossFit: unknown;
  realEvidenceReceipt: unknown;
  plannedResources: unknown;
}>;

function readInput(value: unknown, plannedResources: unknown): IntakeFields | null {
  if (!phase22IsObjectLike(value)) return null;
  try {
    return {
      phase21Handoff: firstDefined(value, 'phase21Handoff', 'handoff', 'phase21'),
      evidenceEnvelope: firstDefined(value, 'evidenceEnvelope', 'envelope'),
      assessment: firstDefined(value, 'assessment', 'adequacy', 'dataAdequacy'),
      crossFit: firstDefined(value, 'crossFit', 'crossFitAudit', 'audit'),
      realEvidenceReceipt: firstDefined(value, 'realEvidenceReceipt', 'sourceReceipt', 'receipt'),
      plannedResources,
    };
  } catch {
    return null;
  }
}

const PHASE22_RECEIPT_ATTESTATION_KEYS = Object.freeze([
  'realEvidenceReceipt',
  'sourceReceipt',
  'receipt',
  'sourceRoots',
  'datasetVersion',
  'pitSnapshotSha256',
  'decisionContextSha256',
  'targetEvidenceSha256',
  'outcomeEvidenceSha256',
  'opeReceiptSha256',
  'predictionReceiptSha256',
  'viewerTimeMembershipSha256',
  'crossFitReceiptSha256',
  'realEvidenceReceiptSha256',
] as const);

const PHASE22_BOOLEAN_ATTESTATION_KEYS = Object.freeze([
  'viewerTimeCellMembershipPresent',
  'viewerClusterProvenancePresent',
  'timeClusterProvenancePresent',
  'realMultiwayClusterProvenancePresent',
  'fullSupportVerified',
  'randomizedPropensityVerified',
  'qHatCrossFitVerified',
  'viewerTimeCellLeakageExcluded',
  'stoppingRuleVerified',
  'candidateEvidenceEligible',
  'qualificationEvidenceEligible',
  'realDatasetEligible',
  'servable',
] as const);

function callerAttestationPresent(value: unknown): boolean {
  if (!phase22IsObjectLike(value)) return true;
  for (const key of PHASE22_RECEIPT_ATTESTATION_KEYS) {
    const read = readProperty(value, key);
    if (!read.ok || (read.value !== undefined && read.value !== null)) return true;
  }
  for (const key of PHASE22_BOOLEAN_ATTESTATION_KEYS) {
    const read = readProperty(value, key);
    if (!read.ok || read.value !== undefined) return true;
  }
  return false;
}

function firstDefined(value: object, ...keys: readonly PropertyKey[]): unknown {
  for (const key of keys) {
    const read = readProperty(value, key);
    if (!read.ok) return undefined;
    if (read.value !== undefined) return read.value;
  }
  return undefined;
}

function readProperty(value: object, key: PropertyKey): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: Reflect.get(value, key) };
  } catch {
    return { ok: false };
  }
}

type Phase21Sources = Readonly<{
  phase21Handoff: Phase21SameProcessHonestNoCandidateHandoffV1;
  evidenceEnvelope: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1;
  assessment: VerifiedPhase21DataAdequacyAssessmentV1;
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1;
  phase21HandoffSha256: string;
  phase21EvidenceEnvelopeSha256: string;
  phase21AssessmentSha256: string;
  phase21CrossFitAuditSha256: string;
}>;

type SourceValidation =
  | Readonly<{ status: 'verified'; sources: Phase21Sources }>
  | Readonly<{ status: 'source_unverified' }>
  | Readonly<{ status: 'binding_mismatch' }>;

function validateSources(
  phase21Handoff: unknown,
  evidenceEnvelope: unknown,
  assessment: unknown,
  crossFit: unknown,
): SourceValidation {
  if (!isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(phase21Handoff)
    || !isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(evidenceEnvelope)
    || !isVerifiedPhase21DataAdequacyAssessmentV1(assessment)
    || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(crossFit)) {
    return { status: 'source_unverified' };
  }

  const handoffSha256 = phase22SafeGet(phase21Handoff, 'handoffSha256');
  const envelopeSha256 = phase22SafeGet(evidenceEnvelope, 'envelopeSha256');
  const assessmentSha256 = phase22SafeGet(assessment, 'assessmentSha256');
  const crossFitSha256 = phase22SafeGet(crossFit, 'auditSha256');
  if (!phase22IsSha256(handoffSha256)
    || !phase22IsSha256(envelopeSha256)
    || !phase22IsSha256(assessmentSha256)
    || !phase22IsSha256(crossFitSha256)) return { status: 'binding_mismatch' };

  if (phase22SafeGet(phase21Handoff, 'phase21EvidenceEnvelopeSha256') !== envelopeSha256
    || phase22SafeGet(phase21Handoff, 'phase21AssessmentSha256') !== assessmentSha256
    || phase22SafeGet(phase21Handoff, 'phase21CrossFitAuditSha256') !== crossFitSha256) {
    return { status: 'binding_mismatch' };
  }

  const assessmentBindings = phase22SafeGet(assessment, 'sourceBindings');
  const crossFitBindings = phase22SafeGet(crossFit, 'sourceBindings');
  if (!phase22IsObjectLike(assessmentBindings) || !phase22IsObjectLike(crossFitBindings)
    || phase22SafeGet(assessmentBindings, 'evidenceEnvelopeSha256') !== envelopeSha256
    || phase22SafeGet(assessmentBindings, 'crossFitAuditSha256') !== crossFitSha256
    || phase22SafeGet(crossFitBindings, 'evidenceEnvelopeSha256') !== envelopeSha256) {
    return { status: 'binding_mismatch' };
  }

  if (phase22SafeGet(evidenceEnvelope, 'estimand') !== PHASE22_REAL_EVIDENCE_ESTIMAND_V1
    || phase22SafeGet(assessment, 'estimand') !== PHASE22_REAL_EVIDENCE_ESTIMAND_V1
    || phase22SafeGet(phase21Handoff, 'candidateSelectionStatus') !== 'no_candidate_selected'
    || phase22SafeGet(phase21Handoff, 'selectedMethod') !== 'diagnostics_only_abstention_v1') {
    return { status: 'binding_mismatch' };
  }

  return {
    status: 'verified',
    sources: {
      phase21Handoff,
      evidenceEnvelope,
      assessment,
      crossFit,
      phase21HandoffSha256: handoffSha256,
      phase21EvidenceEnvelopeSha256: envelopeSha256,
      phase21AssessmentSha256: assessmentSha256,
      phase21CrossFitAuditSha256: crossFitSha256,
    },
  };
}

function resourcePlanAllows(value: unknown, actual: Phase22RealEvidenceResourceDiagnosticsV1): boolean {
  const limits = PHASE22_REAL_EVIDENCE_RESOURCE_LIMITS_V1;
  if (actual.records > limits.maximumRecords
    || actual.sourceBytes > limits.maximumSourceBytes
    || actual.canonicalInputBytes > limits.maximumCanonicalInputBytes
    || actual.workUnits > limits.maximumWorkUnits) return false;
  if (!resourcePlanWithinLimits(value)) return false;
  if (value === undefined || value === null) return true;
  if (!phase22IsObjectLike(value)) return false;
  const records = readProperty(value, 'records');
  const sourceBytes = readProperty(value, 'sourceBytes');
  const canonicalInputBytes = readProperty(value, 'canonicalInputBytes');
  const workUnits = readProperty(value, 'workUnits');
  if (!records.ok || !sourceBytes.ok || !canonicalInputBytes.ok || !workUnits.ok) return false;
  const recordCount = records.value;
  const sourceByteCount = sourceBytes.value;
  const canonicalByteCount = canonicalInputBytes.value;
  const workUnitCount = workUnits.value;
  if (!phase22IsNonnegativeSafeInteger(recordCount)
    || !phase22IsNonnegativeSafeInteger(sourceByteCount)
    || !phase22IsNonnegativeSafeInteger(canonicalByteCount)
    || !phase22IsNonnegativeSafeInteger(workUnitCount)) return false;
  return recordCount >= actual.records
    && sourceByteCount >= actual.sourceBytes
    && canonicalByteCount >= actual.canonicalInputBytes
    && workUnitCount >= actual.workUnits
    && recordCount <= limits.maximumRecords
    && sourceByteCount <= limits.maximumSourceBytes
    && canonicalByteCount <= limits.maximumCanonicalInputBytes
    && workUnitCount <= limits.maximumWorkUnits;
}

function resourcePlanWithinLimits(value: unknown): boolean {
  const limits = PHASE22_REAL_EVIDENCE_RESOURCE_LIMITS_V1;
  if (value === undefined || value === null) return true;
  if (!phase22IsObjectLike(value)) return false;
  const records = readProperty(value, 'records');
  const sourceBytes = readProperty(value, 'sourceBytes');
  const canonicalInputBytes = readProperty(value, 'canonicalInputBytes');
  const workUnits = readProperty(value, 'workUnits');
  if (!records.ok || !sourceBytes.ok || !canonicalInputBytes.ok || !workUnits.ok) return false;
  return phase22IsNonnegativeSafeInteger(records.value)
    && phase22IsNonnegativeSafeInteger(sourceBytes.value)
    && phase22IsNonnegativeSafeInteger(canonicalInputBytes.value)
    && phase22IsNonnegativeSafeInteger(workUnits.value)
    && records.value <= limits.maximumRecords
    && sourceBytes.value <= limits.maximumSourceBytes
    && canonicalInputBytes.value <= limits.maximumCanonicalInputBytes
    && workUnits.value <= limits.maximumWorkUnits;
}

function sourceBindingsMatch(
  candidate: BrandedIntake,
  owners: Phase21Sources,
): boolean {
  const bindings = phase22SafeGet(candidate, 'sourceBindings');
  return phase22IsObjectLike(bindings)
    && phase22SafeGet(bindings, 'phase21HandoffSha256') === owners.phase21HandoffSha256
    && phase22SafeGet(bindings, 'phase21EvidenceEnvelopeSha256')
      === owners.phase21EvidenceEnvelopeSha256
    && phase22SafeGet(bindings, 'phase21AssessmentSha256') === owners.phase21AssessmentSha256
    && phase22SafeGet(bindings, 'phase21CrossFitAuditSha256')
      === owners.phase21CrossFitAuditSha256
    && phase22SafeGet(bindings, 'realEvidenceReceiptSha256') === null
    && phase22SafeGet(candidate, 'sourceStatus') === 'unavailable'
    && phase22SafeGet(candidate, 'realDatasetEligible') === false
    && phase22SafeGet(candidate, 'servable') === false;
}

function fixedIntakeState(candidate: BrandedIntake): boolean {
  const sourceBindings = phase22SafeGet(candidate, 'sourceBindings');
  const counts = phase22SafeGet(candidate, 'counts');
  const bytes = phase22SafeGet(candidate, 'bytes');
  const support = phase22SafeGet(candidate, 'support');
  const bounds = phase22SafeGet(candidate, 'bounds');
  const crossFit = phase22SafeGet(candidate, 'crossFit');
  const stoppingRule = phase22SafeGet(candidate, 'stoppingRule');
  const resourceDiagnostics = phase22SafeGet(candidate, 'resourceDiagnostics');
  return phase22SafeGet(candidate, 'contractVersion') === PHASE22_REAL_EVIDENCE_INTAKE_V1
    && phase22SafeGet(candidate, 'intakeKind') === 'real_evidence_intake_v1'
    && phase22SafeGet(candidate, 'status') === 'not_ready'
    && phase22SafeGet(candidate, 'intakeStatus') === 'not_ready'
    && phase22SafeGet(candidate, 'sourceStatus') === 'unavailable'
    && phase22SafeGet(candidate, 'receiptIntegrityStatus') === 'not_ready'
    && phase22SafeGet(candidate, 'evidenceStatus') === 'not_ready'
    && phase22SafeGet(candidate, 'qualificationReadiness') === 'not_ready'
    && phase22SafeGet(candidate, 'sealedQualificationStatus') === 'not_ready'
    && phase22SafeGet(candidate, 'estimand') === PHASE22_REAL_EVIDENCE_ESTIMAND_V1
    && phase22SafeGet(candidate, 'datasetVersion') === null
    && phase22SafeGet(candidate, 'sourceRoots') === null
    && phase22SafeGet(candidate, 'recordCount') === 0
    && phase22SafeGet(candidate, 'byteCount') === 0
    && phase22SafeGet(candidate, 'sealedAt') === null
    && phase22SafeGet(candidate, 'maxObservationAt') === null
    && phase22SafeGet(candidate, 'clusterUnitVersion') === null
    && phase22SafeGet(candidate, 'timeClusterUnitVersion') === null
    && phase22SafeGet(candidate, 'cellUnitVersion') === null
    && phase22SafeGet(candidate, 'viewerTimeCellMembershipPresent') === false
    && phase22SafeGet(candidate, 'viewerClusterProvenancePresent') === false
    && phase22SafeGet(candidate, 'timeClusterProvenancePresent') === false
    && phase22SafeGet(candidate, 'realMultiwayClusterProvenancePresent') === false
    && zeroCounts(counts)
    && zeroBytes(bytes, resourceDiagnostics)
    && unavailableSupport(support)
    && unavailableBounds(bounds)
    && unavailableCrossFit(crossFit)
    && unavailableStoppingRule(stoppingRule)
    && phase22SafeGet(candidate, 'candidateSelectionStatus') === 'no_candidate_selected'
    && phase22SafeGet(candidate, 'candidateQualificationStatus') === 'not_run'
    && phase22SafeGet(candidate, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && phase22SafeGet(candidate, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && phase22SafeGet(candidate, 'candidateEvidenceEligible') === false
    && phase22SafeGet(candidate, 'qualificationEvidenceEligible') === false
    && phase22SafeGet(candidate, 'realDatasetEligible') === false
    && phase22SafeGet(candidate, 'servable') === false
    && stableArray(phase22SafeGet(candidate, 'evidenceGaps'), PHASE22_REAL_EVIDENCE_GAPS_V1)
    && stableArray(phase22SafeGet(candidate, 'blockers'), PHASE22_REAL_EVIDENCE_INTAKE_BLOCKERS_V1)
    && phase22SafeGet(resourceDiagnostics, 'preflightCompletedBeforeSourceScan') === true
    && phase22SafeGet(resourceDiagnostics, 'records') === 0
    && phase22SafeGet(resourceDiagnostics, 'sourceBytes') === 0
    && phase22SafeGet(resourceDiagnostics, 'workUnits') === 0
    && phase22SafeGet(resourceDiagnostics, 'candidateCalls') === 0
    && phase22SafeGet(resourceDiagnostics, 'inferenceCalls') === 0
    && phase22SafeGet(resourceDiagnostics, 'publicationCalls') === 0
    && phase22SafeGet(sourceBindings, 'pitSnapshotSha256') === null
    && phase22SafeGet(sourceBindings, 'decisionContextSha256') === null
    && phase22SafeGet(sourceBindings, 'targetEvidenceSha256') === null
    && phase22SafeGet(sourceBindings, 'outcomeEvidenceSha256') === null
    && phase22SafeGet(sourceBindings, 'opeReceiptSha256') === null
    && phase22SafeGet(sourceBindings, 'predictionReceiptSha256') === null
    && phase22SafeGet(sourceBindings, 'viewerTimeMembershipSha256') === null
    && phase22SafeGet(sourceBindings, 'crossFitReceiptSha256') === null
    && phase22SafeGet(sourceBindings, 'realEvidenceReceiptSha256') === null;
}

function zeroCounts(value: unknown): boolean {
  return phase22IsObjectLike(value)
    && phase22SafeGet(value, 'records') === 0
    && phase22SafeGet(value, 'viewers') === 0
    && phase22SafeGet(value, 'times') === 0
    && phase22SafeGet(value, 'cells') === 0;
}

function zeroBytes(value: unknown, resourceDiagnostics: unknown): boolean {
  const canonicalInput = phase22SafeGet(value, 'canonicalInput');
  return phase22IsObjectLike(value)
    && phase22SafeGet(value, 'source') === 0
    && phase22IsNonnegativeSafeInteger(canonicalInput)
    && canonicalInput === phase22SafeGet(resourceDiagnostics, 'canonicalInputBytes');
}

function unavailableSupport(value: unknown): boolean {
  return phase22IsObjectLike(value)
    && phase22SafeGet(value, 'fullSupportVerified') === false
    && phase22SafeGet(value, 'randomizedPropensityVerified') === false
    && phase22SafeGet(value, 'minimumBehaviorPropensity') === null
    && phase22SafeGet(value, 'maximumPrefixWeight') === null;
}

function unavailableBounds(value: unknown): boolean {
  return phase22IsObjectLike(value)
    && phase22SafeGet(value, 'rewardMinimum') === null
    && phase22SafeGet(value, 'rewardMaximum') === null
    && phase22SafeGet(value, 'weightMaximum') === null
    && phase22SafeGet(value, 'qHatMinimum') === null
    && phase22SafeGet(value, 'qHatMaximum') === null;
}

function unavailableCrossFit(value: unknown): boolean {
  return phase22IsObjectLike(value)
    && phase22SafeGet(value, 'viewerTimeCellLeakageExcluded') === false
    && phase22SafeGet(value, 'qHatCrossFitVerified') === false
    && phase22SafeGet(value, 'foldAssignmentSha256') === null;
}

function unavailableStoppingRule(value: unknown): boolean {
  return phase22IsObjectLike(value)
    && phase22SafeGet(value, 'verified') === false
    && phase22SafeGet(value, 'ruleVersion') === null;
}

function stableArray(value: unknown, expected: readonly string[]): boolean {
  try {
    return Array.isArray(value)
      && value.length === expected.length
      && expected.every((entry, index) => phase22SafeGet(value, index) === entry);
  } catch {
    return false;
  }
}

function reject(blocker: Phase22RealEvidenceIntakeBlockerV1):
  Phase22RealEvidenceIntakeBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
