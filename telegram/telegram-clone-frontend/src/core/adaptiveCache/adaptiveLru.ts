export class AdaptiveLRU<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;
  private readonly MIN_SIZE: number;
  private readonly MAX_SIZE: number;
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  constructor(initialSize = 30, minSize = 10, maxSize = 100) {
    this.maxSize = initialSize;
    this.MIN_SIZE = minSize;
    this.MAX_SIZE = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  get capacity(): number {
    return this.maxSize;
  }

  adjustCapacity(): void {
    if (typeof performance === 'undefined' || !('memory' in performance)) return;
    const memory = (performance as any).memory;
    if (!memory) return;

    const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

    if (usageRatio > 0.8) {
      this.maxSize = Math.max(this.MIN_SIZE, Math.floor(this.maxSize * 0.7));
      this.evictToSize();
    } else if (usageRatio < 0.4 && this.maxSize < this.MAX_SIZE) {
      this.maxSize = Math.min(this.MAX_SIZE, Math.floor(this.maxSize * 1.3));
    }
  }

  private evictToSize(): void {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      this.cache.delete(firstKey);
    }
  }

  startMonitoring(intervalMs = 30_000): void {
    this.stopMonitoring();
    this.monitoringInterval = setInterval(() => this.adjustCapacity(), intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}
