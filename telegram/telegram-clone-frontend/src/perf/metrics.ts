import type { Metric } from 'web-vitals';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { perfBudgets, perfFeatureFlags } from './budgets';

type Reporter = (metric: Metric) => void;

function defaultReporter(metric: Metric) {
  if (!perfFeatureFlags.enablePerfConsole) return;
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
    const perfObsCtor = typeof PerformanceObserver !== 'undefined'
      ? PerformanceObserver
      : undefined;
    if (!perfObsCtor) return;

    const obs = new perfObsCtor((list) => {
      for (const entry of list.getEntries()) {
        if (!perfFeatureFlags.enableLongTaskWarnings) continue;
        if (entry.duration < perfBudgets.longTaskThresholdMs) continue;
        // eslint-disable-next-line no-console
        console.warn('[longtask]', Math.round(entry.duration), entry);
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// PerfMonitor – runtime performance metrics collector
// ---------------------------------------------------------------------------

const LONG_FRAME_THRESHOLD_MS = 50;
const DEFAULT_FPS_MEASURE_MS = 1000;

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

export interface PerformanceSnapshot {
  /** Chat switching */
  chatSwitchTimeMs: number;

  /** Rendering */
  messageRenderTimeMs: number;
  scrollFps: number;
  jankCount: number;

  /** Network */
  messageSendLatencyMs: number;

  /** Memory */
  jsHeapUsedMB: number;
  domNodeCount: number;

  /** Worker */
  workerPatchLatencyMs: number;

  capturedAt: number;
}

const isBrowser = typeof window !== 'undefined' && typeof performance !== 'undefined';

export class PerfMonitor {
  private longFrameObserver: PerformanceObserver | null = null;
  private jankCount = 0;

  constructor() {
    // Intentionally empty – call startLongFrameMonitoring() explicitly.
  }

  // -----------------------------------------------------------------------
  // Long-frame / jank detection
  // -----------------------------------------------------------------------

  startLongFrameMonitoring(): void {
    if (!isBrowser) return;
    if (this.longFrameObserver) return; // already running

    try {
      this.longFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > LONG_FRAME_THRESHOLD_MS) {
            this.jankCount += 1;
          }
        }
      });
      this.longFrameObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      // PerformanceObserver longtask not supported
    }
  }

  stopLongFrameMonitoring(): void {
    if (!this.longFrameObserver) return;
    try {
      this.longFrameObserver.disconnect();
    } catch {
      // ignore
    }
    this.longFrameObserver = null;
  }

  // -----------------------------------------------------------------------
  // Scroll FPS
  // -----------------------------------------------------------------------

  measureScrollFPS(durationMs: number = DEFAULT_FPS_MEASURE_MS): Promise<number> {
    return new Promise<number>((resolve) => {
      if (!isBrowser) {
        resolve(0);
        return;
      }

      let frameCount = 0;
      let running = true;

      const tick = (): void => {
        if (!running) return;
        frameCount += 1;
        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);

      setTimeout(() => {
        running = false;
        const fps = Math.round((frameCount / durationMs) * 1000);
        resolve(fps);
      }, durationMs);
    });
  }

  // -----------------------------------------------------------------------
  // Chat switch timing
  // -----------------------------------------------------------------------

  markChatSwitchStart(chatId: string): void {
    if (!isBrowser) return;
    try {
      performance.mark(`perf_chat_switch_start:${chatId}`);
    } catch {
      // ignore
    }
  }

  measureChatSwitch(chatId: string): number {
    if (!isBrowser) return 0;

    const startMark = `perf_chat_switch_start:${chatId}`;
    const endMark = `perf_chat_switch_end:${chatId}`;
    const measureName = `perf_chat_switch:${chatId}`;

    try {
      performance.mark(endMark);
      const measure = performance.measure(measureName, startMark, endMark);
      return measure.duration;
    } catch {
      return 0;
    }
  }

  // -----------------------------------------------------------------------
  // Message render timing
  // -----------------------------------------------------------------------

  markMessageRenderStart(messageId: string): void {
    if (!isBrowser) return;
    try {
      performance.mark(`perf_msg_render_start:${messageId}`);
    } catch {
      // ignore
    }
  }

  measureMessageRender(messageId: string): number {
    if (!isBrowser) return 0;

    const startMark = `perf_msg_render_start:${messageId}`;
    const endMark = `perf_msg_render_end:${messageId}`;
    const measureName = `perf_msg_render:${messageId}`;

    try {
      performance.mark(endMark);
      const measure = performance.measure(measureName, startMark, endMark);
      return measure.duration;
    } catch {
      return 0;
    }
  }

  // -----------------------------------------------------------------------
  // Jank count
  // -----------------------------------------------------------------------

  getJankCount(): number {
    return this.jankCount;
  }

  resetJankCount(): void {
    this.jankCount = 0;
  }

  // -----------------------------------------------------------------------
  // Full snapshot
  // -----------------------------------------------------------------------

  captureSnapshot(): PerformanceSnapshot {
    let jsHeapUsedMB = 0;
    let domNodeCount = 0;

    if (isBrowser) {
      try {
        const perfWithMemory = performance as PerformanceWithMemory;
        if (perfWithMemory.memory) {
          jsHeapUsedMB = Math.round(
            (perfWithMemory.memory.usedJSHeapSize / (1024 * 1024)) * 100,
          ) / 100;
        }
      } catch {
        // performance.memory not available (non-Chrome)
      }

      try {
        domNodeCount = document.querySelectorAll('*').length;
      } catch {
        // ignore
      }
    }

    return {
      chatSwitchTimeMs: this.getLatestMeasureDuration('perf_chat_switch'),
      messageRenderTimeMs: this.getLatestMeasureDuration('perf_msg_render'),
      scrollFps: 0, // populated externally via measureScrollFPS()
      jankCount: this.jankCount,
      messageSendLatencyMs: this.getLatestMeasureDuration('perf_msg_send'),
      jsHeapUsedMB,
      domNodeCount,
      workerPatchLatencyMs: this.getLatestMeasureDuration('perf_worker_patch'),
      capturedAt: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private getLatestMeasureDuration(namePrefix: string): number {
    if (!isBrowser) return 0;
    try {
      const entries = performance.getEntriesByName(namePrefix, 'measure');
      if (entries.length === 0) return 0;
      return entries[entries.length - 1].duration;
    } catch {
      return 0;
    }
  }
}

/** Shared singleton instance */
export const perfMonitor = new PerfMonitor();
