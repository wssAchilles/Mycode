import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  buildFrozenInferenceDiagnosticDomainV1,
  buildHonestInferenceDiagnosticResultV1,
  createPhase13FailureAttributionSidecarValidatorV1,
  isVerifiedHonestInferenceDiagnosticResultV1,
  PHASE13_PURPOSE_ORDER_V1,
  PHASE13_REASON_ORDER_V1,
  phase13AttributionWorstCaseCanonicalRecordBytesV1,
  publishPhase13FailureAttributionSidecarV1,
  streamPhase13FailureAttributionSidecarV1,
  verifyPhase12FailureAttributionSourceV1,
} from '../../src/services/recommendation/ope/inference/qualification/v3';
import { buildFrozenInferenceQualificationProtocolV1 } from '../../src/services/recommendation/ope/inference/qualification/v2';
import { executeSyntheticSequentialDrQualificationV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/evaluate';
import type { VerifiedFrozenInferenceQualificationProtocolV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/protocol';
import type { SyntheticInferenceQualificationResultV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/contracts';
import { setAtomicSinkTestHooksV1 } from '../../src/services/recommendation/offlinePrediction/snapshotV2/atomicSink';

describe('Phase 13 failure attribution and honest boundary', () => {
  let protocol: VerifiedFrozenInferenceQualificationProtocolV1;
  let qualification: SyntheticInferenceQualificationResultV1;
  let artifact: unknown[];

  beforeAll(async () => {
    const built = buildFrozenInferenceQualificationProtocolV1({
      protocolId: 'phase12-synthetic-qualification',
      generatorSeedMaterial: 'phase12-generator-seed-material-v1',
      bootstrapSeedMaterial: 'phase12-bootstrap-seed-material-v1',
      frozenAt: '2026-07-27T00:00:00.000Z',
    });
    if (built.status !== 'verified') throw new Error(built.blocker);
    protocol = built.protocol;
    artifact = [];
    qualification = await executeSyntheticSequentialDrQualificationV1(
      protocol, (record) => { artifact.push(record); },
    );
  }, 30_000);

  it('semantically replays the complete Phase 12 stream and emits fixed summaries', async () => {
    expect(qualification).toMatchObject({
      candidateStatus: 'failed',
      selectedMethod: 'diagnostics_only_abstention_v1',
      realDatasetEligible: false,
      metrics: { invalidReplicates: 99, invalidRateDenominator: 936 },
      diagnostics: {
        artifactSha256: '9ec5d4d48c5d557b43f27b18d4e0c116deb43664c7a35ea308ee46fa18a15237',
      },
      qualificationSha256: 'da2f08957c0b665793916986570061f7fcf0baacf6bebad63f4fb8fabc9ea5e5',
    });
    expect(protocol.protocolSha256).toBe(
      '8431993e97f7c3bdfcc12dad02d0026a9a46c92ef7847cfb19d9158a4a4b3127',
    );
    const verified = await verifyPhase12FailureAttributionSourceV1({
      protocol, qualification, artifact,
    });
    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') return;
    expect(verified.source).toMatchObject({
      contractVersion: 'verified_phase12_failure_attribution_source_v1',
      rawArtifactRecordCount: 5_420,
      attributionRecordCount: 984,
      dgpPrimitiveWorkUnits: 108_812,
      bootstrapWorkUnits: 879_856,
      peakBufferedClusters: 4,
      realDatasetEligible: false,
    });

    const records = [];
    for await (const record of streamPhase13FailureAttributionSidecarV1(verified.source)) {
      records.push(record);
    }
    expect(records).toHaveLength(984);
    expect(records.filter((record) => record.record === 'replication_attribution')).toHaveLength(937);
    expect(records.filter((record) => record.record === 'assumption_attribution')).toHaveLength(32);
    const summaries = records.filter((record) => record.record === 'scenario_summary');
    const attributable = records.filter((record) => (
      record.record === 'replication_attribution' || record.record === 'assumption_attribution'
    ));
    expect(summaries).toHaveLength(13);
    for (const summary of summaries) {
      expect(summary.purposeReasonCounts).toHaveLength(4);
      expect(summary.purposeReasonCounts.map((entry) => entry.counts.length)).toEqual([
        15, 15, 15, 15,
      ]);
      const matching = attributable.filter((record) => record.scenarioId === summary.scenarioId);
      expect(summary.replicationCount).toBe(matching.length);
      summary.purposeReasonCounts.forEach((purposeCounts, purposeIndex) => {
        expect(purposeCounts.purpose).toBe(PHASE13_PURPOSE_ORDER_V1[purposeIndex]);
        purposeCounts.counts.forEach((count, reasonIndex) => {
          expect(count).toBe(matching.filter((record) => record.purposes[purposeIndex]!
            .reasons.includes(PHASE13_REASON_ORDER_V1[reasonIndex]!)).length);
        });
      });
    }
    const observedDegenerate = records.find((record) => (
      record.record === 'replication_attribution'
      && record.purposes[0]?.reasons.includes('observed_score_degenerate')
    ));
    expect(observedDegenerate).toBeDefined();
    if (observedDegenerate?.record === 'replication_attribution') {
      expect(observedDegenerate.purposes[0]).toMatchObject({
        standardError: null, pValue: null, lower: null, upper: null,
      });
    }
    const replications = records.filter((record) => record.record === 'replication_attribution');
    expect(replications.some((record) => (
      record.purposes[1]?.status === 'not_evaluable'
      && record.purposes[2]?.status === 'evaluated'
    ))).toBe(true);
    expect(replications.some((record) => (
      record.purposes[1]?.status === 'evaluated'
      && record.purposes[2]?.status === 'not_evaluable'
    ))).toBe(true);
    const validator = createPhase13FailureAttributionSidecarValidatorV1(verified.source);
    records.forEach((record) => validator.accept(record));
    expect(validator.finish()).toMatchObject({ recordCount: 984 });
    const tamperedSidecar = structuredClone(records);
    const summaryToTamper = tamperedSidecar.find((record) => record.record === 'scenario_summary');
    if (summaryToTamper?.record === 'scenario_summary') {
      summaryToTamper.purposeReasonCounts[0]!.counts[0] += 1;
    }
    const tamperValidator = createPhase13FailureAttributionSidecarValidatorV1(verified.source);
    expect(() => tamperedSidecar.forEach((record) => tamperValidator.accept(record)))
      .toThrow('failure_attribution_sidecar_validation_mismatch');
    expect(phase13AttributionWorstCaseCanonicalRecordBytesV1()).toBeLessThanOrEqual(4_096);

    const domain = buildFrozenInferenceDiagnosticDomainV1({
      protocol, source: verified.source,
    });
    expect(domain.status).toBe('verified');
    if (domain.status !== 'verified') return;
    expect(domain.domain).toMatchObject({
      applicabilityStatus: 'not_assessed_no_candidate_selected',
      qualificationEvidenceEligible: false,
    });
    expect([
      domain.domain.dgpSha256,
      domain.domain.scoreGeneratorSha256,
      domain.domain.methodSha256,
      domain.domain.methodConfigSha256,
    ].every((value) => /^[0-9a-f]{64}$/.test(value))).toBe(true);
    expect(domain.domain.canonicalScenarios.filter(
      (scenario) => scenario.role === 'diagnostic_baseline',
    )).toHaveLength(8);
    const result = buildHonestInferenceDiagnosticResultV1(domain.domain);
    expect(isVerifiedHonestInferenceDiagnosticResultV1(result)).toBe(true);
    expect(result).toMatchObject({
      diagnosticStatus: 'attributed',
      applicabilityStatus: 'not_assessed_no_candidate_selected',
      methodSelectionStatus: 'not_performed_no_candidate_selected',
      candidateQualificationStatus: 'not_run_no_candidate_selected',
      researchCandidateMethod: null,
      selectedMethod: 'diagnostics_only_abstention_v1',
      realDatasetEligible: false,
      blockers: [
        'finite_sample_inference_unavailable',
        'multiplicity_control_unavailable',
        'synthetic_candidate_method_unavailable',
      ],
    });
  }, 30_000);

  it('rejects semantic drift and cloned result evidence at the whole-set boundary', async () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    await expect(verifyPhase12FailureAttributionSourceV1(hostile)).resolves.toEqual({
      status: 'not_evaluable', blocker: 'failure_attribution_source_unverified',
    });
    expect(buildFrozenInferenceDiagnosticDomainV1(hostile)).toEqual({
      status: 'not_evaluable', blocker: 'failure_attribution_source_unverified',
    });
    await expect(publishPhase13FailureAttributionSidecarV1(hostile)).resolves.toMatchObject({
      status: 'pre_publish_failed', reason: 'failure_attribution_source_unverified',
    });

    const clusterTamper = structuredClone(artifact) as Array<Record<string, unknown>>;
    const cluster = clusterTamper.find((record) => record.record === 'cluster_score')!;
    cluster.y = Number(cluster.y) + 0.01;
    await expect(verifyPhase12FailureAttributionSourceV1({
      protocol, qualification, artifact: clusterTamper,
    })).resolves.toEqual({
      status: 'not_evaluable', blocker: 'qualification_artifact_semantics_mismatch',
    });

    const digestTamper = structuredClone(artifact) as Array<Record<string, unknown>>;
    const replicationEnd = digestTamper.find((record) => (
      record.record === 'replication_end' && record.thresholdTestSha256 !== null
    ))!;
    replicationEnd.thresholdTestSha256 = 'f'.repeat(64);
    await expect(verifyPhase12FailureAttributionSourceV1({
      protocol, qualification, artifact: digestTamper,
    })).resolves.toEqual({
      status: 'not_evaluable', blocker: 'qualification_artifact_semantics_mismatch',
    });

    const assumptionTamper = structuredClone(artifact) as Array<Record<string, unknown>>;
    const assumption = assumptionTamper.find((record) => record.record === 'assumption_control')!;
    assumption.reasons = ['holdout_reuse_present'];
    await expect(verifyPhase12FailureAttributionSourceV1({
      protocol, qualification, artifact: assumptionTamper,
    })).resolves.toEqual({
      status: 'not_evaluable', blocker: 'qualification_control_semantics_unavailable',
    });

    const endTamper = structuredClone(artifact) as Array<Record<string, unknown>>;
    const artifactEnd = endTamper.find((record) => record.record === 'artifact_end')!;
    artifactEnd.candidateStatus = 'synthetic_mixture_gates_passed';
    await expect(verifyPhase12FailureAttributionSourceV1({
      protocol, qualification, artifact: endTamper,
    })).resolves.toEqual({
      status: 'not_evaluable', blocker: 'qualification_artifact_semantics_mismatch',
    });

    await expect(verifyPhase12FailureAttributionSourceV1({
      protocol, qualification: structuredClone(qualification), artifact,
    })).resolves.toEqual({
      status: 'not_evaluable', blocker: 'failure_attribution_source_unverified',
    });
  }, 30_000);

  it('preserves create-only publish uncertainty after the hard-link point', async () => {
    const verified = await verifyPhase12FailureAttributionSourceV1({
      protocol, qualification, artifact,
    });
    if (verified.status !== 'verified') throw new Error(verified.blocker);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'phase13-attribution-'));
    const target = path.join(directory, 'attribution.ndjson');
    try {
      setAtomicSinkTestHooksV1({
        syncParentDirectory: async () => { throw new Error('simulated parent fsync failure'); },
      });
      const published = await publishPhase13FailureAttributionSidecarV1({
        source: verified.source, targetPath: target,
      });
      expect(published).toMatchObject({
        status: 'published_durability_unconfirmed',
        publishedByThisAttempt: true,
        finalPathVisibility: 'may_be_visible',
        retryDisposition: 'reconciliation_required',
        reason: 'parent_directory_sync_failed',
        recordCount: 984,
      });
      const contents = await readFile(target, 'utf8');
      expect(contents.trimEnd().split('\n')).toHaveLength(984);
    } finally {
      setAtomicSinkTestHooksV1();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
