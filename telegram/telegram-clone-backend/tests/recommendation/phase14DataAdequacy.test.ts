import { readFileSync } from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  deriveSyntheticDgpEnvelopeV1,
} from '../../src/services/recommendation/ope/inference/qualification/v2/dgpMath';
import { executeSyntheticSequentialDrQualificationV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/evaluate';
import { buildFrozenInferenceQualificationProtocolV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/protocol';
import type { VerifiedFrozenInferenceQualificationProtocolV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/protocol';
import {
  buildFrozenInferenceDiagnosticDomainV1,
  buildHonestInferenceDiagnosticResultV1,
  type FrozenInferenceDiagnosticDomainV1,
  type HonestInferenceDiagnosticResultV1,
  type VerifiedPhase12FailureAttributionSourceV1,
  verifyPhase12FailureAttributionSourceV1,
} from '../../src/services/recommendation/ope/inference/qualification/v3';
import {
  buildPhase14DataAdequacyAssessmentV1,
  buildPhase14SameProcessHandoffV1,
  isVerifiedPhase14DataAdequacyAssessmentV1,
  isVerifiedPhase14SameProcessHandoffV1,
  PHASE14_DATA_ADEQUACY_EVIDENCE_GAPS_V1,
  PHASE14_HANDOFF_BLOCKERS_V1,
  type VerifiedPhase14DataAdequacyAssessmentV1,
} from '../../src/services/recommendation/ope/inference/qualification/v4';

describe('Phase 14 candidate-neutral data adequacy', () => {
  let protocol: VerifiedFrozenInferenceQualificationProtocolV1;
  let source: VerifiedPhase12FailureAttributionSourceV1;
  let domain: FrozenInferenceDiagnosticDomainV1;
  let honestResult: HonestInferenceDiagnosticResultV1;
  let assessment: VerifiedPhase14DataAdequacyAssessmentV1;
  let alternateProtocol: VerifiedFrozenInferenceQualificationProtocolV1;
  let alternateSource: VerifiedPhase12FailureAttributionSourceV1;
  let alternateDomain: FrozenInferenceDiagnosticDomainV1;
  let alternateHonestResult: HonestInferenceDiagnosticResultV1;

  beforeAll(async () => {
    const built = buildFrozenInferenceQualificationProtocolV1({
      protocolId: 'phase12-synthetic-qualification',
      generatorSeedMaterial: 'phase12-generator-seed-material-v1',
      bootstrapSeedMaterial: 'phase12-bootstrap-seed-material-v1',
      frozenAt: '2026-07-27T00:00:00.000Z',
    });
    if (built.status !== 'verified') throw new Error(built.blocker);
    protocol = built.protocol;
    const artifact: unknown[] = [];
    const qualification = await executeSyntheticSequentialDrQualificationV1(
      protocol,
      (record) => { artifact.push(record); },
    );
    expect(qualification).toMatchObject({
      metrics: { invalidReplicates: 99, invalidRateDenominator: 936 },
      qualificationSha256: 'da2f08957c0b665793916986570061f7fcf0baacf6bebad63f4fb8fabc9ea5e5',
    });
    const verifiedSource = await verifyPhase12FailureAttributionSourceV1({
      protocol,
      qualification,
      artifact,
    });
    if (verifiedSource.status !== 'verified') throw new Error(verifiedSource.blocker);
    source = verifiedSource.source;
    expect(source.attributionRecordCount).toBe(984);

    const builtDomain = buildFrozenInferenceDiagnosticDomainV1({ protocol, source });
    if (builtDomain.status !== 'verified') throw new Error(builtDomain.blocker);
    domain = builtDomain.domain;
    honestResult = buildHonestInferenceDiagnosticResultV1(domain);
    const builtAssessment = buildPhase14DataAdequacyAssessmentV1({
      protocol,
      source,
      domain,
      honestResult,
    });
    if (builtAssessment.status !== 'verified') throw new Error(builtAssessment.blocker);
    assessment = builtAssessment.assessment;

    const alternateBuilt = buildFrozenInferenceQualificationProtocolV1({
      protocolId: 'phase12-synthetic-qualification-binding-drift',
      generatorSeedMaterial: 'phase12-generator-seed-material-v1',
      bootstrapSeedMaterial: 'phase12-bootstrap-seed-material-v1',
      frozenAt: '2026-07-27T00:00:00.000Z',
    });
    if (alternateBuilt.status !== 'verified') throw new Error(alternateBuilt.blocker);
    alternateProtocol = alternateBuilt.protocol;
    const alternateArtifact: unknown[] = [];
    const alternateQualification = await executeSyntheticSequentialDrQualificationV1(
      alternateProtocol,
      (record) => { alternateArtifact.push(record); },
    );
    const alternateVerifiedSource = await verifyPhase12FailureAttributionSourceV1({
      protocol: alternateProtocol,
      qualification: alternateQualification,
      artifact: alternateArtifact,
    });
    if (alternateVerifiedSource.status !== 'verified') {
      throw new Error(alternateVerifiedSource.blocker);
    }
    alternateSource = alternateVerifiedSource.source;
    const alternateBuiltDomain = buildFrozenInferenceDiagnosticDomainV1({
      protocol: alternateProtocol,
      source: alternateSource,
    });
    if (alternateBuiltDomain.status !== 'verified') throw new Error(alternateBuiltDomain.blocker);
    alternateDomain = alternateBuiltDomain.domain;
    alternateHonestResult = buildHonestInferenceDiagnosticResultV1(alternateDomain);
  }, 30_000);

  it('derives the bounded synthetic envelope without selecting a candidate', () => {
    expect(protocol.protocolSha256).toBe(
      '8431993e97f7c3bdfcc12dad02d0026a9a46c92ef7847cfb19d9158a4a4b3127',
    );
    expect(deriveSyntheticDgpEnvelopeV1(protocol)).toEqual({
      syntheticGeneratedClusterCountRange: [2, 4],
      slotsPerGeneratedCluster: 2,
      supportActionsPerSlot: 4,
      minimumBehaviorPropensity: 0.0001,
      qHatBounds: [0.25, 0.75],
      maximumTwoSlotPrefixWeight: 6_250_000,
    });
    expect(assessment).toMatchObject({
      contractVersion: 'verified_phase14_data_adequacy_assessment_v1',
      estimand: 'mean_reward_per_logged_slot_v1',
      dataAdequacyStatus: 'current_evidence_insufficient',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      researchDisposition: 'current_evidence_insufficient_to_select_candidate',
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      observedSyntheticEnvelope: {
        syntheticGeneratedClusterCountRange: [2, 4],
        slotsPerGeneratedCluster: 2,
        supportActionsPerSlot: 4,
        minimumBehaviorPropensity: 0.0001,
        qHatBounds: [0.25, 0.75],
        maximumTwoSlotPrefixWeight: 6_250_000,
        syntheticRewardSupport: [0, 1],
        clusterUnitVersionPresent: false,
        viewerClusterProvenancePresent: false,
        crossFitProvenance: 'synthetic_direct_qhat_not_cross_fitted',
        revealedDevelopmentEvidence: true,
      },
      evidenceGaps: PHASE14_DATA_ADEQUACY_EVIDENCE_GAPS_V1,
    });
    expect(assessment.observedSyntheticEnvelope.exactSignResolutionAudits.map((audit) => ({
      clusterCount: audit.clusterCount,
      minimumNonrandomizedPValue: audit.minimumNonrandomizedPValue,
      candidateEvidenceEligible: audit.candidateEvidenceEligible,
    }))).toEqual([
      { clusterCount: 2, minimumNonrandomizedPValue: 0.25, candidateEvidenceEligible: false },
      { clusterCount: 4, minimumNonrandomizedPValue: 0.0625, candidateEvidenceEligible: false },
    ]);
    expect(assessment.researchEvidenceGaps).toHaveLength(6);
    for (const family of assessment.researchEvidenceGaps) {
      expect(Object.keys(family)).toEqual(['researchFamily', 'unmetEvidence']);
      expect(family.unmetEvidence.length).toBeGreaterThan(0);
      for (const forbidden of [
        'supported',
        'not_supported',
        'must_evaluate',
        'must_abstain',
        'candidate_applicable',
        'candidate_qualified',
        'methodId',
        'configSha256',
      ]) {
        expect(forbidden in family).toBe(false);
      }
    }
    expect(assessment.evidenceGaps).not.toContain('directional_test_resolution_insufficient');
    expect(isVerifiedPhase14DataAdequacyAssessmentV1(assessment)).toBe(true);
    expect(Object.isFrozen(assessment)).toBe(true);
    expect(Object.isFrozen(assessment.observedSyntheticEnvelope)).toBe(true);

    const phase14Source = readFileSync(path.resolve(
      process.cwd(),
      'src/services/recommendation/ope/inference/qualification/v4/adequacy/index.ts',
    ), 'utf8');
    expect(phase14Source).not.toContain('0.0001');
    expect(phase14Source).not.toContain('6250000');
    expect(phase14Source).not.toContain('0.25');
    expect(phase14Source).not.toContain('0.75');
  });

  it('requires attributed same-process roots at every trust boundary', () => {
    const notAttributed = buildHonestInferenceDiagnosticResultV1({});
    expect(buildPhase14DataAdequacyAssessmentV1({
      protocol,
      source,
      domain,
      honestResult: notAttributed,
    })).toEqual({ status: 'not_evaluable', blocker: 'adequacy_source_not_attributed' });

    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => buildPhase14DataAdequacyAssessmentV1(hostile)).not.toThrow();
    expect(buildPhase14DataAdequacyAssessmentV1(hostile)).toEqual({
      status: 'not_evaluable',
      blocker: 'adequacy_source_unverified',
    });

    const protocolWithLargerB = { ...protocol, bootstrapReplicates: 1_999 };
    expect(() => deriveSyntheticDgpEnvelopeV1(protocolWithLargerB as never))
      .toThrow('synthetic_dgp_envelope_unavailable');
    expect(buildPhase14DataAdequacyAssessmentV1({
      protocol: protocolWithLargerB,
      source,
      domain,
      honestResult,
    })).toEqual({ status: 'not_evaluable', blocker: 'adequacy_source_unverified' });

    expect(buildPhase14DataAdequacyAssessmentV1({
      protocol,
      source: alternateSource,
      domain: alternateDomain,
      honestResult: alternateHonestResult,
    })).toEqual({ status: 'not_evaluable', blocker: 'adequacy_binding_mismatch' });
    expect(buildPhase14DataAdequacyAssessmentV1({
      protocol: alternateProtocol,
      source: alternateSource,
      domain,
      honestResult,
    })).toEqual({ status: 'not_evaluable', blocker: 'adequacy_binding_mismatch' });
    expect(buildPhase14DataAdequacyAssessmentV1({
      protocol: alternateProtocol,
      source: alternateSource,
      domain: alternateDomain,
      honestResult,
    })).toEqual({ status: 'not_evaluable', blocker: 'adequacy_binding_mismatch' });

    expect(isVerifiedPhase14DataAdequacyAssessmentV1(structuredClone(assessment))).toBe(false);
  });

  it('emits only a same-process diagnostics-only handoff', () => {
    const built = buildPhase14SameProcessHandoffV1({ assessment, honestResult });
    expect(built.status).toBe('verified');
    if (built.status !== 'verified') return;
    expect(built.handoff).toMatchObject({
      contractVersion: 'phase14_same_process_offline_diagnostic_handoff_v1',
      handoffScope: 'same_process_offline_diagnostic_v1',
      developmentStatus: 'completed_no_candidate_selected',
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      qualificationEvidenceEligible: false,
      selectedMethod: 'diagnostics_only_abstention_v1',
      realDatasetEligible: false,
      sealedQualificationStatus: 'not_ready',
      nextPhaseHandoff: 'no_candidate_selected',
      phase13ResultSha256: honestResult.resultSha256,
      phase14AssessmentSha256: assessment.assessmentSha256,
      blockers: PHASE14_HANDOFF_BLOCKERS_V1,
    });
    expect('seed' in built.handoff).toBe(false);
    expect('root' in built.handoff).toBe(false);
    expect('dataset' in built.handoff).toBe(false);
    expect('ledger' in built.handoff).toBe(false);
    expect(isVerifiedPhase14SameProcessHandoffV1(built.handoff)).toBe(true);
    expect(isVerifiedPhase14SameProcessHandoffV1(structuredClone(built.handoff))).toBe(false);
    expect(buildPhase14SameProcessHandoffV1({
      assessment: structuredClone(assessment),
      honestResult,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase14_handoff_source_unverified',
    });
    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => buildPhase14SameProcessHandoffV1(hostile)).not.toThrow();
  });
});
