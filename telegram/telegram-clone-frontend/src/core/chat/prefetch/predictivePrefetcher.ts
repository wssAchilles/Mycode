/**
 * PredictivePrefetcher — predict and prefetch chat data based on user patterns.
 *
 * Single responsibility: orchestrate predictive prefetching using access tracking
 * and transition models. No direct network calls, no state management.
 */

import { AccessTracker, type AccessRecord } from './accessTracker';
import { TransitionModel, type PredictionResult } from './transitionModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrefetchTarget {
  chatId: string;
  probability: number;
  reason: string;
}

export interface PrefetcherConfig {
  maxPrefetchCount: number;
  minProbability: number;
  cooldownMs: number;
  enableTimePatterns: boolean;
}

export interface PrefetcherContext {
  prefetchChat: (chatId: string) => Promise<void>;
  isChatLoaded: (chatId: string) => boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PrefetcherConfig = {
  maxPrefetchCount: 3,
  minProbability: 0.1,
  cooldownMs: 30_000,
  enableTimePatterns: true,
};

// ---------------------------------------------------------------------------
// Predictive prefetcher
// ---------------------------------------------------------------------------

export class PredictivePrefetcher {
  private readonly accessTracker: AccessTracker;
  private readonly transitionModel: TransitionModel;
  private readonly config: PrefetcherConfig;
  private readonly prefetchedAt = new Map<string, number>();
  private recentChats: string[] = [];
  private readonly maxRecentChats = 10;

  constructor(config: Partial<PrefetcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.accessTracker = new AccessTracker();
    this.transitionModel = new TransitionModel();
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  recordAccess(chatId: string, duration?: number): void {
    if (!chatId) return;

    this.accessTracker.record(chatId, duration);
    this.transitionModel.recordAccess(chatId);

    // Update recent chats
    this.recentChats = this.recentChats.filter(id => id !== chatId);
    this.recentChats.push(chatId);
    if (this.recentChats.length > this.maxRecentChats) {
      this.recentChats.shift();
    }
  }

  // -------------------------------------------------------------------------
  // Prediction
  // -------------------------------------------------------------------------

  predictPrefetchTargets(currentChatId: string): PrefetchTarget[] {
    const targets: PrefetchTarget[] = [];
    const now = Date.now();

    // Get transition-based predictions
    const transitionPredictions = this.transitionModel.predictNextWithHistory(
      this.recentChats,
      this.config.maxPrefetchCount * 2
    );

    for (const pred of transitionPredictions) {
      if (pred.chatId === currentChatId) continue;
      if (pred.probability < this.config.minProbability) continue;
      if (this.isCooldown(pred.chatId, now)) continue;

      targets.push({
        chatId: pred.chatId,
        probability: pred.probability,
        reason: 'transition',
      });
    }

    // Add time-pattern predictions if enabled
    if (this.config.enableTimePatterns) {
      const hour = new Date().getHours();
      const topChats = this.accessTracker.getTopChats(5);

      for (const chatId of topChats) {
        if (chatId === currentChatId) continue;
        if (targets.some(t => t.chatId === chatId)) continue;
        if (this.isCooldown(chatId, now)) continue;

        const timePattern = this.accessTracker.getTimePattern(chatId, hour);
        if (timePattern > 0.05) { // 5% threshold
          targets.push({
            chatId,
            probability: timePattern,
            reason: 'time_pattern',
          });
        }
      }
    }

    // Sort by probability and limit
    targets.sort((a, b) => b.probability - a.probability);
    return targets.slice(0, this.config.maxPrefetchCount);
  }

  // -------------------------------------------------------------------------
  // Prefetch execution
  // -------------------------------------------------------------------------

  async prefetchFor(currentChatId: string, ctx: PrefetcherContext): Promise<string[]> {
    const targets = this.predictPrefetchTargets(currentChatId);
    const prefetched: string[] = [];
    const now = Date.now();

    for (const target of targets) {
      if (ctx.isChatLoaded(target.chatId)) continue;

      try {
        await ctx.prefetchChat(target.chatId);
        this.prefetchedAt.set(target.chatId, now);
        prefetched.push(target.chatId);
      } catch {
        // Ignore prefetch failures
      }
    }

    return prefetched;
  }

  // -------------------------------------------------------------------------
  // Cooldown
  // -------------------------------------------------------------------------

  private isCooldown(chatId: string, now: number): boolean {
    const lastPrefetch = this.prefetchedAt.get(chatId);
    if (!lastPrefetch) return false;
    return now - lastPrefetch < this.config.cooldownMs;
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  getStats(): {
    totalAccesses: number;
    totalTransitions: number;
    recentChats: string[];
    prefetchedCount: number;
  } {
    return {
      totalAccesses: this.accessTracker.getTopChats(100).length,
      totalTransitions: this.transitionModel.getTotalTransitions(),
      recentChats: [...this.recentChats],
      prefetchedCount: this.prefetchedAt.size,
    };
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  clear(): void {
    this.accessTracker.clear();
    this.transitionModel.clear();
    this.prefetchedAt.clear();
    this.recentChats = [];
  }

  prune(maxAgeMs: number): void {
    this.accessTracker.prune(maxAgeMs);

    const cutoff = Date.now() - maxAgeMs;
    for (const [chatId, timestamp] of this.prefetchedAt.entries()) {
      if (timestamp < cutoff) {
        this.prefetchedAt.delete(chatId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  serialize(): {
    accessHistory: Record<string, AccessRecord[]>;
    transitions: { transitions: Record<string, Record<string, number>>; lastChatId: string | null };
    recentChats: string[];
  } {
    return {
      accessHistory: this.accessTracker.serialize(),
      transitions: this.transitionModel.serialize(),
      recentChats: [...this.recentChats],
    };
  }

  deserialize(data: {
    accessHistory?: Record<string, AccessRecord[]>;
    transitions?: { transitions?: Record<string, Record<string, number>>; lastChatId?: string | null };
    recentChats?: string[];
  }): void {
    if (data.accessHistory) {
      this.accessTracker.deserialize(data.accessHistory);
    }
    if (data.transitions) {
      this.transitionModel.deserialize(data.transitions);
    }
    if (data.recentChats) {
      this.recentChats = data.recentChats.slice(-this.maxRecentChats);
    }
  }
}
