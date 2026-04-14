export enum LifecycleStatus {
  SPAWNING = 'spawning',
  READY = 'ready',
  RUNNING = 'running',
  DEGRADED = 'degraded',
  BLOCKED = 'blocked',
  FAILED = 'failed',
  FINISHED = 'finished',
}

export enum LifecyclePhase {
  CONFIG_LOAD = 'config_load',
  DEPENDENCY_BOOTSTRAP = 'dependency_bootstrap',
  WORKER_BOOT = 'worker_boot',
  HTTP_LISTEN = 'http_listen',
  RUNTIME = 'runtime',
}

export enum FailureClass {
  CONFIGURATION = 'configuration',
  DEPENDENCY_BOOTSTRAP = 'dependency_bootstrap',
  DEPENDENCY_RUNTIME = 'dependency_runtime',
  STARTUP = 'startup',
  QUEUE_FALLBACK = 'queue_fallback',
  WORKER_BOOT = 'worker_boot',
  INFRA = 'infra',
  UNKNOWN = 'unknown',
}

export enum RecoveryAction {
  RETRY_ONCE = 'retry_once',
  DEGRADE_TO_COMPAT = 'degrade_to_compat',
  RESTART_SERVICE = 'restart_service',
  ESCALATE = 'escalate',
  NOOP = 'noop',
}

export type RuntimeUnitState = {
  unit: string;
  phase: LifecyclePhase;
  status: LifecycleStatus;
  critical: boolean;
  compatMode: boolean;
  retries: number;
  recoveryAction?: RecoveryAction;
  failureClass?: FailureClass;
  message?: string;
  updatedAt: string;
};

export type PolicyRecommendation = {
  unit: string;
  action: RecoveryAction;
  reason: string;
  priority: number;
};

export function evaluateControlPlanePolicy(units: RuntimeUnitState[]): PolicyRecommendation[] {
  const recommendations: PolicyRecommendation[] = [];

  for (const unit of units) {
    if (unit.status === LifecycleStatus.FAILED && unit.recoveryAction === RecoveryAction.RETRY_ONCE && unit.retries < 1) {
      recommendations.push({
        unit: unit.unit,
        action: RecoveryAction.RETRY_ONCE,
        reason: `${unit.unit} 首次失败，先执行一次自动重试`,
        priority: 10,
      });
      continue;
    }

    if (unit.status === LifecycleStatus.FAILED && unit.recoveryAction === RecoveryAction.DEGRADE_TO_COMPAT) {
      recommendations.push({
        unit: unit.unit,
        action: RecoveryAction.DEGRADE_TO_COMPAT,
        reason: `${unit.unit} 已失败，建议切到 compat 模式保持主链路可用`,
        priority: 20,
      });
      continue;
    }

    if ((unit.status === LifecycleStatus.FAILED || unit.status === LifecycleStatus.BLOCKED) && unit.critical) {
      recommendations.push({
        unit: unit.unit,
        action: RecoveryAction.ESCALATE,
        reason: `${unit.unit} 是关键单元且当前不可用，需要人工介入`,
        priority: 5,
      });
      continue;
    }

    if (unit.status === LifecycleStatus.DEGRADED && unit.compatMode) {
      recommendations.push({
        unit: unit.unit,
        action: RecoveryAction.NOOP,
        reason: `${unit.unit} 处于 compat 模式，可继续运行但需观察`,
        priority: 40,
      });
    }
  }

  return recommendations.sort((a, b) => a.priority - b.priority);
}
