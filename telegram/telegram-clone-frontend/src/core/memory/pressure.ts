interface HeavyPart {
  unload: () => void;
  priority: number;
  name: string;
}

class MemoryPressureManager {
  private heavyParts = new Map<string, HeavyPart>();
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  register(name: string, unloadFn: () => void, priority = 5): () => void {
    const part: HeavyPart = { unload: unloadFn, priority, name };
    this.heavyParts.set(name, part);
    return () => this.heavyParts.delete(name);
  }

  async releasePressure(level: 'moderate' | 'critical'): Promise<number> {
    const sorted = [...this.heavyParts.values()].sort((a, b) => a.priority - b.priority);
    const toUnload = level === 'critical' ? sorted : sorted.slice(0, Math.ceil(sorted.length / 2));

    let unloaded = 0;
    for (const part of toUnload) {
      try {
        part.unload();
        unloaded++;
      } catch {
        // Silent fail
      }
    }
    return unloaded;
  }

  getRegisteredCount(): number {
    return this.heavyParts.size;
  }

  startMonitoring(intervalMs = 60_000): void {
    this.stopMonitoring();
    this.monitoringInterval = setInterval(() => {
      if (typeof performance === 'undefined' || !('memory' in performance)) return;
      const memory = (performance as any).memory;
      if (!memory) return;

      const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
      if (usageRatio > 0.9) {
        this.releasePressure('critical');
      } else if (usageRatio > 0.75) {
        this.releasePressure('moderate');
      }
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}

export const memoryPressure = new MemoryPressureManager();

export function useHeavyPart(name: string, unloadFn: () => void, priority = 5): void {
  // React hook - call in useEffect
  // Returns cleanup function
  // Usage: useEffect(() => { return memoryPressure.register('images', () => revokeUrls(), 3); }, []);
}
