export const OPE_V3_LOG_MAX = Math.log(Number.MAX_VALUE);
export const OPE_V3_LOG_MIN = Math.log(Number.MIN_VALUE);

type ScalePrefix = 'importance' | 'clipped';
type ScaleBlocker = `${ScalePrefix}_contribution_${'overflow' | 'underflow'}`;

export function scaleLogValueV3(
  logFactor: number,
  value: number,
  prefix: ScalePrefix,
): { status: 'scaled'; value: number } | { status: 'not_evaluable'; blocker: ScaleBlocker } {
  if (value === 0 || logFactor === Number.NEGATIVE_INFINITY) {
    return { status: 'scaled', value: 0 };
  }
  const logProduct = logFactor + Math.log(Math.abs(value));
  if (logProduct > OPE_V3_LOG_MAX) {
    return { status: 'not_evaluable', blocker: `${prefix}_contribution_overflow` };
  }
  if (logProduct < OPE_V3_LOG_MIN) {
    return { status: 'not_evaluable', blocker: `${prefix}_contribution_underflow` };
  }
  return { status: 'scaled', value: Math.sign(value) * Math.exp(logProduct) };
}
