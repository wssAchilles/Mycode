import { describe, expect, it, vi } from 'vitest';

const brands = vi.hoisted(() => ({
  phase20Handoffs: new WeakSet<object>(),
}));

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
  isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
  PHASE21_EVIDENCE_GAPS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/evidenceEnvelope';
import {
  buildPhase21ClusterAwareCrossFitAuditV1,
  isVerifiedPhase21ClusterAwareCrossFitAuditV1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/crossFit';
import {
  buildPhase21DataAdequacyAssessmentV1,
  isVerifiedPhase21DataAdequacyAssessmentV1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/adequacy';
import {
  buildPhase21SameProcessHonestNoCandidateHandoffV1,
  isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1,
  PHASE21_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v11/handoff';
import { phase21Digest } from '../../src/services/recommendation/ope/inference/qualification/v11/privateCore';

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function phase20Handoff() {
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
    handoffSha256: 'a'.repeat(64),
    dgpProtocolSha256: 'b'.repeat(64),
    scoreSurfaceSha256: 'c'.repeat(64),
  });
  brands.phase20Handoffs.add(value);
  return value;
}

function crossFitInput(
  envelope: Readonly<{ envelopeSha256: string }>,
  rows: readonly Readonly<{
    rowId: string;
    decisionId: string;
    viewerClusterId: string;
    timeClusterId: string;
    foldId: number;
    role: 'train' | 'evaluation';
  }>[] = [],
  foldCount: number | null = rows.length === 0
    ? null
    : new Set(rows.map((row) => row.foldId)).size,
) {
  const canonicalRows = [...rows].sort((left, right) => (
    Buffer.compare(Buffer.from(left.rowId), Buffer.from(right.rowId))
  ));
  return {
    evidenceEnvelope: envelope,
    assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
    foldCount,
    rows,
    foldAssignmentSha256: phase21Digest({
      evidenceEnvelopeSha256: envelope.envelopeSha256,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      foldCount,
      rows: canonicalRows,
    }),
  };
}

function source() {
  const phase20 = phase20Handoff();
  const envelopeResult = buildPhase21ViewerTimeEvidenceEnvelopeV1({ phase20Handoff: phase20 });
  expect(envelopeResult.status).toBe('verified');
  if (envelopeResult.status !== 'verified') throw new Error('envelope fixture failed');
  const crossFitResult = buildPhase21ClusterAwareCrossFitAuditV1(
    crossFitInput(envelopeResult.envelope),
  );
  expect(crossFitResult.status).toBe('verified');
  if (crossFitResult.status !== 'verified') throw new Error('cross-fit fixture failed');
  const adequacyResult = buildPhase21DataAdequacyAssessmentV1({
    phase20Handoff: phase20,
    evidenceEnvelope: envelopeResult.envelope,
    crossFitAudit: crossFitResult.audit,
  });
  expect(adequacyResult.status).toBe('verified');
  if (adequacyResult.status !== 'verified') throw new Error('adequacy fixture failed');
  return { phase20, envelope: envelopeResult.envelope, crossFit: crossFitResult.audit, adequacy: adequacyResult.assessment };
}

describe('Phase 21 viewer x time evidence boundary', () => {
  it('builds only a candidate-neutral not-ready envelope and handoff', () => {
    const value = source();
    expect(value.envelope.evidenceStatus).toBe('not_ready');
    expect(value.envelope.evidenceGaps).toEqual(PHASE21_EVIDENCE_GAPS_V1);
    expect(value.envelope.realDatasetEligible).toBe(false);
    expect(value.envelope.resourceDiagnostics.candidateCalls).toBe(0);
    expect(value.crossFit.decisionOnlyFoldRejected).toBe(true);
    expect(value.adequacy.dataAdequacyStatus).toBe('current_evidence_insufficient');
    expect(value.adequacy.observedEnvelope.viewerClusterSizes).toEqual([]);
    expect(value.adequacy.observedEnvelope.cellObservations).toEqual({
      count: null,
      minimum: null,
      maximum: null,
      imbalanceRatio: null,
    });
    expect(value.adequacy.observedEnvelope.fullSupportVerified).toBe(false);
    expect(value.adequacy.observedEnvelope.stoppingRuleVerified).toBe(false);
    expect(value.adequacy.candidateApplicabilityStatus)
      .toBe('not_assessed_no_candidate_selected');

    const handoff = buildPhase21SameProcessHonestNoCandidateHandoffV1({
      phase20Handoff: value.phase20,
      assessment: value.adequacy,
      crossFit: value.crossFit,
    });
    expect(handoff.status).toBe('verified');
    if (handoff.status !== 'verified') return;
    expect(handoff.handoff.nextPhaseHandoff).toBe('real_cluster_evidence_required');
    expect(handoff.handoff.selectedMethod).toBe('diagnostics_only_abstention_v1');
    expect(handoff.handoff.blockers).toEqual(PHASE21_HANDOFF_BLOCKERS_V1);
    expect(isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(handoff.handoff)).toBe(true);
  });

  it('rejects decision-only folds, viewer/time leakage, clones, and hostile objects', () => {
    const value = source();
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      evidenceEnvelope: value.envelope,
      assignmentDomain: 'decision_id_v1',
    })).toEqual({ status: 'not_evaluable', blocker: 'phase21_cross_fit_decision_only_fold_rejected' });
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      evidenceEnvelope: value.envelope,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      rows: [
        { rowId: 'eval', decisionId: 'd1', viewerClusterId: 'v0', timeClusterId: 't0', foldId: 0, role: 'evaluation' },
        { rowId: 'train', decisionId: 'd2', viewerClusterId: 'v0', timeClusterId: 't1', foldId: 0, role: 'train' },
      ],
    })).toEqual({ status: 'not_evaluable', blocker: 'phase21_cross_fit_viewer_time_leakage' });
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      evidenceEnvelope: value.envelope,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      rows: [
        { rowId: 'duplicate', decisionId: 'd1', viewerClusterId: 'v0', timeClusterId: 't0', foldId: 0, role: 'evaluation' },
        { rowId: 'duplicate', decisionId: 'd2', viewerClusterId: 'v1', timeClusterId: 't1', foldId: 0, role: 'train' },
      ],
    })).toEqual({ status: 'not_evaluable', blocker: 'phase21_cross_fit_binding_mismatch' });
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      evidenceEnvelope: value.envelope,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      rows: [
        { rowId: 'missing-time', decisionId: 'd1', viewerClusterId: 'v0', foldId: 0, role: 'evaluation' },
      ],
    })).toEqual({ status: 'not_evaluable', blocker: 'phase21_cross_fit_binding_mismatch' });
    expect(isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(structuredClone(value.envelope))).toBe(false);
    expect(isVerifiedPhase21ClusterAwareCrossFitAuditV1(structuredClone(value.crossFit))).toBe(false);

    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => buildPhase21ViewerTimeEvidenceEnvelopeV1(hostile)).not.toThrow();
    expect(buildPhase21ViewerTimeEvidenceEnvelopeV1(hostile)).toEqual({
      status: 'not_evaluable', blocker: 'phase21_evidence_source_unverified',
    });
  });

  it('does not promote synthetic viewer-time provenance or unbranded real sources', () => {
    const phase20 = phase20Handoff();
    expect(buildPhase21ViewerTimeEvidenceEnvelopeV1({
      phase20Handoff: phase20,
      syntheticProvenance: {},
    })).toEqual({ status: 'not_evaluable', blocker: 'phase21_synthetic_provenance_rejected' });
    expect(buildPhase21ViewerTimeEvidenceEnvelopeV1({
      phase20Handoff: phase20,
      realSources: { viewerTimeMembership: { verified: true } },
    })).toEqual({ status: 'not_evaluable', blocker: 'phase21_evidence_source_unverified' });
  });

  it('fails closed on resource plans and unbound fold assignments', () => {
    const value = source();
    for (const plannedResources of [
      { contributions: Number.NaN, memberships: 0, canonicalInputBytes: 1_000, workUnits: 0 },
      { contributions: -1, memberships: 0, canonicalInputBytes: 1_000, workUnits: 0 },
      { contributions: 8_193, memberships: 0, canonicalInputBytes: 33_554_432, workUnits: 0 },
    ]) {
      expect(buildPhase21ViewerTimeEvidenceEnvelopeV1({
        phase20Handoff: value.phase20,
        plannedResources,
      })).toEqual({
        status: 'not_evaluable', blocker: 'phase21_evidence_resource_limit_exceeded',
      });
    }
    for (const plannedRows of [Number.NaN, -1, 0.5, 8_193]) {
      expect(buildPhase21ClusterAwareCrossFitAuditV1({
        ...crossFitInput(value.envelope),
        plannedRows,
      })).toEqual({
        status: 'not_evaluable', blocker: 'phase21_cross_fit_resource_limit_exceeded',
      });
    }
    for (const [field, valueToTest] of [
      ['plannedFolds', Number.NaN],
      ['plannedCanonicalInputBytes', -1],
      ['plannedWorkUnits', 65_537],
    ] as const) {
      expect(buildPhase21ClusterAwareCrossFitAuditV1({
        ...crossFitInput(value.envelope),
        [field]: valueToTest,
      })).toEqual({
        status: 'not_evaluable', blocker: 'phase21_cross_fit_resource_limit_exceeded',
      });
    }
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      evidenceEnvelope: value.envelope,
      foldAssignmentSha256: 'd'.repeat(64),
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase21_cross_fit_binding_mismatch',
    });
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      evidenceEnvelope: value.envelope,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      rows: [],
      foldCount: null,
      foldAssignmentSha256: 'd'.repeat(64),
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase21_cross_fit_binding_mismatch',
    });
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      ...crossFitInput(value.envelope, [], 2),
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase21_cross_fit_binding_mismatch',
    });

    for (const plannedResources of [
      { records: Number.NaN, canonicalInputBytes: 1_000, workUnits: 3 },
      { records: -1, canonicalInputBytes: 1_000, workUnits: 3 },
      { records: 8_193, canonicalInputBytes: 33_554_432, workUnits: 65_536 },
    ]) {
      expect(buildPhase21DataAdequacyAssessmentV1({
        phase20Handoff: value.phase20,
        evidenceEnvelope: value.envelope,
        crossFitAudit: value.crossFit,
        plannedResources,
      })).toEqual({
        status: 'not_evaluable', blocker: 'phase21_adequacy_resource_limit_exceeded',
      });
    }
    expect(value.adequacy.resourceDiagnostics).toMatchObject({
      preflightCompletedBeforeAssessment: true,
      records: 3,
      workUnits: 3,
      candidateCalls: 0,
      inferenceCalls: 0,
      publicationCalls: 0,
    });
  });

  it('checks leakage within each fold and rejects throwing optional getters', () => {
    const value = source();
    const rows = [
      { rowId: 'eval-0', decisionId: 'd0', viewerClusterId: 'v0', timeClusterId: 't0', foldId: 0, role: 'evaluation' as const },
      { rowId: 'train-0', decisionId: 'd1', viewerClusterId: 'v1', timeClusterId: 't1', foldId: 0, role: 'train' as const },
      { rowId: 'eval-1', decisionId: 'd1', viewerClusterId: 'v1', timeClusterId: 't1', foldId: 1, role: 'evaluation' as const },
      { rowId: 'train-1', decisionId: 'd0', viewerClusterId: 'v0', timeClusterId: 't0', foldId: 1, role: 'train' as const },
    ];
    expect(buildPhase21ClusterAwareCrossFitAuditV1(crossFitInput(value.envelope, rows)).status)
      .toBe('verified');

    const hostile = new Proxy({
      phase20Handoff: value.phase20,
      evidenceEnvelope: value.envelope,
      crossFitAudit: value.crossFit,
    }, {
      get: (target, property, receiver) => {
        if (property === 'plannedResources') throw new Error('hostile planned resource getter');
        return Reflect.get(target, property, receiver);
      },
    });
    expect(buildPhase21DataAdequacyAssessmentV1(hostile)).toEqual({
      status: 'not_evaluable', blocker: 'phase21_adequacy_source_unverified',
    });

    let rowsRead = false;
    const preflightHostile = new Proxy({
      evidenceEnvelope: value.envelope,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      plannedFolds: Number.NaN,
      rows: [],
    }, {
      get: (target, property, receiver) => {
        if (property === 'rows') {
          rowsRead = true;
          throw new Error('rows must not be read after resource failure');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(buildPhase21ClusterAwareCrossFitAuditV1(preflightHostile)).toEqual({
      status: 'not_evaluable', blocker: 'phase21_cross_fit_resource_limit_exceeded',
    });
    expect(rowsRead).toBe(false);

    let rowElementRead = false;
    const oversizedRows = new Proxy(new Array(1), {
      get: (target, property, receiver) => {
        if (property === '0') {
          rowElementRead = true;
          throw new Error('row element must not be read after under-plan rejection');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(buildPhase21ClusterAwareCrossFitAuditV1({
      evidenceEnvelope: value.envelope,
      assignmentDomain: 'viewer_time_cluster_cross_fit_v1',
      plannedRows: 0,
      rows: oversizedRows,
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase21_cross_fit_resource_limit_exceeded',
    });
    expect(rowElementRead).toBe(false);
  });
});
