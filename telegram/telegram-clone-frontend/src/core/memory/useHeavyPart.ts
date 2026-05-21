import { useEffect } from 'react';
import { memoryPressure } from './pressure';

export function useHeavyPart(name: string, unloadFn: () => void, priority = 5): void {
  useEffect(() => {
    const unregister = memoryPressure.register(name, unloadFn, priority);
    return unregister;
  }, [name, unloadFn, priority]);
}
