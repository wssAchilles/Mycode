export enum TaskPacketKind {
  DEPLOY = 'deploy',
  BACKFILL = 'backfill',
  MIGRATION = 'migration',
  MODEL_REFRESH = 'model_refresh',
  GRAPH_REBUILD = 'graph_rebuild',
  E2EE_SYNC = 'e2ee_sync',
  CUSTOM = 'custom',
}

export enum TaskScopeKind {
  SERVICE = 'service',
  WORKFLOW = 'workflow',
  WORKSPACE = 'workspace',
  CUSTOM = 'custom',
}

export enum AcceptanceCheckKind {
  HTTP_HEALTH = 'http_health',
  QUEUE_DRAIN = 'queue_drain',
  DB_CONSISTENCY = 'db_consistency',
  BROWSER_SMOKE = 'browser_smoke',
  CUSTOM_COMMAND = 'custom_command',
}

export enum RecoveryPolicy {
  RETRY_THEN_DEGRADE = 'retry_then_degrade',
  RETRY_THEN_ESCALATE = 'retry_then_escalate',
  MANUAL_ONLY = 'manual_only',
}

export type TaskScope = {
  kind: TaskScopeKind;
  targets: string[];
};

export type AcceptanceCheck = {
  kind: AcceptanceCheckKind;
  target?: string;
  command?: string;
};

export type TaskPacket = {
  id: string;
  kind: TaskPacketKind;
  objective: string;
  scope: TaskScope;
  acceptanceChecks: AcceptanceCheck[];
  recoveryPolicy: RecoveryPolicy;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type TaskPacketValidationResult =
  | { ok: true; packet: TaskPacket }
  | { ok: false; errors: string[] };

type RawTaskPacket = Partial<TaskPacket> & {
  scope?: Partial<TaskScope>;
  acceptanceChecks?: Array<Partial<AcceptanceCheck>>;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function asEnumValue<T extends Record<string, string>>(enumObj: T, value: unknown, fallback: T[keyof T]): T[keyof T] {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return (Object.values(enumObj) as string[]).includes(normalized) ? (normalized as T[keyof T]) : fallback;
}

export function validateTaskPacket(input: RawTaskPacket): TaskPacketValidationResult {
  const errors: string[] = [];

  const id = normalizeString(input.id);
  const objective = normalizeString(input.objective);
  const kind = asEnumValue(TaskPacketKind, input.kind, TaskPacketKind.CUSTOM);
  const recoveryPolicy = asEnumValue(RecoveryPolicy, input.recoveryPolicy, RecoveryPolicy.MANUAL_ONLY);
  const scopeKind = asEnumValue(TaskScopeKind, input.scope?.kind, TaskScopeKind.CUSTOM);
  const targets = normalizeStringArray(input.scope?.targets);
  const metadata = typeof input.metadata === 'object' && input.metadata !== null && !Array.isArray(input.metadata)
    ? (input.metadata as Record<string, unknown>)
    : {};

  if (!id) {
    errors.push('task packet id 不能为空');
  }

  if (!objective) {
    errors.push('task packet objective 不能为空');
  }

  if (!targets.length && scopeKind !== TaskScopeKind.WORKSPACE) {
    errors.push('非 workspace 任务必须至少声明一个 scope target');
  }

  const acceptanceChecks = Array.isArray(input.acceptanceChecks)
    ? input.acceptanceChecks.map((entry) => ({
        kind: asEnumValue(AcceptanceCheckKind, entry.kind, AcceptanceCheckKind.CUSTOM_COMMAND),
        target: normalizeString(entry.target) || undefined,
        command: normalizeString(entry.command) || undefined,
      }))
    : [];

  acceptanceChecks.forEach((check, index) => {
    if (check.kind === AcceptanceCheckKind.CUSTOM_COMMAND && !check.command) {
      errors.push(`acceptanceChecks[${index}] 为 custom_command 时必须提供 command`);
    }
    if (check.kind !== AcceptanceCheckKind.CUSTOM_COMMAND && !check.target) {
      errors.push(`acceptanceChecks[${index}] 必须提供 target`);
    }
  });

  const createdAt = normalizeString(input.createdAt) || new Date().toISOString();

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    packet: {
      id,
      kind,
      objective,
      scope: {
        kind: scopeKind,
        targets,
      },
      acceptanceChecks,
      recoveryPolicy,
      createdAt,
      metadata,
    },
  };
}
