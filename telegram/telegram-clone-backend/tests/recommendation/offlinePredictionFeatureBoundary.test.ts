import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSocialPhoenixFeatureMap,
  buildSocialPhoenixFeatureMapAt,
  freshnessDecayAt,
} from '../../src/services/recommendation/socialPhoenix/featureEngineering';
import {
  OFFLINE_REWARD_HEADS_V1,
  offlinePrimitivePredictionsSchema,
} from '../../src/services/recommendation/offlinePrediction/contracts/reward';
import {
  encodeOfflineActionFeaturesV1,
} from '../../src/services/recommendation/offlinePrediction/features/encode';

const DECISION_AT = '2026-07-18T12:00:00.000Z';
const CREATED_AT = '2026-07-17T12:00:00.000Z';

describe('Phase 9 offline feature boundary', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps offline freshness independent of wall clock and preserves serving wrapper behavior', () => {
    const input = {
      createdAt: CREATED_AT,
      recallSource: 'TwoTowerSource',
      inNetwork: false,
      retrievalEmbeddingScore: 0.4,
    };
    const offline = buildSocialPhoenixFeatureMapAt(input, DECISION_AT);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(DECISION_AT));
    expect(buildSocialPhoenixFeatureMap(input)).toEqual(offline);

    vi.setSystemTime(new Date('2026-07-25T12:00:00.000Z'));
    expect(buildSocialPhoenixFeatureMapAt(input, DECISION_AT)).toEqual(offline);
    expect(buildSocialPhoenixFeatureMap(input).freshness).not.toBe(offline.freshness);
    expect(freshnessDecayAt(CREATED_AT, DECISION_AT)).toBe(offline.freshness);
  });

  it('encodes one 1-based position feature and removes bias from trainable coefficients', () => {
    const base = {
      decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab',
      decisionAt: DECISION_AT,
      featureAt: DECISION_AT,
      referenceAt: DECISION_AT,
      actionKey: {
        candidateNamespace: 'serving_post_id' as const,
        candidateId: '507f191e810c19729de8c001',
        servedPosition: 1,
      },
      featureInput: { createdAt: CREATED_AT, recallSource: 'TwoTowerSource' },
    };
    const first = encodeOfflineActionFeaturesV1(base);
    const second = encodeOfflineActionFeaturesV1({
      ...base,
      actionKey: { ...base.actionKey, servedPosition: 2 },
    });

    expect(first.status).toBe('encoded');
    expect(second.status).toBe('encoded');
    if (first.status !== 'encoded' || second.status !== 'encoded') return;
    expect(first.row.features).not.toHaveProperty('bias');
    expect(first.row.features['served_position:1']).toBe(1);
    expect(second.row.features['served_position:2']).toBe(1);
    expect(Object.keys(first.row.features).filter((key) => key.startsWith('served_position:'))).toEqual([
      'served_position:1',
    ]);
    expect(first.row.sourceSha256).not.toBe(second.row.sourceSha256);
  });

  it.each([
    [{ featureAt: '2026-07-18T12:00:00Z' }, 'invalid_timestamp'],
    [{ referenceAt: '2026-07-18T12:00:01.000Z' }, 'reference_time_mismatch'],
    [{ featureAt: '2026-07-18T12:00:01.000Z' }, 'feature_after_decision'],
    [{ featureInput: { createdAt: '2026-07-18T12:00:01.000Z' } }, 'created_after_decision'],
    [{ actionKey: { candidateNamespace: 'serving_post_id', candidateId: 'x', servedPosition: 0 } }, 'invalid_input'],
  ])('fails closed for invalid offline input %#', (override, blocker) => {
    const input = {
      decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab',
      decisionAt: DECISION_AT,
      featureAt: DECISION_AT,
      referenceAt: DECISION_AT,
      actionKey: {
        candidateNamespace: 'serving_post_id',
        candidateId: '507f191e810c19729de8c001',
        servedPosition: 1,
      },
      featureInput: { createdAt: CREATED_AT },
      ...override,
    };

    expect(encodeOfflineActionFeaturesV1(input)).toEqual({
      status: 'not_evaluable',
      blocker,
    });
  });

  it('keeps the ten offline heads strict and separate from online tasks', () => {
    expect(OFFLINE_REWARD_HEADS_V1).toEqual([
      'click', 'like', 'reply', 'repost', 'quote',
      'share', 'dismiss', 'blockAuthor', 'report', 'dwell',
    ]);
    const valid = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [head, 0.5]));
    expect(offlinePrimitivePredictionsSchema.safeParse(valid).success).toBe(true);
    expect(offlinePrimitivePredictionsSchema.safeParse({ ...valid, engagement: 0.5 }).success).toBe(false);
    const { report: _report, ...missing } = { ...valid, report: 0.5 };
    expect(offlinePrimitivePredictionsSchema.safeParse(missing).success).toBe(false);
  });
});
