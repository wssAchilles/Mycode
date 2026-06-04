import { useCallback, useEffect, useState } from 'react';

import { motionDurations } from './motionTokens';

export interface MotionPresenceState {
  isPresent: boolean;
  isExiting: boolean;
  finishExit: () => void;
}

export function useMotionPresence(
  open: boolean,
  exitDurationMs = motionDurations.normal,
): MotionPresenceState {
  const [isPresent, setIsPresent] = useState(open);
  const isExiting = isPresent && !open;

  useEffect(() => {
    if (open) {
      setIsPresent(true);
      return undefined;
    }

    if (!isPresent) return undefined;

    const timeout = window.setTimeout(() => {
      setIsPresent(false);
    }, exitDurationMs + 80);

    return () => window.clearTimeout(timeout);
  }, [exitDurationMs, isPresent, open]);

  const finishExit = useCallback(() => {
    setIsPresent(false);
  }, []);

  return { isPresent, isExiting, finishExit };
}
