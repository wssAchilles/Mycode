import { isBlockingAnimating, subscribe } from '../animation/heavyAnimation';

interface IdleCallbackWindow {
  requestIdleCallback?: (cb: (deadline: { timeRemaining: () => number }) => void, opts?: { timeout: number }) => void;
}

export type AnyToVoidFunction = (...args: unknown[]) => void;
export type NoneToVoidFunction = () => void;

// Tick-end microtask batching (telegram-tt style).
let onTickEndCallbacks: NoneToVoidFunction[] | undefined;

export function onTickEnd(callback: NoneToVoidFunction) {
  if (!onTickEndCallbacks) {
    onTickEndCallbacks = [callback];
    Promise.resolve().then(() => {
      const callbacks = onTickEndCallbacks!;
      onTickEndCallbacks = undefined;
      callbacks.forEach((cb) => cb());
    });
  } else {
    onTickEndCallbacks.push(callback);
  }
}

export function throttleWithTickEnd<F extends AnyToVoidFunction>(fn: F) {
  return throttleWith(onTickEnd, fn);
}

export function throttleWith<F extends AnyToVoidFunction>(
  schedulerFn: (cb: NoneToVoidFunction) => void,
  fn: F
) {
  let waiting = false;
  let args: Parameters<F>;

  return (..._args: Parameters<F>) => {
    args = _args;
    if (waiting) return;
    waiting = true;

    schedulerFn(() => {
      waiting = false;
      fn(...args);
    });
  };
}

const IDLE_TIMEOUT = 500;
let onIdleCallbacks: NoneToVoidFunction[] | undefined;

export function onIdle(callback: NoneToVoidFunction) {
  const ric = (self as unknown as IdleCallbackWindow).requestIdleCallback;

  if (!ric) {
    onTickEnd(callback);
    return;
  }

  if (!onIdleCallbacks) {
    onIdleCallbacks = [callback];
    ric((deadline) => {
      const callbacks = onIdleCallbacks!;
      onIdleCallbacks = undefined;

      while (callbacks.length) {
        const cb = callbacks.shift()!;
        cb();
        if (!deadline.timeRemaining()) break;
      }

      // Re-schedule remaining callbacks.
      if (callbacks.length) {
        if (onIdleCallbacks) {
          onIdleCallbacks = callbacks.concat(onIdleCallbacks);
        } else {
          callbacks.forEach(onIdle);
        }
      }
    }, { timeout: IDLE_TIMEOUT });
  } else {
    onIdleCallbacks.push(callback);
  }
}

// Level 2: RAF — next frame start
export function onNextFrame(cb: NoneToVoidFunction): void {
  requestAnimationFrame(cb);
}

// Level 3: Double RAF — ensure browser has painted
export function afterPaint(cb: NoneToVoidFunction): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

// Level 5: Fully idle — no animation + idle
export function onFullyIdle(cb: NoneToVoidFunction): void {
  const ric = (self as unknown as IdleCallbackWindow).requestIdleCallback;

  const scheduleIdle = () => {
    if (ric) {
      ric(cb, { timeout: 1000 });
    } else {
      onTickEnd(cb);
    }
  };

  if (isBlockingAnimating()) {
    const unsub = subscribe((blocking: boolean) => {
      if (!blocking) {
        unsub();
        scheduleIdle();
      }
    });
  } else {
    scheduleIdle();
  }
}

