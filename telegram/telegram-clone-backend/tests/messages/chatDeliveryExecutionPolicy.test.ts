import { afterEach, describe, expect, it } from 'vitest';

import {
  getChatDeliveryExecutionPolicySummary,
  shouldNodeExecuteFanoutProjection,
} from '../../src/services/chatDelivery/executionPolicy';

const ORIGINAL_ENV = { ...process.env };

describe('chat delivery execution policy', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('enables Go canary while keeping Node as the primary projection executor', () => {
    process.env.DELIVERY_EXECUTION_MODE = 'go_canary';
    process.env.DELIVERY_CANARY_SEGMENT = 'projection_bookkeeping';
    process.env.DELIVERY_CANARY_MISMATCH_THRESHOLD = '3';
    process.env.DELIVERY_CANARY_DLQ_THRESHOLD = '2';

    const summary = getChatDeliveryExecutionPolicySummary();

    expect(summary.mode).toBe('go_canary');
    expect(summary.nodePrimary).toBe(true);
    expect(summary.goShadow).toBe(true);
    expect(summary.goCanary).toBe(true);
    expect(summary.goPrimary).toBe(false);
    expect(summary.rollbackActive).toBe(false);
    expect(summary.canary.segment).toBe('projection_bookkeeping');
    expect(summary.canary.mismatchThreshold).toBe(3);
    expect(summary.canary.deadLetterThreshold).toBe(2);
    expect(shouldNodeExecuteFanoutProjection(summary).execute).toBe(true);
  });

  it('forces Node execution when rollback mode is requested', () => {
    process.env.DELIVERY_EXECUTION_MODE = 'rollback_node';

    const summary = getChatDeliveryExecutionPolicySummary();
    const decision = shouldNodeExecuteFanoutProjection(summary);

    expect(summary.mode).toBe('rollback_node');
    expect(summary.rollbackActive).toBe(true);
    expect(summary.nodePrimary).toBe(true);
    expect(summary.goCanary).toBe(false);
    expect(decision.execute).toBe(true);
    expect(decision.reason).toBe('rollback_node');
  });
});
