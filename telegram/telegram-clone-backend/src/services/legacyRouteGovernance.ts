type LegacyRouteMode = 'gone' | 'off' | 'auto';

type LegacyUsageBucket = {
  totalCalls: number;
  lastCalledAt: number | null;
  quietForMs: number | null;
  callsLastHour: number;
  callsLast24h: number;
};

type LegacyUsageSnapshot = {
  conversation: LegacyUsageBucket;
  group: LegacyUsageBucket;
};

type ParsedSwitchWindow = {
  raw: string;
  startMinutesUtc: number;
  endMinutesUtc: number;
  startLabel: string;
  endLabel: string;
  wraps: boolean;
  allDay: boolean;
};

export type LegacySwitchWindowState = {
  configured: boolean;
  raw: string | null;
  timezone: 'UTC';
  valid: boolean;
  open: boolean;
  start: string | null;
  end: string | null;
  nextOpenAt: number | null;
  nextCloseAt: number | null;
};

export type LegacyRouteGovernanceResult = {
  generatedAt: number;
  callsLastHour: number;
  callsLast24h: number;
  quietForMs: number | null;
  quietThresholdHours: number;
  maxCallsLastHour: number;
  maxCallsLast24h: number;
  switchWindow: LegacySwitchWindowState;
  blockers: string[];
  readyToDisableLegacyRoutes: boolean;
  suggestedDisableAt: number;
  candidateRouteMode: LegacyRouteMode;
  forceOffAfterUtc: string | null;
  forcedOffByDeadline: boolean;
  recommendedAction: string;
};

type EvaluateLegacyRouteGovernanceInput = {
  usage: LegacyUsageSnapshot;
  legacyRouteMode: LegacyRouteMode;
  quietHours: number;
  maxCallsLastHour: number;
  maxCallsLast24h: number;
  switchWindowUtcRaw: string;
  forceOffAfterUtcRaw: string;
  nowMs?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function readIntFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(parsed, min, max);
}

function parseClockSegment(raw: string): { label: string; minutesUtc: number } | null {
  const normalized = raw.trim();
  const match = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const minutesUtc = hour * 60 + minute;
  return {
    label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minutesUtc,
  };
}

function parseSwitchWindow(raw: string): ParsedSwitchWindow | null {
  const normalized = String(raw || '').trim();
  if (!normalized) return null;

  const parts = normalized.split('-');
  if (parts.length !== 2) return null;

  const start = parseClockSegment(parts[0]);
  const end = parseClockSegment(parts[1]);
  if (!start || !end) return null;

  const wraps = start.minutesUtc > end.minutesUtc;
  const allDay = start.minutesUtc === end.minutesUtc;
  return {
    raw: normalized,
    startMinutesUtc: start.minutesUtc,
    endMinutesUtc: end.minutesUtc,
    startLabel: start.label,
    endLabel: end.label,
    wraps,
    allDay,
  };
}

function startOfUtcDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

function utcMinutesOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function nextOccurrenceAtMinute(nowMs: number, minuteOfDayUtc: number): number {
  const dayStart = startOfUtcDayMs(nowMs);
  const sameDay = dayStart + minuteOfDayUtc * MINUTE_MS;
  if (sameDay > nowMs) return sameDay;
  return sameDay + DAY_MS;
}

function isWindowOpen(nowMinutesUtc: number, parsed: ParsedSwitchWindow): boolean {
  if (parsed.allDay) return true;
  if (!parsed.wraps) {
    return nowMinutesUtc >= parsed.startMinutesUtc && nowMinutesUtc < parsed.endMinutesUtc;
  }
  return nowMinutesUtc >= parsed.startMinutesUtc || nowMinutesUtc < parsed.endMinutesUtc;
}

function resolveWindowState(nowMs: number, switchWindowUtcRaw: string): {
  state: LegacySwitchWindowState;
  invalidConfig: boolean;
} {
  const parsed = parseSwitchWindow(switchWindowUtcRaw);
  const configured = String(switchWindowUtcRaw || '').trim().length > 0;

  if (!configured) {
    return {
      state: {
        configured: false,
        raw: null,
        timezone: 'UTC',
        valid: true,
        open: true,
        start: null,
        end: null,
        nextOpenAt: nowMs,
        nextCloseAt: null,
      },
      invalidConfig: false,
    };
  }

  if (!parsed) {
    return {
      state: {
        configured: true,
        raw: String(switchWindowUtcRaw || '').trim(),
        timezone: 'UTC',
        valid: false,
        open: false,
        start: null,
        end: null,
        nextOpenAt: null,
        nextCloseAt: null,
      },
      invalidConfig: true,
    };
  }

  const nowMinutesUtc = utcMinutesOfDay(nowMs);
  const open = isWindowOpen(nowMinutesUtc, parsed);
  const nextOpenAt = open ? nowMs : nextOccurrenceAtMinute(nowMs, parsed.startMinutesUtc);
  const nextCloseAt = parsed.allDay
    ? nowMs + DAY_MS
    : nextOccurrenceAtMinute(nowMs, parsed.endMinutesUtc);

  return {
    state: {
      configured: true,
      raw: parsed.raw,
      timezone: 'UTC',
      valid: true,
      open,
      start: parsed.startLabel,
      end: parsed.endLabel,
      nextOpenAt,
      nextCloseAt,
    },
    invalidConfig: false,
  };
}

function parseForceOffAt(raw: string): {
  normalized: string | null;
  forceOffAt: number | null;
  invalid: boolean;
} {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return { normalized: null, forceOffAt: null, invalid: false };
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return { normalized, forceOffAt: null, invalid: true };
  }

  return { normalized, forceOffAt: parsed, invalid: false };
}

export function evaluateLegacyRouteGovernance(
  input: EvaluateLegacyRouteGovernanceInput,
): LegacyRouteGovernanceResult {
  const now = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const quietHours = clampInt(input.quietHours, 1, 24 * 14);
  const quietThresholdMs = quietHours * 60 * 60 * 1000;
  const maxCallsLastHour = clampInt(input.maxCallsLastHour, 0, Number.MAX_SAFE_INTEGER);
  const maxCallsLast24h = clampInt(input.maxCallsLast24h, 0, Number.MAX_SAFE_INTEGER);

  const callsLastHour =
    Number(input.usage.conversation.callsLastHour || 0) + Number(input.usage.group.callsLastHour || 0);
  const callsLast24h =
    Number(input.usage.conversation.callsLast24h || 0) + Number(input.usage.group.callsLast24h || 0);
  const lastCalledAt = Math.max(
    Number(input.usage.conversation.lastCalledAt || 0),
    Number(input.usage.group.lastCalledAt || 0),
  ) || null;

  const quietForMs = lastCalledAt ? Math.max(0, now - lastCalledAt) : null;
  const quietGateAt = lastCalledAt ? lastCalledAt + quietThresholdMs : now;

  const { state: switchWindow, invalidConfig } = resolveWindowState(now, input.switchWindowUtcRaw);
  const forceOff = parseForceOffAt(input.forceOffAfterUtcRaw);
  const forcedOffByDeadline = forceOff.forceOffAt !== null && now >= forceOff.forceOffAt;
  const blockers: string[] = [];

  if (callsLastHour > maxCallsLastHour) {
    blockers.push(`callsLastHour>${maxCallsLastHour}`);
  }
  if (callsLast24h > maxCallsLast24h) {
    blockers.push(`callsLast24h>${maxCallsLast24h}`);
  }
  if (quietForMs !== null && quietForMs < quietThresholdMs) {
    blockers.push(`quietForMs<${quietThresholdMs}`);
  }
  if (invalidConfig) {
    blockers.push('switchWindowConfigInvalid');
  } else if (switchWindow.configured && !switchWindow.open) {
    blockers.push('switchWindowClosed');
  }
  if (forceOff.invalid) {
    blockers.push('forceOffAfterUtcInvalid');
  }

  const readyToDisableLegacyRoutes = forcedOffByDeadline || blockers.length === 0;
  const switchGateAt = switchWindow.valid ? switchWindow.nextOpenAt || now : now;
  let suggestedDisableAt = Math.max(quietGateAt, switchGateAt);
  if (forceOff.forceOffAt !== null) {
    suggestedDisableAt = Math.min(suggestedDisableAt, forceOff.forceOffAt);
  }
  if (forcedOffByDeadline) {
    suggestedDisableAt = now;
  }
  const candidateRouteMode: LegacyRouteMode = readyToDisableLegacyRoutes ? 'off' : 'gone';

  let recommendedAction = 'keep 410 migration window; monitor callsLastHour/callsLast24h before switching off';
  if (forcedOffByDeadline) {
    recommendedAction = 'forced off by LEGACY_FORCE_OFF_AFTER_UTC deadline';
  } else if (input.legacyRouteMode === 'off') {
    recommendedAction = 'legacy routes fully removed (404)';
  } else if (input.legacyRouteMode === 'auto') {
    recommendedAction = readyToDisableLegacyRoutes
      ? 'auto mode ready: legacy routes can serve 404(off) in current window'
      : 'auto mode holding: keep 410(gone) until blockers clear';
  } else if (readyToDisableLegacyRoutes) {
    recommendedAction = 'ready to switch LEGACY_MESSAGE_ROUTE_MODE=off';
  } else if (blockers.includes('switchWindowClosed') && !blockers.some((b) => b.startsWith('callsLast'))) {
    recommendedAction = 'traffic is quiet enough; wait for switch window to open, then cut to off';
  } else if (blockers.includes('switchWindowConfigInvalid')) {
    recommendedAction = 'switch window config is invalid; fix LEGACY_DISABLE_SWITCH_WINDOW_UTC before cutover';
  } else if (blockers.includes('forceOffAfterUtcInvalid')) {
    recommendedAction = 'force-off deadline is invalid; fix LEGACY_FORCE_OFF_AFTER_UTC';
  }

  return {
    generatedAt: now,
    callsLastHour,
    callsLast24h,
    quietForMs,
    quietThresholdHours: quietHours,
    maxCallsLastHour,
    maxCallsLast24h,
    switchWindow,
    blockers,
    readyToDisableLegacyRoutes,
    suggestedDisableAt,
    candidateRouteMode,
    forceOffAfterUtc: forceOff.normalized,
    forcedOffByDeadline,
    recommendedAction,
  };
}

export function evaluateLegacyRouteGovernanceFromEnv(
  usage: LegacyUsageSnapshot,
  legacyRouteMode: LegacyRouteMode,
  nowMs?: number,
): LegacyRouteGovernanceResult {
  return evaluateLegacyRouteGovernance({
    usage,
    legacyRouteMode,
    quietHours: readIntFromEnv(process.env.LEGACY_DISABLE_QUIET_HOURS, 24, 1, 24 * 14),
    maxCallsLastHour: readIntFromEnv(process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR, 0, 0, Number.MAX_SAFE_INTEGER),
    maxCallsLast24h: readIntFromEnv(process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H, 0, 0, Number.MAX_SAFE_INTEGER),
    switchWindowUtcRaw: String(process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC || '').trim(),
    forceOffAfterUtcRaw: String(process.env.LEGACY_FORCE_OFF_AFTER_UTC || '').trim(),
    nowMs,
  });
}
