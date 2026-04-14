import {
  evaluateControlPlanePolicy,
  FailureClass,
  LifecyclePhase,
  LifecycleStatus,
  RecoveryAction,
  type PolicyRecommendation,
  type RuntimeUnitState,
} from './policyEngine';
import { compressSummary } from './summaryCompression';

export type ControlPlaneEvent = {
  seq: number;
  at: string;
  unit: string;
  phase: LifecyclePhase;
  status: LifecycleStatus;
  detail?: string;
  failureClass?: FailureClass;
  recoveryAction?: RecoveryAction;
  compatMode?: boolean;
};

type MarkUnitInput = {
  unit: string;
  phase: LifecyclePhase;
  status: LifecycleStatus;
  critical?: boolean;
  compatMode?: boolean;
  retries?: number;
  recoveryAction?: RecoveryAction;
  failureClass?: FailureClass;
  message?: string;
};

class RuntimeControlPlaneService {
  private readonly units = new Map<string, RuntimeUnitState>();
  private readonly events: ControlPlaneEvent[] = [];
  private seq = 0;

  private appendEvent(input: MarkUnitInput): void {
    this.seq += 1;
    this.events.push({
      seq: this.seq,
      at: new Date().toISOString(),
      unit: input.unit,
      phase: input.phase,
      status: input.status,
      detail: input.message,
      failureClass: input.failureClass,
      recoveryAction: input.recoveryAction,
      compatMode: input.compatMode,
    });
    if (this.events.length > 200) {
      this.events.splice(0, this.events.length - 200);
    }
  }

  markUnit(input: MarkUnitInput): RuntimeUnitState {
    const previous = this.units.get(input.unit);
    const next: RuntimeUnitState = {
      unit: input.unit,
      phase: input.phase,
      status: input.status,
      critical: input.critical ?? previous?.critical ?? false,
      compatMode: input.compatMode ?? previous?.compatMode ?? false,
      retries: input.retries ?? previous?.retries ?? 0,
      recoveryAction: input.recoveryAction ?? previous?.recoveryAction,
      failureClass: input.failureClass ?? previous?.failureClass,
      message: input.message ?? previous?.message,
      updatedAt: new Date().toISOString(),
    };
    this.units.set(input.unit, next);
    this.appendEvent(input);
    return next;
  }

  markFailure(unit: string, options: {
    phase: LifecyclePhase;
    failureClass: FailureClass;
    message: string;
    critical?: boolean;
    recoveryAction?: RecoveryAction;
    compatMode?: boolean;
    incrementRetry?: boolean;
  }): RuntimeUnitState {
    const previous = this.units.get(unit);
    return this.markUnit({
      unit,
      phase: options.phase,
      status: options.compatMode ? LifecycleStatus.DEGRADED : LifecycleStatus.FAILED,
      failureClass: options.failureClass,
      critical: options.critical ?? previous?.critical,
      recoveryAction: options.recoveryAction ?? previous?.recoveryAction ?? RecoveryAction.ESCALATE,
      compatMode: options.compatMode ?? false,
      retries: (previous?.retries ?? 0) + (options.incrementRetry ? 1 : 0),
      message: options.message,
    });
  }

  recordRecovery(unit: string, detail: string, options?: {
    phase?: LifecyclePhase;
    status?: LifecycleStatus;
    compatMode?: boolean;
  }): RuntimeUnitState {
    const previous = this.units.get(unit);
    return this.markUnit({
      unit,
      phase: options?.phase ?? previous?.phase ?? LifecyclePhase.RUNTIME,
      status: options?.status ?? LifecycleStatus.RUNNING,
      critical: previous?.critical,
      compatMode: options?.compatMode ?? previous?.compatMode ?? false,
      retries: previous?.retries ?? 0,
      recoveryAction: previous?.recoveryAction,
      message: detail,
    });
  }

  snapshot() {
    const units = Array.from(this.units.values()).sort((a, b) => a.unit.localeCompare(b.unit));
    const recommendations = evaluateControlPlanePolicy(units);
    const overallStatus = this.computeOverallStatus(units);
    const currentBlocker = recommendations.find((entry) => entry.priority <= 20);
    const lastEvent = this.events.length ? this.events[this.events.length - 1] : undefined;

    return {
      overallStatus,
      units,
      recommendations,
      currentBlocker,
      eventTrail: this.events.slice(),
      summary: this.buildSummary(overallStatus, units, recommendations, lastEvent),
      generatedAt: new Date().toISOString(),
    };
  }

  summary(): string {
    return this.snapshot().summary;
  }

  private computeOverallStatus(units: RuntimeUnitState[]): LifecycleStatus {
    if (units.some((unit) => unit.status === LifecycleStatus.FAILED || unit.status === LifecycleStatus.BLOCKED)) {
      return LifecycleStatus.FAILED;
    }
    if (units.some((unit) => unit.status === LifecycleStatus.DEGRADED)) {
      return LifecycleStatus.DEGRADED;
    }
    if (units.every((unit) => unit.status === LifecycleStatus.READY || unit.status === LifecycleStatus.RUNNING)) {
      return LifecycleStatus.RUNNING;
    }
    return LifecycleStatus.SPAWNING;
  }

  private buildSummary(
    overallStatus: LifecycleStatus,
    units: RuntimeUnitState[],
    recommendations: PolicyRecommendation[],
    lastEvent?: ControlPlaneEvent,
  ): string {
    const degradedUnits = units.filter((unit) => unit.status === LifecycleStatus.DEGRADED).map((unit) => unit.unit);
    const failedUnits = units.filter((unit) => unit.status === LifecycleStatus.FAILED || unit.status === LifecycleStatus.BLOCKED);
    const primaryRecommendation = recommendations[0];

    const lines = [
      'Summary:',
      `- Overall status: ${overallStatus}`,
      `- Units tracked: ${units.length}`,
      `- Last checkpoint: ${lastEvent ? `${lastEvent.unit} -> ${lastEvent.status} @ ${lastEvent.phase}` : 'none'}`,
      `- Current blocker: ${failedUnits[0] ? `${failedUnits[0].unit} (${failedUnits[0].failureClass || 'unknown'})` : 'none'}`,
      `- Degraded units: ${degradedUnits.length ? degradedUnits.join(', ') : 'none'}`,
      `- Recommended next action: ${primaryRecommendation ? `${primaryRecommendation.action} on ${primaryRecommendation.unit}` : 'continue monitoring'}`,
    ];

    return compressSummary(lines.join('\n'));
  }
}

export const runtimeControlPlane = new RuntimeControlPlaneService();

export {
  FailureClass,
  LifecyclePhase,
  LifecycleStatus,
  RecoveryAction,
};
