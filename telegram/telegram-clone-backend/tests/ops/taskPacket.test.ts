import { describe, expect, it } from 'vitest';
import {
  AcceptanceCheckKind,
  RecoveryPolicy,
  TaskPacketKind,
  TaskScopeKind,
  validateTaskPacket,
} from '../../src/services/controlPlane/taskPacket';

describe('control plane task packet validation', () => {
  it('accepts a normalized packet for deployment tasks', () => {
    const result = validateTaskPacket({
      id: 'deploy-backend-vps',
      kind: TaskPacketKind.DEPLOY,
      objective: 'Deploy backend to VPS',
      scope: {
        kind: TaskScopeKind.SERVICE,
        targets: ['backend_http'],
      },
      acceptanceChecks: [
        { kind: AcceptanceCheckKind.HTTP_HEALTH, target: '/health' },
        { kind: AcceptanceCheckKind.BROWSER_SMOKE, target: '/login' },
      ],
      recoveryPolicy: RecoveryPolicy.RETRY_THEN_DEGRADE,
      metadata: { phase: 0 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.scope.targets).toEqual(['backend_http']);
    expect(result.packet.acceptanceChecks).toHaveLength(2);
    expect(result.packet.createdAt).toBeTruthy();
  });

  it('rejects malformed packets with actionable errors', () => {
    const result = validateTaskPacket({
      id: '',
      objective: '',
      scope: {
        kind: TaskScopeKind.SERVICE,
        targets: [],
      },
      acceptanceChecks: [
        { kind: AcceptanceCheckKind.CUSTOM_COMMAND },
        { kind: AcceptanceCheckKind.HTTP_HEALTH },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('task packet id 不能为空');
    expect(result.errors).toContain('task packet objective 不能为空');
    expect(result.errors).toContain('非 workspace 任务必须至少声明一个 scope target');
    expect(result.errors).toContain('acceptanceChecks[0] 为 custom_command 时必须提供 command');
    expect(result.errors).toContain('acceptanceChecks[1] 必须提供 target');
  });
});
