/**
 * Animation blocking system.
 *
 * Tracks running "heavy" animations via a counter.  When the counter is > 0,
 * non-critical component updates should be frozen to keep the main thread
 * available for the animation.
 */

let counter = 0;
const observers = new Set<(blocking: boolean) => void>();

function notifyObservers() {
  const blocking = counter > 0;
  observers.forEach((cb) => cb(blocking));
}

/**
 * Register the start of a heavy animation.
 * Returns an `end` function that must be called when the animation completes.
 * If it is not called, the animation is automatically ended after `duration` ms.
 */
export function beginHeavyAnimation(duration = 500): () => void {
  counter++;
  notifyObservers();

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    counter--;
    notifyObservers();
  };

  setTimeout(end, duration);
  return end;
}

/** Returns `true` while at least one heavy animation is in progress. */
export function isBlockingAnimating(): boolean {
  return counter > 0;
}

/**
 * Schedule `cb` to run once all heavy animations have finished AND the
 * browser is idle.  If no animation is running, the callback is scheduled
 * via `requestIdleCallback` immediately.
 */
export function onFullyIdle(cb: () => void): void {
  const ric = (self as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => void)
    | undefined;

  const scheduleIdle = () => {
    if (ric) {
      ric(cb, { timeout: 1000 });
    } else {
      // Fallback for environments without requestIdleCallback
      setTimeout(cb, 0);
    }
  };

  if (counter > 0) {
    const unsub = subscribe((blocking) => {
      if (!blocking) {
        unsub();
        scheduleIdle();
      }
    });
  } else {
    scheduleIdle();
  }
}

/**
 * Subscribe to blocking-state changes.  Returns an unsubscribe function.
 */
export function subscribe(cb: (blocking: boolean) => void): () => void {
  observers.add(cb);
  return () => {
    observers.delete(cb);
  };
}
