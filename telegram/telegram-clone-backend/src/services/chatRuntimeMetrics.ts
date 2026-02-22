type DurationSeries = {
  values: number[];
  count: number;
  sum: number;
  max: number;
};

type GaugeState = {
  value: number;
  max: number;
  updatedAt: number;
};

type RequestTraceItem = {
  at: string;
  requestId: string;
  chatTraceId?: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
};

const REQUEST_TRAIL_LIMIT = 240;
const DURATION_SERIES_LIMIT = 360;

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function toFinite(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

class ChatRuntimeMetricsService {
  private startedAt = Date.now();
  private updatedAt = this.startedAt;
  private counters = new Map<string, number>();
  private gauges = new Map<string, GaugeState>();
  private durations = new Map<string, DurationSeries>();
  private requestTrail: RequestTraceItem[] = [];

  increment(name: string, delta = 1): void {
    if (!name) return;
    const next = (this.counters.get(name) || 0) + delta;
    this.counters.set(name, next);
    this.updatedAt = Date.now();
  }

  observeValue(name: string, value: number): void {
    if (!name) return;
    const nextValue = toFinite(value);
    const prev = this.gauges.get(name);
    if (!prev) {
      this.gauges.set(name, {
        value: nextValue,
        max: nextValue,
        updatedAt: Date.now(),
      });
      this.updatedAt = Date.now();
      return;
    }

    this.gauges.set(name, {
      value: nextValue,
      max: Math.max(prev.max, nextValue),
      updatedAt: Date.now(),
    });
    this.updatedAt = Date.now();
  }

  observeDuration(name: string, durationMs: number): void {
    if (!name) return;
    const ms = Math.max(0, toFinite(durationMs));
    const prev = this.durations.get(name);
    if (!prev) {
      this.durations.set(name, {
        values: [ms],
        count: 1,
        sum: ms,
        max: ms,
      });
      this.updatedAt = Date.now();
      return;
    }

    prev.values.push(ms);
    if (prev.values.length > DURATION_SERIES_LIMIT) {
      prev.values.splice(0, prev.values.length - DURATION_SERIES_LIMIT);
    }
    prev.count += 1;
    prev.sum += ms;
    prev.max = Math.max(prev.max, ms);
    this.updatedAt = Date.now();
  }

  recordRequest(item: RequestTraceItem): void {
    this.requestTrail.push(item);
    if (this.requestTrail.length > REQUEST_TRAIL_LIMIT) {
      this.requestTrail.splice(0, this.requestTrail.length - REQUEST_TRAIL_LIMIT);
    }
    this.updatedAt = Date.now();
  }

  reset(): void {
    this.startedAt = Date.now();
    this.updatedAt = this.startedAt;
    this.counters.clear();
    this.gauges.clear();
    this.durations.clear();
    this.requestTrail = [];
  }

  snapshot() {
    const counters = Object.fromEntries(
      Array.from(this.counters.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    );
    const gauges = Object.fromEntries(
      Array.from(this.gauges.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => [
          key,
          {
            value: value.value,
            max: value.max,
            updatedAt: value.updatedAt,
          },
        ]),
    );
    const durations = Object.fromEntries(
      Array.from(this.durations.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, series]) => {
          const values = series.values;
          return [
            key,
            {
              count: series.count,
              avgMs: series.count ? Number((series.sum / series.count).toFixed(2)) : 0,
              p50Ms: Number(quantile(values, 0.5).toFixed(2)),
              p95Ms: Number(quantile(values, 0.95).toFixed(2)),
              maxMs: Number(series.max.toFixed(2)),
              sampleCount: values.length,
            },
          ];
        }),
    );

    return {
      startedAt: new Date(this.startedAt).toISOString(),
      updatedAt: new Date(this.updatedAt).toISOString(),
      counters,
      gauges,
      durations,
      requestTrail: this.requestTrail.slice(),
    };
  }
}

export const chatRuntimeMetrics = new ChatRuntimeMetricsService();

