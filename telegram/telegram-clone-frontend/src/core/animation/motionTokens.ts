export const motionDurations = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

export const motionEasings = {
  standard: 'out(4)',
  emphasized: 'out(5)',
  soft: 'inOut(3)',
} as const;

export const motionStaggers = {
  tight: 24,
  normal: 40,
  loose: 64,
} as const;

export const MOTION_STAGGER_LIMIT = 8;

export function durationForMotion(ms: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : ms;
}

export function staggerForMotion(ms: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : ms;
}

export function limitedMotionItems<T extends Element>(
  items: Iterable<T>,
  limit = MOTION_STAGGER_LIMIT,
): T[] {
  return Array.from(items).slice(0, limit);
}
