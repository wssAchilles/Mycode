import crypto from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildPitSafePartialArtifacts,
  type PitSafePartialCandidate,
  type PointInTimeEvidenceSet,
} from '../../src/services/recommendation/training/pitSafePartialExport';
import { buildVersionedTrainingArtifacts } from '../../src/services/recommendation/training/artifacts/build';
import type {
  DatasetAcceptanceApprovalConfigV1,
  TrainingArtifactIdentityInput,
} from '../../src/services/recommendation/training/artifacts/contracts';

const cutoff = '2026-05-03T12:00:00.000Z';
const beforeEvent = '2026-05-01T11:00:00.000Z';
const eventTime = '2026-05-01T12:00:00.000Z';
const annBytes = '{"vectors":[[0.1,0.2],[0.3,0.4]]}\n';

const identity: TrainingArtifactIdentityInput = {
  servingIdNamespace: 'mongo_object_id',
  modelIdNamespace: 'recommendation_model_post_id',
  pipelineVersion: 'candidate-pipeline-v1',
  graphVersion: 'graph-contract-v1',
  model: {
    id: 'recommendation-two-tower',
    version: 'two-tower-v1',
  },
  artifact: {
    id: 'recommendation-training-dataset',
  },
  index: {
    namespace: 'recommendation-post-ann',
    id: 'post-ann',
  },
};

const safeEvidence = (): PointInTimeEvidenceSet => ({
  contacts: { featureAt: beforeEvent, immutable: true },
  embedding: { featureAt: beforeEvent, version: 3 },
  snapshot: { featureAt: beforeEvent, version: 2 },
});

function candidate(
  sampleId: string,
  requestId: string,
  feedbackLabel: 'positive' | 'negative',
  evidence: PointInTimeEvidenceSet = safeEvidence(),
): PitSafePartialCandidate {
  return {
    sampleId,
    eventTime,
    evidence,
    row: {
      requestId,
      postId: `serving-${sampleId}`,
      modelPostId: `model-${sampleId}`,
      feedbackLabel,
    },
  };
}

function phase3Artifacts(
  candidates: PitSafePartialCandidate[] = [
    candidate('positive', 'query-positive', 'positive'),
    candidate('negative', 'query-negative', 'negative'),
    candidate('quarantine', 'query-quarantine', 'negative', {
      ...safeEvidence(),
      contacts: { featureAt: beforeEvent },
    }),
  ],
  artifactCutoff = cutoff,
) {
  return buildPitSafePartialArtifacts({
    candidates,
    cutoff: artifactCutoff,
    validFile: 'samples.valid.ndjson',
    quarantineFile: 'samples.quarantine.ndjson',
  });
}

function build(input: {
  phase3?: ReturnType<typeof phase3Artifacts>;
  artifactIdentity?: TrainingArtifactIdentityInput;
  indexBytes?: string;
  annArtifact?: Partial<{
    built: boolean;
    bytes: string;
    metric: string;
    normalization: string;
    dimension: number;
    count: number;
  }>;
  approvalConfig?: DatasetAcceptanceApprovalConfigV1;
} = {}) {
  return buildVersionedTrainingArtifacts({
    phase3Artifacts: input.phase3 || phase3Artifacts(),
    identity: input.artifactIdentity || identity,
    annArtifact: {
      built: true,
      bytes: input.indexBytes ?? annBytes,
      metric: 'cosine',
      normalization: 'l2',
      dimension: 2,
      count: 2,
      ...input.annArtifact,
    },
    approvalConfig: input.approvalConfig,
  });
}

const approvalFixture = JSON.parse(readFileSync(path.resolve(
  __dirname,
  './fixtures/dataset_acceptance_v1.json',
), 'utf8')) as DatasetAcceptanceApprovalConfigV1;

function approvalFor(
  artifacts: ReturnType<typeof build>,
  overrides: Partial<DatasetAcceptanceApprovalConfigV1> = {},
): DatasetAcceptanceApprovalConfigV1 {
  return {
    ...approvalFixture,
    approvedContentDigest: artifacts.datasetDigest,
    identity: {
      ...approvalFixture.identity,
      artifact: {
        ...approvalFixture.identity.artifact,
        version: artifacts.datasetDigest,
      },
      index: {
        ...approvalFixture.identity.index,
        version: artifacts.annManifest.indexVersion,
      },
    },
    ...overrides,
  };
}

function parseNdjson(value: string): Array<Record<string, unknown>> {
  return value.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('versioned recommendation training artifacts', () => {
  it('emits the row contract and an explicit independent ANN identity', () => {
    const artifacts = build();
    const rows = [
      ...parseNdjson(artifacts.validNdjson),
      ...parseNdjson(artifacts.quarantineNdjson),
    ];

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        exampleVersion: 'recommendation_training_example_v1',
        datasetVersion: artifacts.datasetDigest,
        servingIdNamespace: identity.servingIdNamespace,
        modelIdNamespace: identity.modelIdNamespace,
        pipelineVersion: identity.pipelineVersion,
        graphVersion: identity.graphVersion,
        modelId: identity.model.id,
        modelVersion: identity.model.version,
        artifactId: identity.artifact.id,
        artifactVersion: artifacts.datasetDigest,
        indexNamespace: identity.index.namespace,
        indexId: identity.index.id,
        indexVersion: artifacts.annManifest.indexVersion,
      });
      expect(row.servingPostId).toBe(row.postId);
      expect(row.modelPostId).toMatch(/^model-/);
    }
    const rowsById = new Map(rows.map((row) => [row.pitSampleId, row]));
    expect(rowsById.get('positive')?.featureProvenance).toEqual(safeEvidence());
    expect(rowsById.get('negative')?.featureProvenance).toEqual(safeEvidence());
    expect(rowsById.get('quarantine')?.featureProvenance).toEqual({
      ...safeEvidence(),
      contacts: { featureAt: beforeEvent },
    });
    expect(artifacts.annManifest).toEqual({
      manifestVersion: 'ann_artifact_manifest_v1',
      mode: 'diagnostic',
      trainingReady: false,
      cutoff,
      metric: 'cosine',
      normalization: 'l2',
      dimension: 2,
      count: 2,
      sha256: crypto.createHash('sha256').update(annBytes).digest('hex'),
      indexNamespace: 'recommendation-post-ann',
      indexId: 'post-ann',
      indexVersion: artifacts.annManifest.indexVersion,
    });
    expect(artifacts.annManifest.indexNamespace).not.toBe(
      identity.servingIdNamespace,
    );
    expect(artifacts.annManifest.indexNamespace).not.toBe(
      identity.modelIdNamespace,
    );
  });

  it('is byte deterministic and content-versions cutoff plus each artifact input', () => {
    const first = build();
    const second = build();
    const changedCutoff = build({
      phase3: phase3Artifacts(undefined, '2026-05-04T12:00:00.000Z'),
    });
    const changedDataset = build({
      phase3: phase3Artifacts([
        candidate('positive-changed', 'query-positive', 'positive'),
      ]),
    });
    const changedIndex = build({ indexBytes: `${annBytes}changed\n` });

    expect(second).toEqual(first);
    expect(second.validNdjson).toBe(first.validNdjson);
    expect(second.datasetAcceptanceJson).toBe(first.datasetAcceptanceJson);
    expect(changedCutoff.datasetDigest).not.toBe(first.datasetDigest);
    expect(changedCutoff.annManifest.indexVersion).not.toBe(
      first.annManifest.indexVersion,
    );
    expect(changedDataset.datasetDigest).not.toBe(first.datasetDigest);
    expect(changedIndex.annManifest.indexVersion).not.toBe(
      first.annManifest.indexVersion,
    );

    for (const annArtifact of [
      { metric: 'dot_product' },
      { normalization: 'none' },
      { dimension: 3 },
      { count: 3 },
    ]) {
      const changedMetadata = build({
        annArtifact,
        approvalConfig: approvalFor(first),
      });
      expect(changedMetadata.annManifest.indexVersion).not.toBe(
        first.annManifest.indexVersion,
      );
      expect(changedMetadata.datasetDigest).not.toBe(first.datasetDigest);
      expect(changedMetadata.datasetAcceptance.trainingReady).toBe(false);
    }
  });

  it('keeps missing approval diagnostic and synchronizes both readiness flags', () => {
    const artifacts = build();

    expect(artifacts.datasetAcceptance).toMatchObject({
      acceptanceVersion: 'dataset_acceptance_v1',
      mode: 'diagnostic',
      trainingReady: false,
      datasetDigest: artifacts.datasetDigest,
      diagnostics: expect.arrayContaining(['approval_config_missing']),
    });
    expect(artifacts.annManifest.trainingReady).toBe(false);
  });

  it('marks a missing ANN artifact as unbuilt instead of versioning empty bytes', () => {
    const artifacts = buildVersionedTrainingArtifacts({
      phase3Artifacts: phase3Artifacts(),
      identity,
      annArtifact: {
        built: false,
        bytes: '',
        metric: 'none',
        normalization: 'none',
        dimension: 0,
        count: 0,
      },
    });

    expect(artifacts.annManifest).toMatchObject({
      mode: 'diagnostic',
      trainingReady: false,
      count: 0,
      indexVersion: 'artifact_unbuilt',
    });
    expect(artifacts.datasetAcceptance.diagnostics).toContain('artifact_unbuilt');
  });

  it('requires explicit built state plus non-empty ANN bytes and count', () => {
    const approve = (annArtifact: {
      built?: boolean;
      bytes: string;
      metric: string;
      normalization: string;
      dimension: number;
      count: number;
    }) => {
      const diagnostic = buildVersionedTrainingArtifacts({
        phase3Artifacts: phase3Artifacts(),
        identity,
        annArtifact,
      });
      return buildVersionedTrainingArtifacts({
        phase3Artifacts: phase3Artifacts(),
        identity,
        annArtifact,
        approvalConfig: approvalFor(diagnostic),
      });
    };
    const omittedBuilt = approve({
      bytes: '',
      metric: 'cosine',
      normalization: 'l2',
      dimension: 2,
      count: 0,
    });
    const emptyBytes = approve({
      built: true,
      bytes: '',
      metric: 'cosine',
      normalization: 'l2',
      dimension: 2,
      count: 2,
    });
    const emptyCount = approve({
      built: true,
      bytes: annBytes,
      metric: 'cosine',
      normalization: 'l2',
      dimension: 2,
      count: 0,
    });

    expect(omittedBuilt.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['artifact_unbuilt']),
    });
    for (const artifacts of [emptyBytes, emptyCount]) {
      expect(artifacts.datasetAcceptance).toMatchObject({
        trainingReady: false,
        diagnostics: expect.arrayContaining(['ann_artifact_empty']),
      });
    }
  });

  it('rejects digest mismatch, unmet thresholds, and incomplete index identity', () => {
    const diagnostic = build();
    const phase3 = phase3Artifacts();
    const mismatch = build({
      approvalConfig: approvalFor(diagnostic, {
        approvedContentDigest: 'f'.repeat(64),
      }),
    });
    const threshold = build({
      approvalConfig: approvalFor(diagnostic, { minValidQueries: 3 }),
    });
    const incompleteApprovalIdentity = build({
      approvalConfig: approvalFor(diagnostic, {
        identity: {} as DatasetAcceptanceApprovalConfigV1['identity'],
      }),
    });
    const incompleteIdentity = build({
      artifactIdentity: {
        ...identity,
        index: { namespace: '', id: identity.index.id },
      },
    });
    const tamperedCoverage = build({
      phase3: {
        ...phase3,
        manifest: { ...phase3.manifest, pitCoverage: 1 },
      },
      approvalConfig: approvalFor(diagnostic, { minPitCoverage: 1 }),
    });

    expect(mismatch.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['approved_digest_mismatch']),
    });
    expect(threshold.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['min_valid_queries_not_met']),
    });
    expect(incompleteApprovalIdentity.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['approval_identity_incomplete']),
    });
    expect(incompleteIdentity.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['artifact_identity_incomplete']),
    });
    expect(incompleteIdentity.annManifest.indexNamespace).toBe('');
    expect(tamperedCoverage.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['phase3_artifacts_inconsistent']),
    });
    expect(tamperedCoverage.datasetDigest).not.toBe(diagnostic.datasetDigest);
  });

  it('rejects tampered Phase 3 manifest literals even with matching approval', () => {
    const phase3 = phase3Artifacts();
    const tampered = [
      {
        ...phase3,
        manifest: {
          ...phase3.manifest,
          manifestVersion: 'forged' as 'pit-safe-partial',
        },
      },
      {
        ...phase3,
        manifest: {
          ...phase3.manifest,
          trainingReady: true as false,
        },
      },
    ];

    for (const phase3Artifact of tampered) {
      const diagnostic = build({ phase3: phase3Artifact });
      const rejected = build({
        phase3: phase3Artifact,
        approvalConfig: approvalFor(diagnostic),
      });

      expect(rejected.datasetAcceptance).toMatchObject({
        trainingReady: false,
        diagnostics: expect.arrayContaining(['phase3_artifacts_inconsistent']),
      });
    }
  });

  it('recomputes quarantine reason counts and rejects malformed reasons', () => {
    const phase3 = phase3Artifacts();
    const forgedReasonCounts = {
      ...phase3,
      manifest: {
        ...phase3.manifest,
        reasonCounts: { forged_reason: 1 },
      },
    };
    const quarantineRow = parseNdjson(phase3.quarantineNdjson)[0];
    const malformedQuarantineNdjson = `${JSON.stringify({
      ...quarantineRow,
      quarantineReasons: ['valid_reason', '', 42],
    })}\n`;
    const malformedReasons = {
      ...phase3,
      quarantineNdjson: malformedQuarantineNdjson,
      manifest: {
        ...phase3.manifest,
        reasonCounts: { valid_reason: 1 },
        files: {
          ...phase3.manifest.files,
          quarantine: {
            ...phase3.manifest.files.quarantine,
            sha256: crypto.createHash('sha256')
              .update(malformedQuarantineNdjson)
              .digest('hex'),
          },
        },
      },
    };
    const emptyReasonsNdjson = `${JSON.stringify({
      ...quarantineRow,
      quarantineReasons: [],
    })}\n`;
    const emptyReasons = {
      ...phase3,
      quarantineNdjson: emptyReasonsNdjson,
      manifest: {
        ...phase3.manifest,
        reasonCounts: {},
        files: {
          ...phase3.manifest.files,
          quarantine: {
            ...phase3.manifest.files.quarantine,
            sha256: crypto.createHash('sha256')
              .update(emptyReasonsNdjson)
              .digest('hex'),
          },
        },
      },
    };

    for (const phase3Artifact of [forgedReasonCounts, malformedReasons, emptyReasons]) {
      const diagnostic = build({ phase3: phase3Artifact });
      const rejected = build({
        phase3: phase3Artifact,
        approvalConfig: approvalFor(diagnostic),
      });
      expect(rejected.datasetAcceptance).toMatchObject({
        trainingReady: false,
        diagnostics: expect.arrayContaining(['phase3_artifacts_inconsistent']),
      });
    }
    expect(build().datasetAcceptance.diagnostics).not.toContain(
      'phase3_artifacts_inconsistent',
    );
    expect(build({ phase3: phase3Artifacts([]) }).datasetAcceptance.diagnostics).not.toContain(
      'phase3_artifacts_inconsistent',
    );
  });

  it('does not bind dataset identity to output basenames', () => {
    const phase3 = phase3Artifacts();
    const renamedPhase3 = {
      ...phase3,
      manifest: {
        ...phase3.manifest,
        files: {
          valid: { ...phase3.manifest.files.valid, path: 'renamed.valid.ndjson' },
          quarantine: {
            ...phase3.manifest.files.quarantine,
            path: 'renamed.quarantine.ndjson',
          },
        },
      },
    };
    const original = build({ phase3 });
    const renamed = build({ phase3: renamedPhase3 });

    expect(renamed.datasetDigest).toBe(original.datasetDigest);
    expect(renamed.validNdjson).toBe(original.validNdjson);
    expect(renamed.quarantineNdjson).toBe(original.quarantineNdjson);
  });

  it('canonicalizes equivalent timezone cutoffs before content versioning', () => {
    const phase3 = phase3Artifacts();
    const equivalentPhase3 = {
      ...phase3,
      manifest: {
        ...phase3.manifest,
        cutoff: '2026-05-03T20:00:00+08:00',
      },
    };
    const utc = build({ phase3 });
    const offset = build({ phase3: equivalentPhase3 });

    expect(offset.annManifest.cutoff).toBe(cutoff);
    expect(offset.annManifest.indexVersion).toBe(utc.annManifest.indexVersion);
    expect(offset.datasetDigest).toBe(utc.datasetDigest);
  });

  it('rejects invalid or timezone-less artifact cutoffs', () => {
    const phase3 = phase3Artifacts();
    const withCutoff = (value: string) => ({
      ...phase3,
      manifest: { ...phase3.manifest, cutoff: value },
    });

    expect(() => build({
      phase3: withCutoff('2026-05-03T12:00:00'),
    })).toThrow('cutoff_timezone_required');
    expect(() => build({
      phase3: withCutoff('not-a-date'),
    })).toThrow('invalid_cutoff');
  });

  it('becomes ready only for a matching approval with valid rows and all gates met', () => {
    const diagnostic = build();
    const approved = build({ approvalConfig: approvalFor(diagnostic) });
    const emptyDiagnostic = build({ phase3: phase3Artifacts([]) });
    const emptyApproved = build({
      phase3: phase3Artifacts([]),
      approvalConfig: approvalFor(emptyDiagnostic, {
        minValidQueries: 0,
        minPositiveLabels: 0,
        minNegativeLabels: 0,
        minPitCoverage: 0,
      }),
    });

    expect(approved.datasetAcceptance).toMatchObject({
      mode: 'approved',
      trainingReady: true,
      diagnostics: [],
      observed: {
        validExamples: 2,
        validQueries: 2,
        positiveLabels: 1,
        negativeLabels: 1,
        pitCoverage: 2 / 3,
      },
    });
    expect(approved.annManifest).toMatchObject({
      mode: 'approved',
      trainingReady: true,
    });
    expect(emptyApproved.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['valid_examples_missing']),
    });
    expect(emptyApproved.annManifest.trainingReady).toBe(false);
  });

  it('does not approve rows with incomplete serving/model identity', () => {
    const incompleteRows = phase3Artifacts([{
      sampleId: 'missing-model-post-id',
      eventTime,
      evidence: safeEvidence(),
      row: {
        requestId: 'query-incomplete',
        postId: 'serving-incomplete',
        feedbackLabel: 'positive',
      },
    }]);
    const diagnostic = build({ phase3: incompleteRows });
    const rejected = build({
      phase3: incompleteRows,
      approvalConfig: approvalFor(diagnostic, {
        minValidQueries: 1,
        minPositiveLabels: 1,
        minNegativeLabels: 0,
        minPitCoverage: 1,
      }),
    });

    expect(rejected.datasetAcceptance).toMatchObject({
      trainingReady: false,
      diagnostics: expect.arrayContaining(['training_example_identity_incomplete']),
    });
  });

  it('keeps serving and model ID namespaces independently addressable', () => {
    const artifacts = build();
    const row = parseNdjson(artifacts.validNdjson)[0];

    expect(row).toMatchObject({
      servingIdNamespace: 'mongo_object_id',
      modelIdNamespace: 'recommendation_model_post_id',
    });
    expect(row).not.toHaveProperty('idNamespace');
    expect(artifacts.datasetAcceptance.identity).toMatchObject({
      servingIdNamespace: 'mongo_object_id',
      modelIdNamespace: 'recommendation_model_post_id',
    });
    expect(build({
      artifactIdentity: { ...identity, servingIdNamespace: 'uuid' },
    }).datasetDigest).not.toBe(artifacts.datasetDigest);
    expect(build({
      artifactIdentity: { ...identity, modelIdNamespace: 'model_uuid' },
    }).datasetDigest).not.toBe(artifacts.datasetDigest);
  });

  it('requires integer count thresholds and bounded finite PIT coverage', () => {
    const diagnostic = build();
    const invalidThresholds: Array<Partial<DatasetAcceptanceApprovalConfigV1>> = [
      { minValidQueries: 1.5 },
      { minPositiveLabels: 0.5 },
      { minNegativeLabels: 0.5 },
      { minPitCoverage: Number.NaN },
      { minPitCoverage: Number.POSITIVE_INFINITY },
      { minPitCoverage: -0.1 },
      { minPitCoverage: 1.1 },
    ];

    for (const thresholds of invalidThresholds) {
      const rejected = build({
        approvalConfig: approvalFor(diagnostic, thresholds),
      });
      expect(rejected.datasetAcceptance).toMatchObject({
        trainingReady: false,
        diagnostics: expect.arrayContaining(['approval_config_invalid']),
      });
    }
  });
});
