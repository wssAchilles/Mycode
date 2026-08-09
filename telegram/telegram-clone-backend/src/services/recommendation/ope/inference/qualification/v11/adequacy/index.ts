import {
  isVerifiedPhase20SameProcessNoCandidateHandoffV1,
  type Phase20SameProcessOfflineDiagnosticHandoffV1,
} from '../../v10/handoff';
import {
  isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
  type VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
} from '../evidenceEnvelope';
import {
  isVerifiedPhase21ClusterAwareCrossFitAuditV1,
  type VerifiedPhase21ClusterAwareCrossFitAuditV1,
} from '../crossFit';
import {
  phase21CanonicalBytes,
  phase21Digest,
  phase21Freeze,
  phase21IsFrozen,
  phase21IsNonnegativeSafeInteger,
  phase21IsObjectLike,
  phase21IsSha256,
  phase21SafeGet,
} from '../privateCore';
import {
  PHASE21_DATA_ADEQUACY_BLOCKERS_V1,
  PHASE21_DATA_ADEQUACY_RESOURCE_LIMITS_V1,
  VERIFIED_PHASE21_DATA_ADEQUACY_ASSESSMENT_V1,
  type Phase21DataAdequacyAssessmentBlockerV1,
  type Phase21DataAdequacyAssessmentResultV1,
  type VerifiedPhase21DataAdequacyAssessmentV1,
} from './contracts';

export * from './contracts';

const verifiedAssessment = Symbol('verifiedPhase21DataAdequacyAssessmentV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase20Handoff: Phase20SameProcessOfflineDiagnosticHandoffV1;
  evidenceEnvelope: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1;
  crossFitAudit: VerifiedPhase21ClusterAwareCrossFitAuditV1;
}>>();

type BrandedAssessment = VerifiedPhase21DataAdequacyAssessmentV1 & {
  readonly [verifiedAssessment]: true;
};

export function buildPhase21DataAdequacyAssessmentV1(
  input: unknown,
): Phase21DataAdequacyAssessmentResultV1 {
  try {
    const fields = readInput(input);
    if (!fields
      || !isVerifiedPhase20SameProcessNoCandidateHandoffV1(fields.phase20Handoff)
      || !isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(fields.evidenceEnvelope)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(fields.crossFitAudit)) {
      return reject('phase21_adequacy_source_unverified');
    }
    const { phase20Handoff, evidenceEnvelope, crossFitAudit } = fields;
    if (!bindingsMatch(phase20Handoff, evidenceEnvelope, crossFitAudit)) {
      return reject('phase21_adequacy_binding_mismatch');
    }
    const resourceDiagnostics = adequacyResourceDiagnostics(
      phase20Handoff,
      evidenceEnvelope,
      crossFitAudit,
    );
    if (!resourcePlanAllows(fields.plannedResources, resourceDiagnostics)) {
      return reject('phase21_adequacy_resource_limit_exceeded');
    }
    const preimage = {
      contractVersion: VERIFIED_PHASE21_DATA_ADEQUACY_ASSESSMENT_V1,
      estimand: 'mean_reward_per_logged_slot_v1' as const,
      dataAdequacyStatus: 'current_evidence_insufficient' as const,
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
      researchDisposition: 'current_evidence_insufficient_to_select_candidate' as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      sourceBindings: {
        phase20HandoffSha256: phase20Handoff.handoffSha256,
        evidenceEnvelopeSha256: evidenceEnvelope.envelopeSha256,
        crossFitAuditSha256: crossFitAudit.auditSha256,
      },
      observedEnvelope: evidenceEnvelope.observedEnvelope,
      researchEvidence: evidenceEnvelope.researchEvidence,
      evidenceGaps: evidenceEnvelope.evidenceGaps,
      blockers: PHASE21_DATA_ADEQUACY_BLOCKERS_V1,
      resourceDiagnostics,
    };
    const candidate = {
      ...preimage,
      assessmentSha256: phase21Digest(preimage),
    } as unknown as BrandedAssessment;
    Object.defineProperty(candidate, verifiedAssessment, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    verifiedObjects.add(candidate);
    phase21Freeze(candidate);
    verifiedDigests.set(candidate, candidate.assessmentSha256);
    verifiedOwners.set(candidate, Object.freeze({ phase20Handoff, evidenceEnvelope, crossFitAudit }));
    return { status: 'verified', assessment: candidate };
  } catch {
    return reject('phase21_adequacy_source_unverified');
  }
}

export const buildVerifiedPhase21DataAdequacyAssessmentV1 =
  buildPhase21DataAdequacyAssessmentV1;
export const buildPhase21VerifiedDataAdequacyAssessmentV1 =
  buildPhase21DataAdequacyAssessmentV1;

export function isVerifiedPhase21DataAdequacyAssessmentV1(
  value: unknown,
): value is BrandedAssessment {
  try {
    if (!phase21IsObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedAssessment;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || !isVerifiedPhase20SameProcessNoCandidateHandoffV1(owners.phase20Handoff)
      || !isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(owners.evidenceEnvelope)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(owners.crossFitAudit)) return false;
    const assessmentSha256 = phase21SafeGet(candidate, 'assessmentSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'assessmentSha256')) return false;
    return phase21SafeGet(candidate, verifiedAssessment) === true
      && phase21IsFrozen(candidate)
      && phase21IsSha256(assessmentSha256)
      && assessmentSha256 === phase21Digest(preimage)
      && verifiedDigests.get(candidate) === assessmentSha256
      && phase21SafeGet(candidate, 'dataAdequacyStatus') === 'current_evidence_insufficient'
      && phase21SafeGet(candidate, 'candidateApplicabilityStatus')
        === 'not_assessed_no_candidate_selected'
      && phase21SafeGet(candidate, 'qualificationEvidenceEligible') === false
      && phase21SafeGet(candidate, 'realDatasetEligible') === false
      && bindingsMatch(owners.phase20Handoff, owners.evidenceEnvelope, owners.crossFitAudit)
      && bindingsMatchValue(
        phase21SafeGet(candidate, 'sourceBindings'),
        owners.phase20Handoff,
        owners.evidenceEnvelope,
        owners.crossFitAudit,
      )
      && stableBlockers(phase21SafeGet(candidate, 'blockers'));
  } catch {
    return false;
  }
}

export const isVerifiedDataAdequacyAssessmentV1 =
  isVerifiedPhase21DataAdequacyAssessmentV1;

function readInput(value: unknown): {
  phase20Handoff: unknown;
  evidenceEnvelope: unknown;
  crossFitAudit: unknown;
  plannedResources: unknown;
} | null {
  if (!phase21IsObjectLike(value)) return null;
  try {
    return {
      phase20Handoff: Reflect.get(value, 'phase20Handoff')
        ?? Reflect.get(value, 'handoff'),
      evidenceEnvelope: Reflect.get(value, 'evidenceEnvelope')
        ?? Reflect.get(value, 'envelope'),
      crossFitAudit: Reflect.get(value, 'crossFitAudit')
        ?? Reflect.get(value, 'crossFit'),
      plannedResources: Reflect.get(value, 'plannedResources'),
    };
  } catch {
    return null;
  }
}

function adequacyResourceDiagnostics(
  phase20Handoff: Phase20SameProcessOfflineDiagnosticHandoffV1,
  evidenceEnvelope: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
  crossFitAudit: VerifiedPhase21ClusterAwareCrossFitAuditV1,
) {
  const canonicalInputBytes = phase21CanonicalBytes({
    phase20HandoffSha256: phase20Handoff.handoffSha256,
    evidenceEnvelopeSha256: evidenceEnvelope.envelopeSha256,
    crossFitAuditSha256: crossFitAudit.auditSha256,
  });
  return {
    preflightCompletedBeforeAssessment: true as const,
    records: 3,
    canonicalInputBytes,
    workUnits: 3,
    candidateCalls: 0 as const,
    inferenceCalls: 0 as const,
    publicationCalls: 0 as const,
  };
}

function resourcePlanAllows(
  value: unknown,
  actual: Readonly<{ records: number; canonicalInputBytes: number; workUnits: number }>,
): boolean {
  const limits = PHASE21_DATA_ADEQUACY_RESOURCE_LIMITS_V1;
  if (actual.records > limits.maximumRecords
    || actual.canonicalInputBytes > limits.maximumCanonicalInputBytes
    || actual.workUnits > limits.maximumWorkUnits) return false;
  if (value === undefined) return true;
  if (!phase21IsObjectLike(value)) return false;
  const records = phase21SafeGet(value, 'records');
  const canonicalInputBytes = phase21SafeGet(value, 'canonicalInputBytes');
  const workUnits = phase21SafeGet(value, 'workUnits');
  return phase21IsNonnegativeSafeInteger(records)
    && phase21IsNonnegativeSafeInteger(canonicalInputBytes)
    && phase21IsNonnegativeSafeInteger(workUnits)
    && records >= actual.records
    && canonicalInputBytes >= actual.canonicalInputBytes
    && workUnits >= actual.workUnits
    && records <= limits.maximumRecords
    && canonicalInputBytes <= limits.maximumCanonicalInputBytes
    && workUnits <= limits.maximumWorkUnits;
}

function bindingsMatch(
  phase20Handoff: Phase20SameProcessOfflineDiagnosticHandoffV1,
  evidenceEnvelope: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
  crossFitAudit: VerifiedPhase21ClusterAwareCrossFitAuditV1,
): boolean {
  return evidenceEnvelope.sourceBindings.phase20HandoffSha256 === phase20Handoff.handoffSha256
    && evidenceEnvelope.sourceBindings.dgpProtocolSha256 === phase20Handoff.dgpProtocolSha256
    && evidenceEnvelope.sourceBindings.scoreSurfaceSha256 === phase20Handoff.scoreSurfaceSha256
    && crossFitAudit.sourceBindings.evidenceEnvelopeSha256 === evidenceEnvelope.envelopeSha256
    && crossFitAudit.status === 'not_ready'
    && crossFitAudit.realViewerTimeProvenancePresent === false
    && crossFitAudit.qHatCrossFitVerified === false
    && crossFitAudit.realDatasetEligible === false;
}

function bindingsMatchValue(
  value: unknown,
  phase20Handoff: Phase20SameProcessOfflineDiagnosticHandoffV1,
  evidenceEnvelope: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
  crossFitAudit: VerifiedPhase21ClusterAwareCrossFitAuditV1,
): boolean {
  return phase21IsObjectLike(value)
    && phase21SafeGet(value, 'phase20HandoffSha256') === phase20Handoff.handoffSha256
    && phase21SafeGet(value, 'evidenceEnvelopeSha256') === evidenceEnvelope.envelopeSha256
    && phase21SafeGet(value, 'crossFitAuditSha256') === crossFitAudit.auditSha256;
}

function stableBlockers(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === PHASE21_DATA_ADEQUACY_BLOCKERS_V1.length
    && PHASE21_DATA_ADEQUACY_BLOCKERS_V1.every(
      (blocker, index) => phase21SafeGet(value, index) === blocker,
    );
}

function reject(blocker: Phase21DataAdequacyAssessmentBlockerV1): Phase21DataAdequacyAssessmentResultV1 {
  return { status: 'not_evaluable', blocker };
}
