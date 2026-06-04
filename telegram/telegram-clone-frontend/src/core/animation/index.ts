export { beginHeavyAnimation, isBlockingAnimating, onFullyIdle, subscribe } from './heavyAnimation';
export {
  limitedMotionItems,
  motionDurations,
  motionEasings,
  motionStaggers,
  MOTION_STAGGER_LIMIT,
  durationForMotion,
  staggerForMotion,
} from './motionTokens';
export { createTimeline, stagger, waapi } from './motionPrimitives';
export { useAnimeScope, type AnimeScopeContext, type AnimeScopeHandle } from './useAnimeScope';
export { useHeavyAnimationGuard } from './useHeavyAnimationGuard';
export { useMotionPresence, type MotionPresenceState } from './useMotionPresence';
