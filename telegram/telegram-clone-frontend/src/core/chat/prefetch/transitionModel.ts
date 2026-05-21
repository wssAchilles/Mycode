/**
 * TransitionModel — Markov chain model for chat transition prediction.
 *
 * Single responsibility: compute transition probabilities between chats.
 * No prefetching logic, no network calls, no access tracking.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitionProbability {
  from: string;
  to: string;
  probability: number;
  count: number;
}

export interface PredictionResult {
  chatId: string;
  probability: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TRANSITIONS_PER_SOURCE = 50;
const DECAY_FACTOR = 0.95; // Decay older transitions

// ---------------------------------------------------------------------------
// Transition model
// ---------------------------------------------------------------------------

export class TransitionModel {
  private readonly transitions = new Map<string, Map<string, number>>();
  private readonly totalFrom = new Map<string, number>();
  private lastChatId: string | null = null;

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  recordTransition(from: string, to: string): void {
    if (!from || !to || from === to) return;

    let toMap = this.transitions.get(from);
    if (!toMap) {
      toMap = new Map();
      this.transitions.set(from, toMap);
    }

    const currentCount = toMap.get(to) ?? 0;
    toMap.set(to, currentCount + 1);

    const currentTotal = this.totalFrom.get(from) ?? 0;
    this.totalFrom.set(from, currentTotal + 1);

    // Trim if too many transitions
    if (toMap.size > MAX_TRANSITIONS_PER_SOURCE) {
      let minCount = Infinity;
      let minKey = '';
      for (const [key, count] of toMap.entries()) {
        if (count < minCount) {
          minCount = count;
          minKey = key;
        }
      }
      if (minKey) {
        toMap.delete(minKey);
        this.totalFrom.set(from, (this.totalFrom.get(from) ?? 0) - minCount);
      }
    }
  }

  recordAccess(chatId: string): void {
    if (this.lastChatId && this.lastChatId !== chatId) {
      this.recordTransition(this.lastChatId, chatId);
    }
    this.lastChatId = chatId;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  getTransitionProbability(from: string, to: string): number {
    const toMap = this.transitions.get(from);
    if (!toMap) return 0;

    const count = toMap.get(to) ?? 0;
    const total = this.totalFrom.get(from) ?? 0;

    return total > 0 ? count / total : 0;
  }

  getTransitionCount(from: string, to: string): number {
    return this.transitions.get(from)?.get(to) ?? 0;
  }

  // -------------------------------------------------------------------------
  // Prediction
  // -------------------------------------------------------------------------

  predictNext(current: string, count: number = 3): PredictionResult[] {
    const toMap = this.transitions.get(current);
    if (!toMap || toMap.size === 0) return [];

    const total = this.totalFrom.get(current) ?? 0;
    if (total === 0) return [];

    const predictions: PredictionResult[] = [];
    for (const [chatId, transitionCount] of toMap.entries()) {
      predictions.push({
        chatId,
        probability: transitionCount / total,
      });
    }

    predictions.sort((a, b) => b.probability - a.probability);
    return predictions.slice(0, count);
  }

  predictNextWithHistory(recentChats: string[], count: number = 3): PredictionResult[] {
    if (recentChats.length === 0) return [];

    // Use weighted average of predictions from recent chats
    const predictions = new Map<string, number>();
    const weights = [1.0, 0.7, 0.5, 0.3, 0.2]; // Weight by recency

    for (let i = 0; i < Math.min(recentChats.length, weights.length); i++) {
      const chatId = recentChats[recentChats.length - 1 - i];
      const weight = weights[i];
      const chatPredictions = this.predictNext(chatId, 10);

      for (const pred of chatPredictions) {
        const current = predictions.get(pred.chatId) ?? 0;
        predictions.set(pred.chatId, current + pred.probability * weight);
      }
    }

    // Normalize and sort
    const totalWeight = weights.slice(0, Math.min(recentChats.length, weights.length)).reduce((a, b) => a + b, 0);
    const results: PredictionResult[] = [];
    for (const [chatId, score] of predictions.entries()) {
      results.push({
        chatId,
        probability: score / totalWeight,
      });
    }

    results.sort((a, b) => b.probability - a.probability);
    return results.slice(0, count);
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  getTransitionCountFrom(from: string): number {
    return this.totalFrom.get(from) ?? 0;
  }

  getUniqueTargets(from: string): number {
    return this.transitions.get(from)?.size ?? 0;
  }

  getTotalTransitions(): number {
    let total = 0;
    for (const count of this.totalFrom.values()) {
      total += count;
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Decay
  // -------------------------------------------------------------------------

  applyDecay(): void {
    for (const [from, toMap] of this.transitions.entries()) {
      let total = 0;
      for (const [to, count] of toMap.entries()) {
        const decayed = Math.floor(count * DECAY_FACTOR);
        if (decayed > 0) {
          toMap.set(to, decayed);
          total += decayed;
        } else {
          toMap.delete(to);
        }
      }
      this.totalFrom.set(from, total);
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  clear(): void {
    this.transitions.clear();
    this.totalFrom.clear();
    this.lastChatId = null;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  serialize(): { transitions: Record<string, Record<string, number>>; lastChatId: string | null } {
    const transitions: Record<string, Record<string, number>> = {};
    for (const [from, toMap] of this.transitions.entries()) {
      transitions[from] = {};
      for (const [to, count] of toMap.entries()) {
        transitions[from][to] = count;
      }
    }
    return { transitions, lastChatId: this.lastChatId };
  }

  deserialize(data: { transitions?: Record<string, Record<string, number>>; lastChatId?: string | null }): void {
    this.transitions.clear();
    this.totalFrom.clear();

    if (data.transitions) {
      for (const [from, toMap] of Object.entries(data.transitions)) {
        const map = new Map<string, number>();
        let total = 0;
        for (const [to, count] of Object.entries(toMap)) {
          if (typeof count === 'number' && count > 0) {
            map.set(to, count);
            total += count;
          }
        }
        if (map.size > 0) {
          this.transitions.set(from, map);
          this.totalFrom.set(from, total);
        }
      }
    }

    this.lastChatId = data.lastChatId ?? null;
  }
}
