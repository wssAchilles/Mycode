import crypto from 'crypto';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import PostFeatureSnapshot from '../../src/models/PostFeatureSnapshot';
import {
  buildPitSafePartialArtifacts,
  buildPitSafePartialSample,
  parseRequiredCutoff,
  PIT_QUARANTINE_REASONS,
  type PitSafePartialCandidate,
  type PointInTimeEvidenceSet,
} from '../../src/services/recommendation/training/pitSafePartialExport';

const eventTime = '2026-05-01T12:00:00.000Z';
const beforeEvent = '2026-05-01T11:00:00.000Z';

const safeEvidence = (): PointInTimeEvidenceSet => ({
  contacts: { featureAt: beforeEvent, immutable: true },
  embedding: { featureAt: beforeEvent, version: 3 },
  snapshot: { featureAt: beforeEvent, version: 2 },
});

describe('PIT-safe partial export core', () => {
  it('projects hydrated snapshot maps into plain point-in-time values', async () => {
    const training = await import(
      '../../src/services/recommendation/training/pitSafePartialExport'
    ) as typeof import(
      '../../src/services/recommendation/training/pitSafePartialExport'
    ) & {
      projectPitSafeSnapshotMap?: (
        snapshots: ReadonlyMap<string, unknown>,
      ) => Map<string, Record<string, unknown>>;
    };
    const hydrated = {
      toObject: () => ({
        computedAt: new Date(beforeEvent),
        snapshotVersion: 2,
        dominantClusterIds: [7],
        clusterScores: [{ clusterId: 7, score: 0.7 }],
      }),
    };

    expect(training.projectPitSafeSnapshotMap).toBeTypeOf('function');
    const projected = training.projectPitSafeSnapshotMap!(new Map([
      ['post-1', hydrated],
    ]));

    expect(projected.get('post-1')).toMatchObject({
      computedAt: new Date(beforeEvent),
      snapshotVersion: 2,
      dominantClusterIds: [7],
      clusterScores: [{ clusterId: 7, score: 0.7 }],
    });
    expect(projected.get('post-1')).not.toHaveProperty('toObject');
  });

  it('requires a deterministic explicit cutoff', () => {
    expect(() => parseRequiredCutoff(undefined)).toThrow('cutoff_required');
    expect(() => parseRequiredCutoff('not-a-date')).toThrow('invalid_cutoff');
    expect(() => parseRequiredCutoff('2026-05-03T12:00:00')).toThrow(
      'cutoff_timezone_required',
    );
    expect(parseRequiredCutoff('2026-05-03T12:00:00.000Z').toISOString()).toBe(
      '2026-05-03T12:00:00.000Z',
    );
    expect(parseRequiredCutoff('2026-05-03T20:00:00+08:00').toISOString()).toBe(
      '2026-05-03T12:00:00.000Z',
    );
  });

  it('keeps only actions at or before T in history and only post-T actions in labels', () => {
    const sample = buildPitSafePartialSample({
      impression: {
        userId: 'user-1',
        postId: 'post-1',
        requestId: 'request-1',
        timestamp: eventTime,
      },
      historyActions: [
        { action: 'click', timestamp: beforeEvent },
        { action: 'like', timestamp: '2026-05-01T13:00:00.000Z' },
      ],
      labelActions: [
        { action: 'reply', timestamp: beforeEvent },
        { action: 'like', timestamp: '2026-05-01T13:00:00.000Z' },
        { action: 'share', timestamp: '2026-05-03T13:00:00.000Z' },
      ],
      labelObservedThrough: '2026-05-03T12:00:00.000Z',
      windowMs: 24 * 60 * 60 * 1000,
      surface: 'space_feed',
      user: { createdAt: '2025-01-01T00:00:00.000Z' },
      contacts: { followedUserIds: [], evidence: safeEvidence().contacts },
      embedding: {
        interestedInClusters: [{ clusterId: 7, score: 0.9 }],
        producerEmbedding: [],
        qualityScore: 0.8,
        computedAt: beforeEvent,
        version: 3,
      },
      snapshot: {
        computedAt: beforeEvent,
        snapshotVersion: 2,
        postCreatedAt: '2026-04-30T12:00:00.000Z',
        dominantClusterIds: [7],
        clusterScores: [{ clusterId: 7, score: 0.7 }],
        keywords: ['pit'],
        keywordScores: [{ keyword: 'pit', weight: 1 }],
        engagementBucket: 'medium',
        freshnessBucket: 'hours_24',
        qualityScore: 0.7,
        mediaTypes: [],
      },
    });

    expect(sample.row.featureHistoryActionCount).toBe(1);
    expect(sample.row.labelWindowActionCount).toBe(1);
    expect(sample.row.labelLike).toBe(1);
    expect(sample.row.labelReply).toBe(0);
    expect(sample.evidence).toEqual(safeEvidence());
  });

  it('uses decision time for PIT evidence and the outcome contract for exposure and labels', () => {
    const decisionAt = '2026-05-01T12:00:00.000Z';
    const impressionAt = '2026-05-01T12:05:00.000Z';
    const sample = buildPitSafePartialSample({
      impression: {
        userId: 'user-1',
        postId: 'post-1',
        requestId: '5cd7d97d-2e52-48f2-bd19-fc2bc9f457be',
        timestamp: impressionAt,
      },
      decisionAt,
      outcomeContractV1: {
        contractVersion: 'outcome_contract_v1',
        decisionId: '75b6e4ce-4b79-45b1-b4b7-18f945bbebad',
        actionKey: {
          candidateNamespace: 'serving_post_id',
          candidateId: 'post-1',
          servedPosition: 1,
        },
        decisionAt,
        impressionAt,
        horizonMs: 60 * 60 * 1000,
        observedThrough: '2026-05-01T13:05:00.000Z',
        labelAvailability: {
          follow: 'unavailable_in_v1',
          mute: 'unavailable_in_v1',
        },
        status: 'observed',
        labels: {
          click: true,
          like: false,
          reply: false,
          repost: false,
          quote: false,
          share: false,
          dismiss: false,
          blockAuthor: false,
          report: false,
          engagement: false,
          negative: false,
          dwellTimeMs: 0,
        },
      },
      historyActions: [],
      labelActions: [{ action: 'like', timestamp: '2026-05-01T12:06:00.000Z' }],
      labelObservedThrough: '2026-05-01T13:05:00.000Z',
      windowMs: 60 * 60 * 1000,
      contacts: {
        followedUserIds: [],
        evidence: { featureAt: beforeEvent, immutable: true },
      },
      embedding: {
        interestedInClusters: [{ clusterId: 7, score: 0.9 }],
        qualityScore: 0.8,
        computedAt: '2026-05-01T12:03:00.000Z',
        version: 3,
      },
      snapshot: {
        computedAt: beforeEvent,
        snapshotVersion: 2,
      },
    });
    const artifacts = buildPitSafePartialArtifacts({
      candidates: [sample],
      cutoff: '2026-05-01T13:05:00.000Z',
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    });
    const row = JSON.parse(artifacts.quarantineNdjson);

    expect(row.pitEventTime).toBe(decisionAt);
    expect(row.impressionAt).toBe(impressionAt);
    expect(row.outcomeContractV1.status).toBe('observed');
    expect(row.labelClick).toBe(1);
    expect(row.labelLike).toBe(0);
    expect(row.quarantineReasons).toContain(
      PIT_QUARANTINE_REASONS.embeddingAfterEvent,
    );
  });

  it('quarantines non-observed outcomes without fabricating negative labels', () => {
    const actionKey = {
      candidateNamespace: 'serving_post_id' as const,
      candidateId: 'post-1',
      servedPosition: 1,
    };
    const decisionId = '75b6e4ce-4b79-45b1-b4b7-18f945bbebad';
    const decisionAt = '2026-05-01T12:00:00.000Z';
    const observedThrough = '2026-05-01T13:00:00.000Z';
    const identity = {
      contractVersion: 'outcome_contract_v1' as const,
      decisionId,
      actionKey,
      decisionAt,
      horizonMs: 60 * 60 * 1000,
      observedThrough,
      labelAvailability: {
        follow: 'unavailable_in_v1' as const,
        mute: 'unavailable_in_v1' as const,
      },
    };
    const outcomes = [
      {
        ...identity,
        status: 'exposure_missing' as const,
        reason: 'exact_impression_missing' as const,
      },
      {
        ...identity,
        impressionAt: '2026-05-01T12:05:00.000Z',
        status: 'censored' as const,
        reason: 'observation_window_incomplete' as const,
      },
      {
        ...identity,
        status: 'invalid_attribution' as const,
        reason: 'event_request_id_mismatch' as const,
      },
    ];
    const candidates = outcomes.map((outcome, index) => buildPitSafePartialSample({
      impression: {
        sampleId: `sample-${index}`,
        userId: 'user-1',
        postId: 'post-1',
        timestamp: decisionAt,
      },
      decisionAt,
      outcomeContractV1: outcome,
      historyActions: [],
      labelActions: [],
      labelObservedThrough: observedThrough,
      windowMs: 60 * 60 * 1000,
      contacts: {
        followedUserIds: [],
        evidence: safeEvidence().contacts,
      },
      embedding: {
        interestedInClusters: [{ clusterId: 7, score: 0.9 }],
        qualityScore: 0.8,
        computedAt: beforeEvent,
        version: 3,
      },
      snapshot: {
        computedAt: beforeEvent,
        snapshotVersion: 2,
      },
    }));
    const artifacts = buildPitSafePartialArtifacts({
      candidates,
      cutoff: observedThrough,
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    });
    const rows = artifacts.quarantineNdjson.trim().split('\n').map(JSON.parse);

    expect(artifacts.manifest.reasonCounts).toEqual({
      censored: 1,
      exposure_missing: 1,
      invalid_attribution: 1,
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.feedbackLabel).toBeNull();
      expect(row.labelClick).toBeNull();
      expect(row.labelLike).toBeNull();
      expect(row.labelNegative).toBeNull();
      expect(row.outcomeContractV1).not.toHaveProperty('labels');
    }
  });

  it('quarantines a label window truncated by the export cutoff', () => {
    const sample = buildPitSafePartialSample({
      impression: {
        userId: 'user-1',
        postId: 'post-1',
        timestamp: eventTime,
      },
      historyActions: [],
      labelActions: [],
      labelObservedThrough: '2026-05-01T13:00:00.000Z',
      windowMs: 24 * 60 * 60 * 1000,
      contacts: { followedUserIds: [], evidence: safeEvidence().contacts },
      embedding: {
        interestedInClusters: [{ clusterId: 7, score: 0.9 }],
        qualityScore: 0.8,
        computedAt: beforeEvent,
        version: 3,
      },
      snapshot: {
        computedAt: beforeEvent,
        snapshotVersion: 2,
      },
    });
    const artifacts = buildPitSafePartialArtifacts({
      candidates: [sample],
      cutoff: '2026-05-01T13:00:00.000Z',
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    });

    expect(artifacts.manifest.counts).toEqual({ input: 1, valid: 0, quarantine: 1 });
    expect(artifacts.manifest.reasonCounts).toEqual({ label_window_incomplete: 1 });
    expect(JSON.parse(artifacts.quarantineNdjson).quarantineReasons).toContain(
      'label_window_incomplete',
    );
  });

  it('quarantines current-state or post-event features with stable reasons', () => {
    const candidate = (
      sampleId: string,
      evidence: PointInTimeEvidenceSet,
    ): PitSafePartialCandidate => ({
      sampleId,
      eventTime,
      row: { sampleId },
      evidence,
    });
    const artifacts = buildPitSafePartialArtifacts({
      candidates: [
        candidate('valid', safeEvidence()),
        candidate('current-contacts', {
          ...safeEvidence(),
          contacts: { featureAt: beforeEvent },
        }),
        candidate('missing-vector-evidence', {
          ...safeEvidence(),
          embedding: undefined,
        }),
        candidate('future-snapshot', {
          ...safeEvidence(),
          snapshot: { featureAt: '2026-05-01T12:00:00.001Z', version: 2 },
        }),
      ],
      cutoff: '2026-05-03T12:00:00.000Z',
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    });

    expect(artifacts.manifest.counts).toEqual({ input: 4, valid: 1, quarantine: 3 });
    expect(artifacts.manifest.reasonCounts).toEqual({
      [PIT_QUARANTINE_REASONS.contactsEvidenceMissing]: 1,
      [PIT_QUARANTINE_REASONS.embeddingEvidenceMissing]: 1,
      [PIT_QUARANTINE_REASONS.snapshotAfterEvent]: 1,
    });
    expect(artifacts.manifest.pitCoverage).toBe(0.25);
  });

  it('emits byte-stable sorted NDJSON and matching SHA-256 hashes', () => {
    const candidate = (
      sampleId: string,
      row: Record<string, unknown>,
      evidence: PointInTimeEvidenceSet = safeEvidence(),
    ): PitSafePartialCandidate => ({
      sampleId,
      eventTime,
      row,
      evidence,
    });
    const options = {
      cutoff: '2026-05-03T12:00:00.000Z',
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    };
    const forward = buildPitSafePartialArtifacts({
      ...options,
      candidates: [
        candidate('b', { z: 2, a: 1 }),
        candidate('a', { nested: { z: 2, a: 1 } }),
        candidate('c', { quarantined: true }, {
          ...safeEvidence(),
          contacts: { featureAt: beforeEvent },
        }),
      ],
    });
    const reversed = buildPitSafePartialArtifacts({
      ...options,
      candidates: [
        candidate('a', { nested: { a: 1, z: 2 } }),
        candidate('c', { quarantined: true }, {
          ...safeEvidence(),
          contacts: { featureAt: beforeEvent },
        }),
        candidate('b', { a: 1, z: 2 }),
      ],
    });

    expect(reversed).toEqual(forward);
    expect(forward.validNdjson.split('\n').filter(Boolean).map((line) => (
      JSON.parse(line).pitSampleId
    ))).toEqual(['a', 'b']);
    expect(forward.quarantineNdjson.split('\n').filter(Boolean).map((line) => (
      JSON.parse(line).pitSampleId
    ))).toEqual(['c']);
    expect(forward.manifest).toMatchObject({
      manifestVersion: 'pit-safe-partial',
      trainingReady: false,
      cutoff: options.cutoff,
      counts: { input: 3, valid: 2, quarantine: 1 },
      reasonCounts: {
        [PIT_QUARANTINE_REASONS.contactsEvidenceMissing]: 1,
      },
      pitCoverage: 2 / 3,
    });
    expect(forward.manifest.files.valid.sha256).toBe(
      crypto.createHash('sha256').update(forward.validNdjson).digest('hex'),
    );
    expect(forward.manifest.files.quarantine.sha256).toBe(
      crypto.createHash('sha256').update(forward.quarantineNdjson).digest('hex'),
    );
    expect(forward.manifestJson).not.toContain('dataset_acceptance_v1');
  });

  it('uses canonical evidence as a deterministic duplicate tie-breaker', () => {
    const candidate = (evidence: PointInTimeEvidenceSet): PitSafePartialCandidate => ({
      sampleId: 'duplicate',
      eventTime,
      row: { same: true },
      evidence,
    });
    const contactsMissing = candidate({
      ...safeEvidence(),
      contacts: { featureAt: beforeEvent },
    });
    const embeddingMissing = candidate({
      ...safeEvidence(),
      embedding: undefined,
    });
    const options = {
      cutoff: '2026-05-03T12:00:00.000Z',
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    };

    expect(buildPitSafePartialArtifacts({
      ...options,
      candidates: [contactsMissing, embeddingMissing],
    })).toEqual(buildPitSafePartialArtifacts({
      ...options,
      candidates: [embeddingMissing, contactsMissing],
    }));
  });

  it('projects hydrated Mongoose snapshot subdocuments before canonical serialization', () => {
    const snapshot = new PostFeatureSnapshot({
      postId: new mongoose.Types.ObjectId('507f191e810c19729de8a099'),
      authorId: 'author-1',
      postCreatedAt: new Date('2026-04-30T12:00:00.000Z'),
      isNews: false,
      keywords: ['pit'],
      keywordScores: [{ keyword: 'pit', weight: 1 }],
      dominantClusterIds: [7],
      clusterScores: [{ clusterId: 7, score: 0.7 }],
      authorProducerClusters: [{ clusterId: 9, score: 0.5 }],
      denseEmbedding: [0.1, 0.2],
      embeddingModelMode: 'heuristic_fallback',
      safetyModelMode: 'heuristic_fallback',
      contentSafetyCategories: [],
      engagementBucket: 'medium',
      freshnessBucket: 'hours_24',
      hasMedia: false,
      mediaTypes: [],
      qualityScore: 0.7,
      snapshotVersion: 2,
      computedAt: new Date(beforeEvent),
    });
    const sample = buildPitSafePartialSample({
      impression: {
        userId: 'user-1',
        postId: '507f191e810c19729de8a099',
        timestamp: eventTime,
      },
      historyActions: [],
      labelActions: [],
      labelObservedThrough: '2026-05-03T12:00:00.000Z',
      windowMs: 24 * 60 * 60 * 1000,
      contacts: { followedUserIds: [], evidence: safeEvidence().contacts },
      embedding: {
        interestedInClusters: [{ clusterId: 7, score: 0.9 }],
        qualityScore: 0.8,
        computedAt: beforeEvent,
        version: 3,
      },
      snapshot: snapshot as unknown as Parameters<typeof buildPitSafePartialSample>[0]['snapshot'],
    });

    const artifacts = buildPitSafePartialArtifacts({
      candidates: [sample],
      cutoff: '2026-05-03T12:00:00.000Z',
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    });
    const row = JSON.parse(artifacts.validNdjson.trim());

    expect(row.snapshotClusterScores).toEqual([{ clusterId: 7, score: 0.7 }]);
    expect(row.snapshotKeywordScores).toEqual([{ keyword: 'pit', weight: 1 }]);
  });

  it('emits deterministic empty artifacts', () => {
    const artifacts = buildPitSafePartialArtifacts({
      candidates: [],
      cutoff: '2026-05-03T12:00:00.000Z',
      validFile: 'samples.valid.ndjson',
      quarantineFile: 'samples.quarantine.ndjson',
    });

    expect(artifacts.validNdjson).toBe('');
    expect(artifacts.quarantineNdjson).toBe('');
    expect(artifacts.manifest.counts).toEqual({ input: 0, valid: 0, quarantine: 0 });
    expect(artifacts.manifest.pitCoverage).toBe(0);
    expect(artifacts.manifest.files.valid.sha256).toBe(
      crypto.createHash('sha256').update('').digest('hex'),
    );
    expect(artifacts.manifest.files.quarantine.sha256).toBe(
      crypto.createHash('sha256').update('').digest('hex'),
    );
  });
});
