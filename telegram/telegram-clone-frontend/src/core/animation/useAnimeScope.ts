import { useCallback, useEffect, useMemo, useRef, type DependencyList, type MutableRefObject } from 'react';
import { createScope, type Scope } from 'animejs/scope';

import { beginHeavyAnimation } from './heavyAnimation';
import { durationForMotion, motionDurations, motionEasings } from './motionTokens';

type MotionMethod = (...args: never[]) => void;
type MotionMethods = Record<string, MotionMethod>;

export interface AnimeScopeContext<TElement extends HTMLElement | SVGElement> {
  root: TElement | null;
  scope: Scope;
  reducedMotion: boolean;
  duration: (ms: number) => number;
  runHeavy: <T>(durationMs: number, task: () => T) => T;
}

export interface AnimeScopeHandle<
  TElement extends HTMLElement | SVGElement,
  TMethods extends MotionMethods,
> {
  rootRef: MutableRefObject<TElement | null>;
  run: <TName extends keyof TMethods>(
    name: TName,
    ...args: Parameters<TMethods[TName]>
  ) => void;
  isReducedMotion: () => boolean;
}

export interface AnimeScopeOptions {
  heavy?: boolean;
  heavyDurationMs?: number;
}

export function useAnimeScope<
  TElement extends HTMLElement | SVGElement = HTMLDivElement,
  TMethods extends MotionMethods = Record<string, never>,
>(
  setup: (ctx: AnimeScopeContext<TElement>) => TMethods | void,
  deps: DependencyList,
  options: AnimeScopeOptions = {},
): AnimeScopeHandle<TElement, TMethods> {
  const rootRef = useRef<TElement | null>(null);
  const scopeRef = useRef<Scope | null>(null);
  const methodsRef = useRef<Partial<TMethods>>({});
  const reducedMotionRef = useRef(false);
  const optionsRef = useRef(options);
  const heavyEndsRef = useRef(new Set<() => void>());
  optionsRef.current = options;

  const trackHeavyAnimation = useCallback((durationMs: number) => {
    const release = beginHeavyAnimation(durationMs);
    const end = () => {
      heavyEndsRef.current.delete(end);
      release();
    };
    heavyEndsRef.current.add(end);
    return end;
  }, []);

  useEffect(() => {
    methodsRef.current = {};
    reducedMotionRef.current = false;
    const activeHeavyEnds = heavyEndsRef.current;

    const scope = createScope({
      root: rootRef,
      defaults: {
        duration: motionDurations.normal,
        ease: motionEasings.standard,
      },
      mediaQueries: {
        reducedMotion: '(prefers-reduced-motion: reduce)',
      },
    });
    scopeRef.current = scope;

    scope.add((self) => {
      if (!self) return;
      const reducedMotion = Boolean(self.matches.reducedMotion);
      reducedMotionRef.current = reducedMotion;

      const context: AnimeScopeContext<TElement> = {
        root: rootRef.current,
        scope: self,
        reducedMotion,
        duration: (ms) => durationForMotion(ms, reducedMotion),
        runHeavy: (durationMs, task) => {
          if (reducedMotion) return task();
          const end = trackHeavyAnimation(durationMs);
          try {
            return task();
          } catch (error) {
            end();
            throw error;
          }
        },
      };

      methodsRef.current = setup(context) ?? {};
    });

    return () => {
      activeHeavyEnds.forEach((end) => end());
      activeHeavyEnds.clear();
      scope.revert();
      if (scopeRef.current === scope) scopeRef.current = null;
      methodsRef.current = {};
    };
    // The caller controls when the scoped animation methods are rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const run = useCallback(
    <TName extends keyof TMethods>(name: TName, ...args: Parameters<TMethods[TName]>) => {
      const method = methodsRef.current[name];
      if (!method) return;

      const opts = optionsRef.current;
      if (opts.heavy && !reducedMotionRef.current) {
        const durationMs = opts.heavyDurationMs ?? motionDurations.normal;
        const end = trackHeavyAnimation(durationMs);
        try {
          method(...args);
        } catch (error) {
          end();
          throw error;
        }
        return;
      }

      method(...args);
    },
    [trackHeavyAnimation],
  );

  const isReducedMotion = useCallback(() => reducedMotionRef.current, []);

  return useMemo(
    () => ({ rootRef, run, isReducedMotion }),
    [isReducedMotion, run],
  );
}
