/**
 * PrefetchManager - Centralised chat prefetch orchestrator.
 *
 * Extracts and extends the inline prefetch logic from messageStore
 * (prefetchInFlight / prefetchLastAt / PREFETCH_COOLDOWN_MS) into a
 * testable, reusable module with viewport, idle, and predictive modes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrefetchConfig {
  /** Maximum number of concurrent in-flight prefetch requests. */
  maxConcurrent: number;
  /** Minimum ms between prefetches for the same chatId. */
  cooldownMs: number;
  /** Number of extra chats to prefetch above/below the visible viewport. */
  viewportBuffer: number;
  /** How many top chats to prefetch during idle windows. */
  idlePrefetchCount: number;
}

interface PrefetchEntry {
  chatId: string;
  lastPrefetchedAt: number;
  inFlight: boolean;
}

interface SwitchEdge {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Defaults (match existing messageStore constants)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PrefetchConfig = {
  maxConcurrent: 3,
  cooldownMs: 10_000,
  viewportBuffer: 2,
  idlePrefetchCount: 5,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Schedule a callback during the next idle period (or after a timeout). */
function scheduleIdle(callback: () => void, timeoutMs = 1_000): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => callback(), { timeout: timeoutMs });
  } else {
    setTimeout(callback, timeoutMs);
  }
}

/** Yield to the browser for one frame so we don't block the main thread. */
function yieldToFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// ---------------------------------------------------------------------------
// PrefetchManager
// ---------------------------------------------------------------------------

export class PrefetchManager {
  private entries: Map<string, PrefetchEntry> = new Map();
  private queue: string[] = [];
  private processing = false;
  private config: PrefetchConfig;
  private prefetchFn: (chatId: string) => Promise<void>;

  // Predictive prefetch state: recent switch edges (most recent last).
  private switchHistory: SwitchEdge[] = [];
  private static readonly MAX_SWITCH_HISTORY = 50;

  constructor(
    prefetchFn: (chatId: string) => Promise<void>,
    config?: Partial<PrefetchConfig>,
  ) {
    this.prefetchFn = prefetchFn;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Hover-triggered prefetch (mirrors existing messageStore behaviour).
   * Enqueues the chatId if eligible; the queue processes asynchronously.
   */
  onHover(chatId: string): void {
    this.enqueue(chatId);
  }

  /**
   * Viewport-based prefetch: ensures the visible chats plus a configurable
   * buffer above and below are prefetched.
   *
   * @param visibleChatIds - Chat IDs currently visible in the viewport.
   * @param allChatIds     - Full ordered list of chat IDs (sidebar order).
   */
  onViewportChange(visibleChatIds: string[], allChatIds: string[]): void {
    if (!visibleChatIds.length || !allChatIds.length) return;

    const allIndex = new Map<string, number>();
    for (let i = 0; i < allChatIds.length; i++) {
      allIndex.set(allChatIds[i], i);
    }

    const toPrefetch = new Set<string>();

    for (const visibleId of visibleChatIds) {
      const idx = allIndex.get(visibleId);
      if (idx === undefined) continue;

      const buffer = this.config.viewportBuffer;
      const start = Math.max(0, idx - buffer);
      const end = Math.min(allChatIds.length - 1, idx + buffer);

      for (let i = start; i <= end; i++) {
        toPrefetch.add(allChatIds[i]);
      }
    }

    for (const chatId of toPrefetch) {
      this.enqueue(chatId);
    }
  }

  /**
   * Schedule idle prefetches for the top-N chats (by sidebar order).
   * The actual prefetching is deferred to an idle callback.
   */
  scheduleIdlePrefetch(topChatIds: string[]): void {
    const count = Math.min(topChatIds.length, this.config.idlePrefetchCount);
    const targets = topChatIds.slice(0, count);

    scheduleIdle(() => {
      for (const chatId of targets) {
        this.enqueue(chatId);
      }
    });
  }

  /**
   * Record a chat switch for predictive prefetch tracking.
   */
  recordSwitch(fromChatId: string, toChatId: string): void {
    if (!fromChatId || !toChatId || fromChatId === toChatId) return;

    this.switchHistory.push({ from: fromChatId, to: toChatId });

    if (this.switchHistory.length > PrefetchManager.MAX_SWITCH_HISTORY) {
      this.switchHistory = this.switchHistory.slice(
        -PrefetchManager.MAX_SWITCH_HISTORY,
      );
    }
  }

  /**
   * Predict the next chat(s) the user is likely to switch to based on
   * recent switch patterns from `currentChatId`.
   *
   * Returns chatIds ordered by frequency (most likely first), capped
   * at `maxConcurrent` entries.
   */
  predictNext(currentChatId: string): string[] {
    if (!currentChatId || !this.switchHistory.length) return [];

    const frequency = new Map<string, number>();

    for (const edge of this.switchHistory) {
      if (edge.from === currentChatId) {
        frequency.set(edge.to, (frequency.get(edge.to) ?? 0) + 1);
      }
    }

    return [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.maxConcurrent)
      .map(([chatId]) => chatId);
  }

  /** Check whether a prefetch is currently in-flight for `chatId`. */
  isInFlight(chatId: string): boolean {
    return this.getEntry(chatId).inFlight;
  }

  /** Timestamp of the last completed prefetch for `chatId`, or null. */
  getLastPrefetched(chatId: string): number | null {
    const entry = this.entries.get(chatId);
    return entry ? entry.lastPrefetchedAt : null;
  }

  /** Number of chatIds waiting in the queue (not yet in-flight). */
  getQueueSize(): number {
    return this.queue.length;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private getEntry(chatId: string): PrefetchEntry {
    let entry = this.entries.get(chatId);
    if (!entry) {
      entry = { chatId, lastPrefetchedAt: 0, inFlight: false };
      this.entries.set(chatId, entry);
    }
    return entry;
  }

  private isEligible(chatId: string): boolean {
    const entry = this.getEntry(chatId);
    if (entry.inFlight) return false;

    const now = Date.now();
    if (now - entry.lastPrefetchedAt < this.config.cooldownMs) return false;

    return true;
  }

  private currentInFlightCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.inFlight) count++;
    }
    return count;
  }

  /**
   * Enqueue a chatId for prefetch if it passes dedup + cooldown checks.
   * If already in the queue, it is not added again.
   */
  private enqueue(chatId: string): void {
    if (!chatId) return;
    if (!this.isEligible(chatId)) return;
    if (this.queue.includes(chatId)) return;

    this.queue.push(chatId);
    this.drainQueue();
  }

  /**
   * Process the queue, respecting the concurrency cap and yielding
   * between requests so we don't block the main thread.
   */
  private drainQueue(): void {
    if (this.processing) return;
    this.processing = true;

    void (async () => {
      try {
        while (this.queue.length > 0) {
          // Respect concurrency limit.
          if (this.currentInFlightCount() >= this.config.maxConcurrent) {
            await yieldToFrame();
            continue;
          }

          // Pop the next eligible chatId (skip any that became ineligible
          // while waiting in the queue).
          const chatId = this.dequeue();
          if (!chatId) break;

          // Yield to the browser between prefetches.
          await yieldToFrame();

          const entry = this.getEntry(chatId);
          entry.inFlight = true;

          try {
            await this.prefetchFn(chatId);
            entry.lastPrefetchedAt = Date.now();
          } catch {
            // Swallow prefetch errors; they are non-critical.
          } finally {
            entry.inFlight = false;
          }
        }
      } finally {
        this.processing = false;
      }
    })();
  }

  /**
   * Pop the next eligible chatId from the front of the queue.
   * Skips entries that became ineligible (e.g. prefetched via another path).
   */
  private dequeue(): string | undefined {
    while (this.queue.length > 0) {
      const chatId = this.queue.shift()!;
      if (this.isEligible(chatId)) {
        return chatId;
      }
    }
    return undefined;
  }
}
