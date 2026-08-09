import { describe, expect, it, vi } from 'vitest';

const brands = vi.hoisted(() => ({ phase20Handoffs: new WeakSet<object>() }));

vi.mock(
  '../../src/services/recommendation/ope/inference/qualification/v10/handoff',
  async (importOriginal) => ({
    ...(await importOriginal<typeof import(
      '../../src/services/recommendation/ope/inference/qualification/v10/handoff'
    )>()),
    isVerifiedPhase20SameProcessNoCandidateHandoffV1: (value: unknown) => (
      !!value && typeof value === 'object' && brands.phase20Handoffs.has(value)
    ),
  }),
);

import {
  buildPhase21ViewerTimeEvidenceEnvelopeV1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/evidenceEnvelope';
import {
  buildPhase21ClusterAwareCrossFitAuditV1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/crossFit';
import {
  buildPhase21DataAdequacyAssessmentV1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/adequacy';
import {
  buildPhase21SameProcessHonestNoCandidateHandoffV1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/handoff';
import { phase21Digest } from '../../src/services/recommendation/ope/inference/qualification/v11/privateCore';
import {
  buildPhase22RealEvidenceIntakeV1,
  isVerifiedPhase22RealEvidenceIntakeV1,
  PHASE22_REAL_EVIDENCE_INTAKE_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v12/realEvidenceIntake';
import {
  buildPhase22SealedReadinessEnvelopeV1,
  isVerifiedPhase22SealedReadinessEnvelopeV1,
  PHASE22_SEALED_READINESS_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v12/sealedReadiness';
import {
  buildPhase22SameProcessHonestNoCandidateHandoffV1,
  isVerifiedPhase22SameProcessHonestNoCandidateHandoffV1,
  PHASE22_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v12/handoff';

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function phase20Handoff(seed = 'a') {
  const value = freeze({
    contractVersion: 'phase20_same_process_offline_diagnostic_handoff_v1',
    handoffScope: 'same_process_offline_diagnostic_v1',
    candidateSelectionStatus: 'no_candidate_selected',
    candidateQualificationStatus: 'not_run',
    candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
    selectedMethod: 'diagnostics_only_abstention_v1',
    qualificationEvidenceEligible: false,
    candidateEvidenceEligible: false,
    realDatasetEligible: false,
    servable: false,
    handoffSha256: seed.repeat(64),
    dgpProtocolSha256: 'b'.repeat(64),
    scoreSurfaceSha256: 'c'.repeat(64),
  });
  brands.phase20Handoffs.add(value);
  return value;
}

function crossFitInput(envelope: Readonly<{ envelopeSha256: string }>) {
  const rows: readonly Readonly<{
    rowId: string;
    decisionId: string;
    viewerClusterId: string;
    timeClusterId: string;
    foldId: number;
    role: 'train' | 'evaluation';
  }>[] = [];
  return {
    evidenceEnvelope: envelope,
    assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
    foldCount: null,
    rows,
    foldAssignmentSha256: phase21Digest({
      evidenceEnvelopeSha256: envelope.envelopeSha256,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      foldCount: null,
      rows,
    }),
  };
}

function source(seed = 'a') {
  const phase20 = phase20Handoff(seed);
  const envelopeResult = buildPhase21ViewerTimeEvidenceEnvelopeV1({ phase20Handoff: phase20 });
  expect(envelopeResult.status).toBe('verified');
  if (envelopeResult.status !== 'verified') throw new Error('envelope fixture failed');
  const crossFitResult = buildPhase21ClusterAwareCrossFitAuditV1(crossFitInput(envelopeResult.envelope));
  expect(crossFitResult.status).toBe('verified');
  if (crossFitResult.status !== 'verified') throw new Error('cross-fit fixture failed');
  const adequacyResult = buildPhase21DataAdequacyAssessmentV1({
    phase20Handoff: phase20,
    evidenceEnvelope: envelopeResult.envelope,
    crossFitAudit: crossFitResult.audit,
  });
  expect(adequacyResult.status).toBe('verified');
  if (adequacyResult.status !== 'verified') throw new Error('adequacy fixture failed');
  const phase21 = buildPhase21SameProcessHonestNoCandidateHandoffV1({
    phase20Handoff: phase20,
    assessment: adequacyResult.assessment,
    crossFit: crossFitResult.audit,
  });
  expect(phase21.status).toBe('verified');
  if (phase21.status !== 'verified') throw new Error('phase21 fixture failed');
  return {
    phase21: phase21.handoff,
    assessment: adequacyResult.assessment,
    crossFit: crossFitResult.audit,
    envelope: envelopeResult.envelope,
  };
}

function v12Chain(value = source()) {
  const intakeResult = buildPhase22RealEvidenceIntakeV1({
    phase21Handoff: value.phase21,
    evidenceEnvelope: value.envelope,
    assessment: value.assessment,
    crossFit: value.crossFit,
  });
  expect(intakeResult.status).toBe('verified');
  if (intakeResult.status !== 'verified') throw new Error('intake fixture failed');
  const readinessResult = buildPhase22SealedReadinessEnvelopeV1({
    phase21Handoff: value.phase21,
    assessment: value.assessment,
    crossFit: value.crossFit,
    realEvidenceIntake: intakeResult.intake,
  });
  expect(readinessResult.status).toBe('verified');
  if (readinessResult.status !== 'verified') throw new Error('readiness fixture failed');
  const handoffResult = buildPhase22SameProcessHonestNoCandidateHandoffV1({
    phase21Handoff: value.phase21,
    assessment: value.assessment,
    crossFit: value.crossFit,
    realEvidenceIntake: intakeResult.intake,
    sealedReadiness: readinessResult.envelope,
  });
  expect(handoffResult.status).toBe('verified');
  if (handoffResult.status !== 'verified') throw new Error('handoff fixture failed');
  return { ...value, intake: intakeResult.intake, readiness: readinessResult.envelope, handoff: handoffResult.handoff };
}

describe('Phase 22 real evidence readiness boundary', () => {
  it('builds a verified not-ready intake, readiness envelope, and handoff', () => {
    const value = v12Chain();
    expect(value.intake.status).toBe('not_ready');
    expect(value.intake.intakeStatus).toBe('not_ready');
    expect(value.intake.sourceStatus).toBe('unavailable');
    expect(value.intake.receiptIntegrityStatus).toBe('not_ready');
    expect(value.intake.realDatasetEligible).toBe(false);
    expect(value.intake.candidateSelectionStatus).toBe('no_candidate_selected');
    expect(value.intake.blockers).toEqual(PHASE22_REAL_EVIDENCE_INTAKE_BLOCKERS_V1);
    expect(value.intake.resourceDiagnostics).toMatchObject({
      candidateCalls: 0,
      inferenceCalls: 0,
      publicationCalls: 0,
    });
    expect(value.readiness.readinessStatus).toBe('not_ready');
    expect(value.readiness.realEvidenceIntakeStatus).toBe('not_ready');
    expect(value.readiness.qualificationEvidenceEligible).toBe(false);
    expect(value.readiness.realDatasetEligible).toBe(false);
    expect(value.readiness.servable).toBe(false);
    expect(value.readiness.blockers).toEqual(PHASE22_SEALED_READINESS_BLOCKERS_V1);
    expect(value.handoff.realEvidenceIntakeStatus).toBe('verified_not_ready');
    expect(value.handoff.sealedReadinessStatus).toBe('verified_not_ready');
    expect(value.handoff.qualificationEvidenceEligible).toBe(false);
    expect(value.handoff.realDatasetEligible).toBe(false);
    expect(value.handoff.servable).toBe(false);
    expect(value.handoff.nextPhaseHandoff).toBe('real_cluster_evidence_required');
    expect(value.handoff.blockers).toEqual(PHASE22_HANDOFF_BLOCKERS_V1);
    expect(isVerifiedPhase22RealEvidenceIntakeV1(value.intake)).toBe(true);
    expect(isVerifiedPhase22SealedReadinessEnvelopeV1(value.readiness)).toBe(true);
    expect(isVerifiedPhase22SameProcessHonestNoCandidateHandoffV1(value.handoff)).toBe(true);
  });

  it('rejects clones, caller attestations, and hostile getters without throwing', () => {
    const value = source();
    const intakeInput = { phase21Handoff: value.phase21, evidenceEnvelope: value.envelope, assessment: value.assessment, crossFit: value.crossFit };
    const receiptAttestations = [
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
    ] as const;
    const booleanAttestations = [
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
    ] as const;
    for (const key of receiptAttestations) {
      expect(buildPhase22RealEvidenceIntakeV1({
        ...intakeInput,
        [key]: key.endsWith('Sha256') ? 'a'.repeat(64) : { verified: true },
      })).toEqual({ status: 'not_evaluable', blocker: 'phase22_intake_source_unverified' });
    }
    for (const key of booleanAttestations) {
      expect(buildPhase22RealEvidenceIntakeV1({ ...intakeInput, [key]: false })).toEqual({
        status: 'not_evaluable',
        blocker: 'phase22_intake_source_unverified',
      });
    }
    const throwingAttestation = { ...intakeInput } as Record<string, unknown>;
    Object.defineProperty(throwingAttestation, 'pitSnapshotSha256', {
      get: () => { throw new Error('hostile attestation getter'); },
    });
    expect(buildPhase22RealEvidenceIntakeV1(throwingAttestation)).toEqual({
      status: 'not_evaluable',
      blocker: 'phase22_intake_source_unverified',
    });

    const chain = v12Chain();
    expect(isVerifiedPhase22RealEvidenceIntakeV1(structuredClone(chain.intake))).toBe(false);
    expect(isVerifiedPhase22SealedReadinessEnvelopeV1(structuredClone(chain.readiness))).toBe(false);
    expect(isVerifiedPhase22SameProcessHonestNoCandidateHandoffV1(structuredClone(chain.handoff))).toBe(false);
    expect(buildPhase22SealedReadinessEnvelopeV1({
      phase21Handoff: chain.phase21,
      assessment: chain.assessment,
      crossFit: chain.crossFit,
      realEvidenceIntake: structuredClone(chain.intake),
    })).toEqual({ status: 'not_evaluable', blocker: 'phase22_sealed_readiness_source_unverified' });
    expect(buildPhase22SameProcessHonestNoCandidateHandoffV1({
      phase21Handoff: chain.phase21,
      assessment: chain.assessment,
      crossFit: chain.crossFit,
      realEvidenceIntake: chain.intake,
      sealedReadiness: structuredClone(chain.readiness),
    })).toEqual({ status: 'not_evaluable', blocker: 'phase22_handoff_source_unverified' });
    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => buildPhase22RealEvidenceIntakeV1(hostile)).not.toThrow();
    expect(buildPhase22RealEvidenceIntakeV1(hostile)).toEqual({ status: 'not_evaluable', blocker: 'phase22_intake_source_unverified' });
    expect(buildPhase22SealedReadinessEnvelopeV1(hostile)).toEqual({ status: 'not_evaluable', blocker: 'phase22_sealed_readiness_source_unverified' });
    expect(buildPhase22SameProcessHonestNoCandidateHandoffV1(hostile)).toEqual({ status: 'not_evaluable', blocker: 'phase22_handoff_source_unverified' });
  });

  it('fails closed on source binding drift and resource-plan overlimits', () => {
    const first = v12Chain();
    const second = source('d');
    expect(buildPhase22RealEvidenceIntakeV1({
      phase21Handoff: second.phase21,
      evidenceEnvelope: second.envelope,
      assessment: second.assessment,
      crossFit: first.crossFit,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase22_intake_binding_mismatch' });
    expect(buildPhase22SealedReadinessEnvelopeV1({
      phase21Handoff: second.phase21,
      assessment: second.assessment,
      crossFit: second.crossFit,
      realEvidenceIntake: first.intake,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase22_sealed_readiness_binding_mismatch' });
    const secondChain = v12Chain(second);
    expect(buildPhase22SameProcessHonestNoCandidateHandoffV1({
      phase21Handoff: secondChain.phase21,
      assessment: secondChain.assessment,
      crossFit: secondChain.crossFit,
      realEvidenceIntake: secondChain.intake,
      sealedReadiness: first.readiness,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase22_handoff_binding_mismatch' });
    for (const plannedResources of [
      { records: 8_193, sourceBytes: 0, canonicalInputBytes: 0, workUnits: 0 },
      { records: 0, sourceBytes: 33_554_433, canonicalInputBytes: 0, workUnits: 0 },
      { records: 0, sourceBytes: 0, canonicalInputBytes: 33_554_433, workUnits: 0 },
      { records: 0, sourceBytes: 0, canonicalInputBytes: 0, workUnits: 65_537 },
    ]) {
      expect(buildPhase22RealEvidenceIntakeV1({
        phase21Handoff: first.phase21,
        evidenceEnvelope: first.envelope,
        assessment: first.assessment,
        crossFit: first.crossFit,
        plannedResources,
      })).toEqual({ status: 'not_evaluable', blocker: 'phase22_intake_resource_limit_exceeded' });
    }
    expect(buildPhase22RealEvidenceIntakeV1({
      phase21Handoff: first.phase21,
      evidenceEnvelope: first.envelope,
      assessment: first.assessment,
      crossFit: first.crossFit,
      plannedResources: {
        records: 0,
        sourceBytes: 0,
        canonicalInputBytes: first.intake.resourceDiagnostics.canonicalInputBytes - 1,
        workUnits: 0,
      },
    })).toEqual({ status: 'not_evaluable', blocker: 'phase22_intake_resource_limit_exceeded' });
  });

  it('preflights resource declarations before reading source or attestation fields', () => {
    let nonResourceReads = 0;
    const input = new Proxy({
      plannedResources: { records: 8_193, sourceBytes: 0, canonicalInputBytes: 0, workUnits: 0 },
    }, {
      get(target, key, receiver) {
        if (key !== 'plannedResources') nonResourceReads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(buildPhase22RealEvidenceIntakeV1(input)).toEqual({
      status: 'not_evaluable',
      blocker: 'phase22_intake_resource_limit_exceeded',
    });
    expect(nonResourceReads).toBe(0);
  });
});
