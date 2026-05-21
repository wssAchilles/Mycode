import { useEffect, useState } from 'react';

import { subscribe } from './heavyAnimation';

/**
 * React hook that returns `true` while a heavy animation is blocking.
 * Components can use this to skip non-critical re-renders during animations.
 */
export function useHeavyAnimationGuard(): boolean {
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    return subscribe(setBlocking);
  }, []);

  return blocking;
}
