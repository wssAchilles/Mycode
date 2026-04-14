import { describe, expect, it } from 'vitest';
import {
  runtimeControlPlane,
  FailureClass,
  LifecyclePhase,
  LifecycleStatus,
  RecoveryAction,
} from '../../src/services/controlPlane/runtimeControlPlane';

describe('runtime control plane service', () => {
  it('records unit transitions and builds compressed summary', () => {
    runtimeControlPlane.markUnit({
      unit: 'backend_http',
      phase: LifecyclePhase.CONFIG_LOAD,
      status: LifecycleStatus.SPAWNING,
      critical: true,
      message: 'boot starting',
    });
    runtimeControlPlane.markFailure('queue', {
      phase: LifecyclePhase.WORKER_BOOT,
      failureClass: FailureClass.QUEUE_FALLBACK,
      message: 'BullMQ bootstrap failed',
      recoveryAction: RecoveryAction.DEGRADE_TO_COMPAT,
      compatMode: true,
    });

    const snapshot = runtimeControlPlane.snapshot();

    expect(snapshot.overallStatus).toBe(LifecycleStatus.DEGRADED);
    expect(snapshot.units.find((unit) => unit.unit === 'queue')?.compatMode).toBe(true);
    expect(snapshot.recommendations[0]?.unit).toBe('queue');
    expect(snapshot.summary).toContain('Summary:');
    expect(snapshot.summary).toContain('Recommended next action');
  });
});
