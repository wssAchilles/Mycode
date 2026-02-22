import { describe, expect, it } from 'vitest';
import { evaluateLegacyRouteGovernance } from '../../src/services/legacyRouteGovernance';

const emptyUsage = {
  conversation: {
    totalCalls: 0,
    lastCalledAt: null,
    quietForMs: null,
    callsLastHour: 0,
    callsLast24h: 0,
  },
  group: {
    totalCalls: 0,
    lastCalledAt: null,
    quietForMs: null,
    callsLastHour: 0,
    callsLast24h: 0,
  },
};

describe('legacy route governance window', () => {
  it('is ready when traffic is quiet and switch window is open', () => {
    const now = Date.UTC(2026, 1, 22, 10, 0, 0);
    const result = evaluateLegacyRouteGovernance({
      usage: emptyUsage,
      legacyRouteMode: 'gone',
      quietHours: 24,
      maxCallsLastHour: 0,
      maxCallsLast24h: 0,
      switchWindowUtcRaw: '09:30-10:30',
      forceOffAfterUtcRaw: '',
      nowMs: now,
    });

    expect(result.switchWindow.configured).toBe(true);
    expect(result.switchWindow.open).toBe(true);
    expect(result.readyToDisableLegacyRoutes).toBe(true);
    expect(result.candidateRouteMode).toBe('off');
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks cutover when switch window is closed', () => {
    const now = Date.UTC(2026, 1, 22, 10, 0, 0);
    const result = evaluateLegacyRouteGovernance({
      usage: emptyUsage,
      legacyRouteMode: 'gone',
      quietHours: 24,
      maxCallsLastHour: 0,
      maxCallsLast24h: 0,
      switchWindowUtcRaw: '10:30-11:30',
      forceOffAfterUtcRaw: '',
      nowMs: now,
    });

    expect(result.switchWindow.configured).toBe(true);
    expect(result.switchWindow.open).toBe(false);
    expect(result.readyToDisableLegacyRoutes).toBe(false);
    expect(result.candidateRouteMode).toBe('gone');
    expect(result.blockers).toContain('switchWindowClosed');
  });

  it('blocks cutover when switch window config is invalid', () => {
    const now = Date.UTC(2026, 1, 22, 10, 0, 0);
    const result = evaluateLegacyRouteGovernance({
      usage: emptyUsage,
      legacyRouteMode: 'gone',
      quietHours: 24,
      maxCallsLastHour: 0,
      maxCallsLast24h: 0,
      switchWindowUtcRaw: 'invalid-window',
      forceOffAfterUtcRaw: '',
      nowMs: now,
    });

    expect(result.switchWindow.configured).toBe(true);
    expect(result.switchWindow.valid).toBe(false);
    expect(result.readyToDisableLegacyRoutes).toBe(false);
    expect(result.candidateRouteMode).toBe('gone');
    expect(result.blockers).toContain('switchWindowConfigInvalid');
  });

  it('forces candidate off when force-off deadline has passed', () => {
    const now = Date.UTC(2026, 1, 22, 10, 0, 0);
    const result = evaluateLegacyRouteGovernance({
      usage: {
        conversation: { ...emptyUsage.conversation, callsLastHour: 9, callsLast24h: 99 },
        group: emptyUsage.group,
      },
      legacyRouteMode: 'auto',
      quietHours: 24,
      maxCallsLastHour: 0,
      maxCallsLast24h: 0,
      switchWindowUtcRaw: '23:00-23:30',
      forceOffAfterUtcRaw: '2026-02-21T00:00:00.000Z',
      nowMs: now,
    });

    expect(result.forceOffAfterUtc).toBe('2026-02-21T00:00:00.000Z');
    expect(result.forcedOffByDeadline).toBe(true);
    expect(result.readyToDisableLegacyRoutes).toBe(true);
    expect(result.candidateRouteMode).toBe('off');
  });
});
