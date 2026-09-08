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
import { isVerifiedPhase22RealEvidenceIntakeV1 } from '../realEvidenceIntake';
import { isVerifiedPhase22SealedReadinessEnvelopeV1 } from '../sealedReadiness';
import {
  PHASE22_HANDOFF_BLOCKERS_V1,
  PHASE22_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1,
  type Phase22HandoffBlockerV1,
  type Phase22HandoffBuildResultV1,
  type Phase22SameProcessHonestNoCandidateHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase22SameProcessHonestNoCandidateHandoffV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase21Handoff: Phase21SameProcessHonestNoCandidateHandoffV1;
  assessment: VerifiedPhase21DataAdequacyAssessmentV1;
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1;
  realEvidenceIntake: object;
  sealedReadiness: object;
}>>();

type BrandedHandoff = Phase22SameProcessHonestNoCandidateHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase22SameProcessHonestNoCandidateHandoffV1(
  input: unknown,
): Phase22HandoffBuildResultV1 {
  try {
    const fields = readInput(input);
    if (!fields
      || !isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(fields.phase21Handoff)
      || !isVerifiedPhase21DataAdequacyAssessmentV1(fields.assessment)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(fields.crossFit)
      || !isVerifiedPhase22RealEvidenceIntakeV1(fields.realEvidenceIntake)
      || !isVerifiedPhase22SealedReadinessEnvelopeV1(fields.sealedReadiness)) {
      return reject('phase22_handoff_source_unverified');
    }

    const phase21Handoff = fields.phase21Handoff;
    const assessment = fields.assessment;
    const crossFit = fields.crossFit;
    const realEvidenceIntake = fields.realEvidenceIntake;
    const sealedReadiness = fields.sealedReadiness;
    const digests = sourceDigests(
      phase21Handoff,
      assessment,
      crossFit,
      realEvidenceIntake,
      sealedReadiness,
    );
    if (!digests || !upstreamStatesMatch(
      phase21Handoff,
      assessment,
      crossFit,
      realEvidenceIntake,
      sealedReadiness,
      digests,
    )) {
      return reject('phase22_handoff_binding_mismatch');
    }

    const sourceBindings = Object.freeze({ ...digests });
    const preimage = {
      contractVersion: PHASE22_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1,
      handoffScope: 'same_process_offline_diagnostic_v1' as const,
      developmentStatus: 'completed_real_evidence_intake_no_candidate_selected' as const,
      realEvidenceIntakeStatus: 'verified_not_ready' as const,
      sealedReadinessStatus: 'verified_not_ready' as const,
      qualificationReadiness: 'not_ready' as const,
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected' as const,
      candidateQualificationStatus: 'not_run' as const,
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
      qualificationEvidenceEligible: false as const,
      candidateEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      sealedQualificationStatus: 'not_ready' as const,
      nextPhaseHandoff: 'real_cluster_evidence_required' as const,
      ...digests,
      sourceBindings,
      blockers: PHASE22_HANDOFF_BLOCKERS_V1,
    };
    const candidate = {
      ...preimage,
      handoffSha256: phase22Digest(preimage),
    } as unknown as BrandedHandoff;
    Object.defineProperty(candidate, verifiedHandoff, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    phase22Freeze(candidate);
    verifiedObjects.add(candidate);
    verifiedDigests.set(candidate, candidate.handoffSha256);
    verifiedOwners.set(candidate, Object.freeze({
      phase21Handoff,
      assessment,
      crossFit,
      realEvidenceIntake,
      sealedReadiness,
    }));
    return { status: 'verified', handoff: candidate };
  } catch {
    return reject('phase22_handoff_source_unverified');
  }
}

export const buildPhase22SameProcessNoCandidateHandoffV1 =
  buildPhase22SameProcessHonestNoCandidateHandoffV1;
export const buildPhase22SameProcessOfflineDiagnosticHandoffV1 =
  buildPhase22SameProcessHonestNoCandidateHandoffV1;
export const buildVerifiedPhase22SameProcessHonestNoCandidateHandoffV1 =
  buildPhase22SameProcessHonestNoCandidateHandoffV1;

export function isVerifiedPhase22SameProcessHonestNoCandidateHandoffV1(
  value: unknown,
): value is BrandedHandoff {
  try {
    if (!phase22IsObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedHandoff;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || !isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(owners.phase21Handoff)
      || !isVerifiedPhase21DataAdequacyAssessmentV1(owners.assessment)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(owners.crossFit)
      || !isVerifiedPhase22RealEvidenceIntakeV1(owners.realEvidenceIntake)
      || !isVerifiedPhase22SealedReadinessEnvelopeV1(owners.sealedReadiness)) return false;

    const handoffSha256 = phase22SafeGet(candidate, 'handoffSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'handoffSha256')) return false;
    const digests = sourceDigests(
      owners.phase21Handoff,
      owners.assessment,
      owners.crossFit,
      owners.realEvidenceIntake,
      owners.sealedReadiness,
    );
    return phase22SafeGet(candidate, verifiedHandoff) === true
      && phase22IsFrozen(candidate)
      && phase22IsSha256(handoffSha256)
      && handoffSha256 === phase22Digest(preimage)
      && verifiedDigests.get(candidate) === handoffSha256
      && !!digests
      && upstreamStatesMatch(
        owners.phase21Handoff,
        owners.assessment,
        owners.crossFit,
        owners.realEvidenceIntake,
        owners.sealedReadiness,
        digests,
      )
      && fixedHandoffState(candidate, digests)
      && sourceBindingsMatch(phase22SafeGet(candidate, 'sourceBindings'), digests);
  } catch {
    return false;
  }
}

export const isVerifiedPhase22SameProcessNoCandidateHandoffV1 =
  isVerifiedPhase22SameProcessHonestNoCandidateHandoffV1;
export const isVerifiedPhase22SameProcessOfflineDiagnosticHandoffV1 =
  isVerifiedPhase22SameProcessHonestNoCandidateHandoffV1;
export const isVerifiedPhase22HandoffV1 =
  isVerifiedPhase22SameProcessHonestNoCandidateHandoffV1;

type HandoffFields = Readonly<{
  phase21Handoff: unknown;
  assessment: unknown;
  crossFit: unknown;
  realEvidenceIntake: unknown;
  sealedReadiness: unknown;
}>;

function readInput(value: unknown): HandoffFields | null {
  if (!phase22IsObjectLike(value)) return null;
  const phase21Handoff = readFirst(value, 'phase21Handoff', 'handoff');
  const assessment = readFirst(value, 'phase21Assessment', 'assessment', 'adequacy');
  const crossFit = readFirst(value, 'phase21CrossFit', 'crossFit', 'crossFitAudit', 'audit');
  const realEvidenceIntake = readFirst(
    value,
    'realEvidenceIntake',
    'intake',
    'evidenceIntake',
  );
  const sealedReadiness = readFirst(
    value,
    'sealedReadiness',
    'readiness',
    'sealedReadinessEnvelope',
  );
  return { phase21Handoff, assessment, crossFit, realEvidenceIntake, sealedReadiness };
}

function readFirst(value: object, ...keys: PropertyKey[]): unknown {
  for (const key of keys) {
    const read = safeRead(value, key);
    if (read.ok && read.value !== undefined) return read.value;
  }
  return undefined;
}

function safeRead(value: object, key: PropertyKey): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: Reflect.get(value, key) };
  } catch {
    return { ok: false };
  }
}

type SourceDigests = Readonly<{
  phase21HandoffSha256: string;
  phase21AssessmentSha256: string;
  phase21CrossFitAuditSha256: string;
  realEvidenceIntakeSha256: string;
  sealedReadinessSha256: string;
}>;

function sourceDigests(
  phase21Handoff: object,
  assessment: object,
  crossFit: object,
  realEvidenceIntake: object,
  sealedReadiness: object,
): SourceDigests | null {
  const phase21HandoffSha256 = sha(phase21Handoff, 'handoffSha256');
  const phase21AssessmentSha256 = sha(assessment, 'assessmentSha256');
  const phase21CrossFitAuditSha256 = sha(crossFit, 'auditSha256', 'crossFitAuditSha256');
  const realEvidenceIntakeSha256 = sha(
    realEvidenceIntake,
    'intakeSha256',
    'realEvidenceIntakeSha256',
  );
  const sealedReadinessSha256 = sha(
    sealedReadiness,
    'readinessSha256',
    'sealedReadinessSha256',
    'envelopeSha256',
  );
  if (!phase21HandoffSha256
    || !phase21AssessmentSha256
    || !phase21CrossFitAuditSha256
    || !realEvidenceIntakeSha256
    || !sealedReadinessSha256) return null;
  return {
    phase21HandoffSha256,
    phase21AssessmentSha256,
    phase21CrossFitAuditSha256,
    realEvidenceIntakeSha256,
    sealedReadinessSha256,
  };
}

function sha(value: object, ...keys: PropertyKey[]): string | null {
  for (const key of keys) {
    const candidate = phase22SafeGet(value, key);
    if (phase22IsSha256(candidate)) return candidate;
  }
  return null;
}

function upstreamStatesMatch(
  phase21Handoff: Phase21SameProcessHonestNoCandidateHandoffV1,
  assessment: VerifiedPhase21DataAdequacyAssessmentV1,
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1,
  realEvidenceIntake: object,
  sealedReadiness: object,
  digests: SourceDigests,
): boolean {
  return phase22SafeGet(phase21Handoff, 'candidateSelectionStatus') === 'no_candidate_selected'
    && phase22SafeGet(phase21Handoff, 'candidateQualificationStatus') === 'not_run'
    && phase22SafeGet(phase21Handoff, 'selectedMethod') === 'diagnostics_only_abstention_v1'
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
    && neutralEligibility(realEvidenceIntake)
    && neutralEligibility(sealedReadiness)
    && intakeBindingsMatch(realEvidenceIntake, digests)
    && readinessBindingsMatch(sealedReadiness, digests);
}

function neutralEligibility(value: object): boolean {
  const readiness = phase22SafeGet(value, 'qualificationReadiness');
  const intakeStatus = phase22SafeGet(value, 'intakeStatus');
  const readinessStatus = phase22SafeGet(value, 'sealedReadinessStatus');
  const statusShape = (intakeStatus === 'not_ready' && readinessStatus === undefined)
    || (intakeStatus === undefined && readinessStatus === 'not_ready');
  return phase22SafeGet(value, 'qualificationEvidenceEligible') === false
    && phase22SafeGet(value, 'candidateEvidenceEligible') === false
    && phase22SafeGet(value, 'realDatasetEligible') === false
    && phase22SafeGet(value, 'servable') === false
    && readiness === 'not_ready'
    && statusShape;
}

function intakeBindingsMatch(value: object, digests: SourceDigests): boolean {
  const bindings = phase22SafeGet(value, 'sourceBindings');
  if (!phase22IsObjectLike(bindings)) return false;
  return bindingSha(bindings, 'phase21HandoffSha256', 'handoffSha256')
      === digests.phase21HandoffSha256
    && bindingSha(bindings, 'phase21AssessmentSha256', 'assessmentSha256', 'adequacySha256')
      === digests.phase21AssessmentSha256
    && bindingSha(bindings, 'phase21CrossFitAuditSha256', 'crossFitAuditSha256', 'crossFitSha256')
      === digests.phase21CrossFitAuditSha256;
}

function readinessBindingsMatch(value: object, digests: SourceDigests): boolean {
  const bindings = phase22SafeGet(value, 'sourceBindings');
  if (!phase22IsObjectLike(bindings)) return false;
  return bindingSha(bindings, 'phase21HandoffSha256', 'handoffSha256')
      === digests.phase21HandoffSha256
    && bindingSha(bindings, 'phase21AssessmentSha256', 'assessmentSha256', 'adequacySha256')
      === digests.phase21AssessmentSha256
    && bindingSha(bindings, 'phase21CrossFitAuditSha256', 'crossFitAuditSha256', 'crossFitSha256')
      === digests.phase21CrossFitAuditSha256
    && bindingSha(bindings, 'realEvidenceIntakeSha256', 'intakeSha256')
      === digests.realEvidenceIntakeSha256;
}

function bindingSha(value: object, ...keys: PropertyKey[]): string | null {
  for (const key of keys) {
    const candidate = phase22SafeGet(value, key);
    if (phase22IsSha256(candidate)) return candidate;
  }
  return null;
}

function sourceBindingsMatch(value: unknown, expected: SourceDigests): boolean {
  if (!phase22IsObjectLike(value)) return false;
  return bindingSha(value, 'phase21HandoffSha256') === expected.phase21HandoffSha256
    && bindingSha(value, 'phase21AssessmentSha256') === expected.phase21AssessmentSha256
    && bindingSha(value, 'phase21CrossFitAuditSha256') === expected.phase21CrossFitAuditSha256
    && bindingSha(value, 'realEvidenceIntakeSha256') === expected.realEvidenceIntakeSha256
    && bindingSha(value, 'sealedReadinessSha256') === expected.sealedReadinessSha256;
}

function fixedHandoffState(value: BrandedHandoff, digests: SourceDigests): boolean {
  return phase22SafeGet(value, 'contractVersion')
      === PHASE22_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1
    && phase22SafeGet(value, 'handoffScope') === 'same_process_offline_diagnostic_v1'
    && phase22SafeGet(value, 'developmentStatus')
      === 'completed_real_evidence_intake_no_candidate_selected'
    && phase22SafeGet(value, 'realEvidenceIntakeStatus') === 'verified_not_ready'
    && phase22SafeGet(value, 'sealedReadinessStatus') === 'verified_not_ready'
    && phase22SafeGet(value, 'qualificationReadiness') === 'not_ready'
    && phase22SafeGet(value, 'researchCandidateMethod') === null
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
    && phase22SafeGet(value, 'nextPhaseHandoff') === 'real_cluster_evidence_required'
    && phase22SafeGet(value, 'phase21HandoffSha256') === digests.phase21HandoffSha256
    && phase22SafeGet(value, 'phase21AssessmentSha256') === digests.phase21AssessmentSha256
    && phase22SafeGet(value, 'phase21CrossFitAuditSha256')
      === digests.phase21CrossFitAuditSha256
    && phase22SafeGet(value, 'realEvidenceIntakeSha256')
      === digests.realEvidenceIntakeSha256
    && phase22SafeGet(value, 'sealedReadinessSha256') === digests.sealedReadinessSha256
    && stableBlockers(phase22SafeGet(value, 'blockers'));
}

function stableBlockers(value: unknown): boolean {
  try {
    return Array.isArray(value)
      && value.length === PHASE22_HANDOFF_BLOCKERS_V1.length
      && PHASE22_HANDOFF_BLOCKERS_V1.every(
        (blocker, index) => phase22SafeGet(value, index) === blocker,
      );
  } catch {
    return false;
  }
}

function reject(blocker: Phase22HandoffBlockerV1): Phase22HandoffBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
