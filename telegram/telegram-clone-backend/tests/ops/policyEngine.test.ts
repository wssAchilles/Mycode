import { describe, expect, it } from 'vitest';
import {
  evaluateControlPlanePolicy,
  FailureClass,
  LifecyclePhase,
  LifecycleStatus,
  RecoveryAction,
} from '../../src/services/controlPlane/policyEngine';

describe('control plane policy engine', () => {
  it('prefers escalation for failed critical units', () => {
    const recommendations = evaluateControlPlanePolicy([
      {
        unit: 'mongo',
        phase: LifecyclePhase.DEPENDENCY_BOOTSTRAP,
        status: LifecycleStatus.FAILED,
        critical: true,
        compatMode: false,
        retries: 1,
        recoveryAction: RecoveryAction.RETRY_ONCE,
        failureClass: FailureClass.DEPENDENCY_BOOTSTRAP,
        message: 'mongo unreachable',
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(recommendations[0]).toEqual({
      unit: 'mongo',
      action: RecoveryAction.ESCALATE,
      reason: 'mongo 是关键单元且当前不可用，需要人工介入',
      priority: 5,
    });
  });

  it('keeps degraded compat services in monitor mode', () => {
    const recommendations = evaluateControlPlanePolicy([
      {
        unit: 'queue',
        phase: LifecyclePhase.WORKER_BOOT,
        status: LifecycleStatus.DEGRADED,
        critical: false,
        compatMode: true,
        retries: 1,
        recoveryAction: RecoveryAction.DEGRADE_TO_COMPAT,
        failureClass: FailureClass.QUEUE_FALLBACK,
        message: 'sync fallback active',
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].action).toBe(RecoveryAction.NOOP);
  });
});
