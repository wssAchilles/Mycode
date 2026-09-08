import {
  isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1,
  type Phase21SameProcessHonestNoCandidateHandoffV1,
} from '../../v11/handoff';
import {
  isVerifiedPhase21DataAdequacyAssessmentV1,
  type VerifiedPhase21DataAdequacyAssessmentV1,
} from '../../v11/adequacy';
import {
  isVerifiedPhase21ClusterAwareCrossFitAuditV1,
  type VerifiedPhase21ClusterAwareCrossFitAuditV1,
} from '../../v11/crossFit';
import {
  phase22Digest,
  phase22Freeze,
  phase22IsFrozen,
  phase22IsObjectLike,
  phase22IsSha256,
  phase22SafeGet,
} from '../privateCore';
import {
  isVerifiedPhase22RealEvidenceIntakeV1,
  type VerifiedPhase22RealEvidenceIntakeV1,
} from '../realEvidenceIntake';
import {
  PHASE22_SEALED_READINESS_BLOCKERS_V1,
  PHASE22_SEALED_READINESS_ENVELOPE_V1,
  type Phase22SealedReadinessEnvelopeBuildResultV1,
  type Phase22SealedReadinessEnvelopeV1,
} from './contracts';

export * from './contracts';

const verifiedReadiness = Symbol('verifiedPhase22SealedReadinessEnvelopeV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase21Handoff: Phase21SameProcessHonestNoCandidateHandoffV1;
  assessment: VerifiedPhase21DataAdequacyAssessmentV1;
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1;
  realEvidenceIntake: VerifiedPhase22RealEvidenceIntakeV1;
}>>();

type BrandedReadiness = Phase22SealedReadinessEnvelopeV1 & {
  readonly [verifiedReadiness]: true;
};

export function buildPhase22SealedReadinessEnvelopeV1(
  input: unknown,
): Phase22SealedReadinessEnvelopeBuildResultV1 {
  try {
    const fields = readInput(input);
    if (!fields
      || !isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(fields.phase21Handoff)
      || !isVerifiedPhase21DataAdequacyAssessmentV1(fields.assessment)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(fields.crossFit)
      || !isVerifiedPhase22RealEvidenceIntakeV1(fields.realEvidenceIntake)) {
      return reject('phase22_sealed_readiness_source_unverified');
    }

    const phase21Handoff = fields.phase21Handoff;
    const assessment = fields.assessment;
    const crossFit = fields.crossFit;
    const realEvidenceIntake = fields.realEvidenceIntake;
    const sourceBindings = sourceBindingsFor(
      phase21Handoff,
      assessment,
      crossFit,
      realEvidenceIntake,
    );
    if (!sourceBindings || !upstreamBindingsMatch(
      phase21Handoff,
      assessment,
      crossFit,
      realEvidenceIntake,
      sourceBindings,
    )) return reject('phase22_sealed_readiness_binding_mismatch');

    const receiptIntegrityStatus = intakeStatus(realEvidenceIntake);
    if (!receiptIntegrityStatus) return reject('phase22_sealed_readiness_binding_mismatch');

    const preimage = {
      contractVersion: PHASE22_SEALED_READINESS_ENVELOPE_V1,
      readinessKind: 'sealed_readiness_envelope_v1' as const,
      readinessStatus: 'not_ready' as const,
      sealedReadinessStatus: 'not_ready' as const,
      realEvidenceIntakeStatus: receiptIntegrityStatus,
      receiptIntegrityStatus,
      qualificationReadiness: 'not_ready' as const,
      evidenceStatus: 'not_ready' as const,
      candidateSelectionStatus: 'no_candidate_selected' as const,
      candidateQualificationStatus: 'not_run' as const,
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
      qualificationEvidenceEligible: false as const,
      candidateEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      sealedQualificationStatus: 'not_ready' as const,
      sourceBindings,
      blockers: PHASE22_SEALED_READINESS_BLOCKERS_V1,
    };
    const candidate = {
      ...preimage,
      readinessSha256: phase22Digest(preimage),
    } as BrandedReadiness;
    Object.defineProperty(candidate, verifiedReadiness, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    phase22Freeze(candidate);
    verifiedObjects.add(candidate);
    verifiedDigests.set(candidate, candidate.readinessSha256);
    verifiedOwners.set(candidate, Object.freeze({
      phase21Handoff,
      assessment,
      crossFit,
      realEvidenceIntake,
    }));
    return { status: 'verified', envelope: candidate };
  } catch {
    return reject('phase22_sealed_readiness_source_unverified');
  }
}

export const buildVerifiedPhase22SealedReadinessEnvelopeV1 =
  buildPhase22SealedReadinessEnvelopeV1;
export const buildPhase22VerifiedSealedReadinessEnvelopeV1 =
  buildPhase22SealedReadinessEnvelopeV1;
export const buildPhase22SealedReadinessV1 =
  buildPhase22SealedReadinessEnvelopeV1;

export function isVerifiedPhase22SealedReadinessEnvelopeV1(
  value: unknown,
): value is BrandedReadiness {
  try {
    if (!phase22IsObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedReadiness;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || !isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(owners.phase21Handoff)
      || !isVerifiedPhase21DataAdequacyAssessmentV1(owners.assessment)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(owners.crossFit)
      || !isVerifiedPhase22RealEvidenceIntakeV1(owners.realEvidenceIntake)) return false;
    const readinessSha256 = phase22SafeGet(candidate, 'readinessSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'readinessSha256')) return false;
    const expected = sourceBindingsFor(
      owners.phase21Handoff,
      owners.assessment,
      owners.crossFit,
      owners.realEvidenceIntake,
    );
    return phase22SafeGet(candidate, verifiedReadiness) === true
      && phase22IsFrozen(candidate)
      && phase22IsSha256(readinessSha256)
      && readinessSha256 === phase22Digest(preimage)
      && verifiedDigests.get(candidate) === readinessSha256
      && !!expected
      && upstreamBindingsMatch(
        owners.phase21Handoff,
        owners.assessment,
        owners.crossFit,
        owners.realEvidenceIntake,
        expected,
      )
      && fixedReadinessState(candidate, expected)
      && sourceBindingsMatch(phase22SafeGet(candidate, 'sourceBindings'), expected);
  } catch {
    return false;
  }
}

export const isVerifiedSealedReadinessEnvelopeV1 =
  isVerifiedPhase22SealedReadinessEnvelopeV1;
export const isVerifiedPhase22SealedReadinessV1 =
  isVerifiedPhase22SealedReadinessEnvelopeV1;

type ReadinessFields = Readonly<{
  phase21Handoff: unknown;
  assessment: unknown;
  crossFit: unknown;
  realEvidenceIntake: unknown;
}>;

function readInput(value: unknown): ReadinessFields | null {
  if (!phase22IsObjectLike(value)) return null;
  return {
    phase21Handoff: readFirst(value, 'phase21Handoff', 'handoff'),
    assessment: readFirst(value, 'phase21Assessment', 'assessment', 'adequacy'),
    crossFit: readFirst(value, 'phase21CrossFit', 'crossFit', 'crossFitAudit', 'audit'),
    realEvidenceIntake: readFirst(
      value,
      'realEvidenceIntake',
      'intake',
      'evidenceIntake',
    ),
  };
}

function readFirst(value: object, ...keys: PropertyKey[]): unknown {
  for (const key of keys) {
    const candidate = phase22SafeGet(value, key);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

type SourceBindings = Readonly<{
  phase21HandoffSha256: string;
  phase21AssessmentSha256: string;
  phase21CrossFitAuditSha256: string;
  realEvidenceIntakeSha256: string;
}>;

function sourceBindingsFor(
  phase21Handoff: Phase21SameProcessHonestNoCandidateHandoffV1,
  assessment: VerifiedPhase21DataAdequacyAssessmentV1,
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1,
  realEvidenceIntake: VerifiedPhase22RealEvidenceIntakeV1,
): SourceBindings | null {
  const phase21HandoffSha256 = phase22SafeGet(phase21Handoff, 'handoffSha256');
  const phase21AssessmentSha256 = phase22SafeGet(assessment, 'assessmentSha256');
  const phase21CrossFitAuditSha256 = phase22SafeGet(crossFit, 'auditSha256');
  const realEvidenceIntakeSha256 = phase22SafeGet(realEvidenceIntake, 'intakeSha256');
  if (!phase22IsSha256(phase21HandoffSha256)
    || !phase22IsSha256(phase21AssessmentSha256)
    || !phase22IsSha256(phase21CrossFitAuditSha256)
    || !phase22IsSha256(realEvidenceIntakeSha256)) return null;
  return {
    phase21HandoffSha256,
    phase21AssessmentSha256,
    phase21CrossFitAuditSha256,
    realEvidenceIntakeSha256,
  };
}

function intakeStatus(
  value: VerifiedPhase22RealEvidenceIntakeV1,
): 'not_ready' | null {
  const status = phase22SafeGet(value, 'status');
  const receiptIntegrityStatus = phase22SafeGet(value, 'receiptIntegrityStatus');
  if (status !== 'not_ready' || receiptIntegrityStatus !== 'not_ready') return null;
  return 'not_ready';
}

function upstreamBindingsMatch(
  phase21Handoff: Phase21SameProcessHonestNoCandidateHandoffV1,
  assessment: VerifiedPhase21DataAdequacyAssessmentV1,
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1,
  realEvidenceIntake: VerifiedPhase22RealEvidenceIntakeV1,
  expected: SourceBindings,
): boolean {
  const intakeBindings = phase22SafeGet(realEvidenceIntake, 'sourceBindings');
  return phase22SafeGet(phase21Handoff, 'phase21AssessmentSha256')
      === expected.phase21AssessmentSha256
    && phase22SafeGet(phase21Handoff, 'phase21CrossFitAuditSha256')
      === expected.phase21CrossFitAuditSha256
    && phase22SafeGet(phase21Handoff, 'realDatasetEligible') === false
    && phase22SafeGet(phase21Handoff, 'servable') === false
    && phase22SafeGet(assessment, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && phase22SafeGet(assessment, 'qualificationEvidenceEligible') === false
    && phase22SafeGet(assessment, 'realDatasetEligible') === false
    && phase22SafeGet(assessment, 'servable') === false
    && phase22SafeGet(crossFit, 'status') === 'not_ready'
    && phase22SafeGet(crossFit, 'candidateEvidenceEligible') === false
    && phase22SafeGet(crossFit, 'qualificationEvidenceEligible') === false
    && phase22SafeGet(crossFit, 'realDatasetEligible') === false
    && phase22SafeGet(crossFit, 'servable') === false
    && phase22SafeGet(realEvidenceIntake, 'qualificationReadiness') === 'not_ready'
    && phase22SafeGet(realEvidenceIntake, 'candidateEvidenceEligible') === false
    && phase22SafeGet(realEvidenceIntake, 'qualificationEvidenceEligible') === false
    && phase22SafeGet(realEvidenceIntake, 'realDatasetEligible') === false
    && phase22SafeGet(realEvidenceIntake, 'servable') === false
    && phase22IsObjectLike(intakeBindings)
    && phase22SafeGet(intakeBindings, 'phase21HandoffSha256')
      === expected.phase21HandoffSha256
    && phase22SafeGet(intakeBindings, 'phase21AssessmentSha256')
      === expected.phase21AssessmentSha256
    && phase22SafeGet(intakeBindings, 'phase21CrossFitAuditSha256')
      === expected.phase21CrossFitAuditSha256;
}

function fixedReadinessState(value: BrandedReadiness, expected: SourceBindings): boolean {
  const integrity = phase22SafeGet(value, 'receiptIntegrityStatus');
  return phase22SafeGet(value, 'contractVersion') === PHASE22_SEALED_READINESS_ENVELOPE_V1
    && phase22SafeGet(value, 'readinessKind') === 'sealed_readiness_envelope_v1'
    && phase22SafeGet(value, 'readinessStatus') === 'not_ready'
    && phase22SafeGet(value, 'sealedReadinessStatus') === 'not_ready'
    && integrity === 'not_ready'
    && phase22SafeGet(value, 'realEvidenceIntakeStatus') === 'not_ready'
    && phase22SafeGet(value, 'qualificationReadiness') === 'not_ready'
    && phase22SafeGet(value, 'evidenceStatus') === 'not_ready'
    && phase22SafeGet(value, 'candidateSelectionStatus') === 'no_candidate_selected'
    && phase22SafeGet(value, 'candidateQualificationStatus') === 'not_run'
    && phase22SafeGet(value, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && phase22SafeGet(value, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && phase22SafeGet(value, 'qualificationEvidenceEligible') === false
    && phase22SafeGet(value, 'candidateEvidenceEligible') === false
    && phase22SafeGet(value, 'realDatasetEligible') === false
    && phase22SafeGet(value, 'servable') === false
    && phase22SafeGet(value, 'sealedQualificationStatus') === 'not_ready'
    && stableBlockers(phase22SafeGet(value, 'blockers'))
    && sourceBindingsMatch(phase22SafeGet(value, 'sourceBindings'), expected);
}

function sourceBindingsMatch(value: unknown, expected: SourceBindings): boolean {
  return phase22IsObjectLike(value)
    && phase22SafeGet(value, 'phase21HandoffSha256') === expected.phase21HandoffSha256
    && phase22SafeGet(value, 'phase21AssessmentSha256') === expected.phase21AssessmentSha256
    && phase22SafeGet(value, 'phase21CrossFitAuditSha256') === expected.phase21CrossFitAuditSha256
    && phase22SafeGet(value, 'realEvidenceIntakeSha256') === expected.realEvidenceIntakeSha256;
}

function stableBlockers(value: unknown): boolean {
  try {
    return Array.isArray(value)
      && value.length === PHASE22_SEALED_READINESS_BLOCKERS_V1.length
      && PHASE22_SEALED_READINESS_BLOCKERS_V1.every(
        (blocker, index) => phase22SafeGet(value, index) === blocker,
      );
  } catch {
    return false;
  }
}

function reject(
  blocker:
    | 'phase22_sealed_readiness_source_unverified'
    | 'phase22_sealed_readiness_binding_mismatch',
): Phase22SealedReadinessEnvelopeBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
