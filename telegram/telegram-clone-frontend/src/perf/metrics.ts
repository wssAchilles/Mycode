import type { Metric } from 'web-vitals';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';

type Reporter = (metric: Metric) => void;

function defaultReporter(metric: Metric) {
  // eslint-disable-next-line no-console
  console.log('[web-vitals]', metric.name, metric.value, metric);
}

export function initPerfMetrics(reporter: Reporter = defaultReporter) {
  if (typeof window === 'undefined') return;

  try {
    onCLS(reporter);
    onFCP(reporter);
    onINP(reporter);
    onLCP(reporter);
    onTTFB(reporter);
  } catch {
    // ignore
  }

  // Long task observer (main-thread heavy work signal).
  try {
    const PerfObs = (window as any).PerformanceObserver as typeof PerformanceObserver | undefined;
    if (!PerfObs) return;

    const obs = new PerfObs((list) => {
      for (const entry of list.getEntries()) {
        // eslint-disable-next-line no-console
        console.warn('[longtask]', Math.round(entry.duration), entry);
      }
    });
    obs.observe({ entryTypes: ['longtask'] as any });
  } catch {
    // ignore
  }
}

