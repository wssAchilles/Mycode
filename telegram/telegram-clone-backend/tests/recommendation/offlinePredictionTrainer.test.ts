import { describe, expect, it } from 'vitest';

import {
  assignDecisionFoldV1,
  canonicalDecisionId,
} from '../../src/services/recommendation/offlinePrediction/trainer/folds';
import {
  predictLogisticV1,
  trainFullBatchLogisticV1,
} from '../../src/services/recommendation/offlinePrediction/trainer/logistic';

describe('Phase 9 deterministic trainer', () => {
  it('matches one hand-calculated full-batch gradient update', () => {
    const model = trainFullBatchLogisticV1([
      { rowId: 'a', features: { x: 2 }, label: 1 },
      { rowId: 'b', features: { x: 0 }, label: 0 },
    ], {
      epochs: 1,
      learningRate: 1,
      l2Lambda: 0,
    });

    expect(model.intercept).toBe(0);
    expect(model.coefficients).toEqual({ x: 0.5 });
    expect(predictLogisticV1(model, { x: 2 })).toBeCloseTo(0.7310585786300049, 15);
  });

  it('is byte-order deterministic and normalizes negative zero', () => {
    const config = { epochs: 2, learningRate: 0.1, l2Lambda: 0.01 };
    const left = trainFullBatchLogisticV1([
      { rowId: 'b', features: { z: -0, a: 2 }, label: 0 },
      { rowId: 'a', features: { a: 1, z: 0 }, label: 1 },
    ], config);
    const right = trainFullBatchLogisticV1([
      { rowId: 'a', features: { z: 0, a: 1 }, label: 1 },
      { rowId: 'b', features: { a: 2, z: 0 }, label: 0 },
    ], config);

    expect(left).toEqual(right);
    expect(Object.is(left.coefficients.z, -0)).toBe(false);
  });

  it('rejects non-finite features, labels and configuration', () => {
    expect(() => trainFullBatchLogisticV1([
      { rowId: 'a', features: { x: Number.NaN }, label: 1 },
    ], { epochs: 1, learningRate: 0.1, l2Lambda: 0 })).toThrow('non_finite_training_value');
    expect(() => trainFullBatchLogisticV1([
      { rowId: 'a', features: { x: 1 }, label: 2 },
    ], { epochs: 1, learningRate: 0.1, l2Lambda: 0 })).toThrow('invalid_soft_label');
    expect(() => trainFullBatchLogisticV1([
      { rowId: 'a', features: { x: 1 }, label: 1 },
    ], { epochs: 1, learningRate: 0, l2Lambda: 0 })).toThrow('invalid_training_config');
  });

  it('assigns canonical UUIDs to stable decision-level folds', () => {
    const upper = '8D3DD5DE-A2C1-47E2-BAFB-91BF557CF4AB';
    const lower = upper.toLowerCase();
    expect(canonicalDecisionId(upper)).toBe(lower);
    expect(assignDecisionFoldV1(upper, 5)).toBe(assignDecisionFoldV1(lower, 5));
    expect(assignDecisionFoldV1(lower, 5)).toBeGreaterThanOrEqual(0);
    expect(assignDecisionFoldV1(lower, 5)).toBeLessThan(5);
    expect(() => assignDecisionFoldV1(lower, 1)).toThrow('invalid_fold_count');
    expect(() => assignDecisionFoldV1('not-a-uuid', 2)).toThrow('invalid_decision_id');
  });
});
