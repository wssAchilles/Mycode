export class LruCache<K, V> {
  private map = new Map<K, V>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get size() {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): Array<{ key: K; value: V }> {
    const evicted: Array<{ key: K; value: V }> = [];

    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);

    while (this.map.size > this.limit) {
      const firstKey = this.map.keys().next().value as K | undefined;
      if (firstKey === undefined) break;
      const firstValue = this.map.get(firstKey);
      this.map.delete(firstKey);
      if (firstValue !== undefined) {
        evicted.push({ key: firstKey, value: firstValue });
      }
    }

    return evicted;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }
}
