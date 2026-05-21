/**
 * AccessTracker — track user chat access patterns for predictive prefetching.
 *
 * Single responsibility: record and analyze chat access history.
 * No prefetching logic, no network calls, no state management.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccessRecord {
  chatId: string;
  timestamp: number;
  duration?: number; // ms spent in chat
}

export interface AccessStats {
  chatId: string;
  totalAccesses: number;
  lastAccessAt: number;
  avgDuration: number;
  frequency: number; // accesses per hour
  hourDistribution: number[]; // 24-element array, one per hour
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY_PER_CHAT = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Access tracker
// ---------------------------------------------------------------------------

export class AccessTracker {
  private readonly history = new Map<string, AccessRecord[]>();
  private totalAccesses = 0;

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  record(chatId: string, duration?: number): void {
    if (!chatId) return;

    let records = this.history.get(chatId);
    if (!records) {
      records = [];
      this.history.set(chatId, records);
    }

    records.push({
      chatId,
      timestamp: Date.now(),
      duration,
    });

    // Trim old records
    if (records.length > MAX_HISTORY_PER_CHAT) {
      records.splice(0, records.length - MAX_HISTORY_PER_CHAT);
    }

    this.totalAccesses += 1;
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  getStats(chatId: string): AccessStats | null {
    const records = this.history.get(chatId);
    if (!records || records.length === 0) return null;

    const now = Date.now();
    const totalAccesses = records.length;
    const lastAccessAt = records[records.length - 1].timestamp;

    // Calculate average duration
    const durations = records.filter(r => r.duration !== undefined).map(r => r.duration!);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    // Calculate frequency (accesses per hour over last 7 days)
    const weekAgo = now - 7 * DAY_MS;
    const recentRecords = records.filter(r => r.timestamp > weekAgo);
    const hoursInWeek = 7 * 24;
    const frequency = recentRecords.length / hoursInWeek;

    // Calculate hour distribution (last 30 days)
    const monthAgo = now - 30 * DAY_MS;
    const monthRecords = records.filter(r => r.timestamp > monthAgo);
    const hourDistribution = new Array(24).fill(0);
    for (const record of monthRecords) {
      const hour = new Date(record.timestamp).getHours();
      hourDistribution[hour] += 1;
    }

    return {
      chatId,
      totalAccesses,
      lastAccessAt,
      avgDuration,
      frequency,
      hourDistribution,
    };
  }

  getFrequency(chatId: string): number {
    const stats = this.getStats(chatId);
    return stats?.frequency ?? 0;
  }

  getTimePattern(chatId: string, hour: number): number {
    const stats = this.getStats(chatId);
    if (!stats) return 0;

    const total = stats.hourDistribution.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;

    return stats.hourDistribution[hour] / total;
  }

  // -------------------------------------------------------------------------
  // Top chats
  // -------------------------------------------------------------------------

  getTopChats(limit: number = 10): string[] {
    const entries: Array<{ chatId: string; score: number }> = [];

    for (const [chatId, records] of this.history.entries()) {
      if (records.length === 0) continue;

      const now = Date.now();
      const lastAccess = records[records.length - 1].timestamp;
      const recency = 1 / (1 + (now - lastAccess) / HOUR_MS);
      const frequency = records.length;
      const score = recency * frequency;

      entries.push({ chatId, score });
    }

    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, limit).map(e => e.chatId);
  }

  getRecentlyAccessed(limit: number = 10): string[] {
    const entries: Array<{ chatId: string; lastAccess: number }> = [];

    for (const [chatId, records] of this.history.entries()) {
      if (records.length === 0) continue;
      entries.push({
        chatId,
        lastAccess: records[records.length - 1].timestamp,
      });
    }

    entries.sort((a, b) => b.lastAccess - a.lastAccess);
    return entries.slice(0, limit).map(e => e.chatId);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  clear(chatId?: string): void {
    if (chatId) {
      this.history.delete(chatId);
    } else {
      this.history.clear();
    }
  }

  prune(maxAgeMs: number = 30 * DAY_MS): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [chatId, records] of this.history.entries()) {
      const before = records.length;
      const filtered = records.filter(r => r.timestamp > cutoff);
      if (filtered.length < before) {
        this.history.set(chatId, filtered);
        pruned += before - filtered.length;
      }
    }

    return pruned;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  serialize(): Record<string, AccessRecord[]> {
    const result: Record<string, AccessRecord[]> = {};
    for (const [chatId, records] of this.history.entries()) {
      result[chatId] = [...records];
    }
    return result;
  }

  deserialize(data: Record<string, AccessRecord[]>): void {
    this.history.clear();
    for (const [chatId, records] of Object.entries(data)) {
      if (Array.isArray(records)) {
        this.history.set(chatId, records.filter(r => r && typeof r.timestamp === 'number'));
      }
    }
  }
}
