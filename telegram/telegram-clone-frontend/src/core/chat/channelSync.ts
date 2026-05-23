/**
 * ChannelSync — per-channel pts management for independent sync.
 *
 * Single responsibility: manage per-channel sequence numbers and gap detection.
 * No socket, no persistence, no message processing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelSyncState {
  chatId: string;
  pts: number;
  lastUpdatedAt: number;
}

export interface ChannelGapInfo {
  chatId: string;
  expectedPts: number;
  receivedPts: number;
  gapSize: number;
}

export interface ChannelSyncStats {
  totalChannels: number;
  channelsWithGaps: number;
  avgPts: number;
  maxPts: number;
}

// ---------------------------------------------------------------------------
// Channel sync manager
// ---------------------------------------------------------------------------

export class ChannelSyncManager {
  private readonly channelPts = new Map<string, ChannelSyncState>();
  private globalPts = 0;

  // -------------------------------------------------------------------------
  // Global pts
  // -------------------------------------------------------------------------

  getGlobalPts(): number {
    return this.globalPts;
  }

  setGlobalPts(pts: number): void {
    if (pts > this.globalPts) {
      this.globalPts = pts;
    }
  }

  // -------------------------------------------------------------------------
  // Per-channel pts
  // -------------------------------------------------------------------------

  getChannelPts(chatId: string): number {
    return this.channelPts.get(chatId)?.pts ?? 0;
  }

  setChannelPts(chatId: string, pts: number): void {
    const existing = this.channelPts.get(chatId);
    if (existing) {
      if (pts > existing.pts) {
        existing.pts = pts;
        existing.lastUpdatedAt = Date.now();
      }
    } else {
      this.channelPts.set(chatId, {
        chatId,
        pts,
        lastUpdatedAt: Date.now(),
      });
    }
  }

  hasChannel(chatId: string): boolean {
    return this.channelPts.has(chatId);
  }

  removeChannel(chatId: string): boolean {
    return this.channelPts.delete(chatId);
  }

  clearChannels(): void {
    this.channelPts.clear();
  }

  getChannelCount(): number {
    return this.channelPts.size;
  }

  getAllPts(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [chatId, state] of this.channelPts) {
      result.set(chatId, state.pts);
    }
    return result;
  }
  }

  // -------------------------------------------------------------------------
  // Gap detection
  // -------------------------------------------------------------------------

  detectGap(chatId: string, receivedPts: number): ChannelGapInfo | null {
    const lastKnownPts = this.getChannelPts(chatId);
    const expectedPts = lastKnownPts + 1;
    const gapSize = receivedPts - expectedPts;

    if (gapSize <= 0) {
      // Contiguous (gapSize === 0) or duplicate/stale (gapSize < 0)
      return null;
    }

    return {
      chatId,
      expectedPts,
      receivedPts,
      gapSize,
    };
  }

  // -------------------------------------------------------------------------
  // Batch operations
  // -------------------------------------------------------------------------

  updateFromSyncResponse(
    updates: Array<{ chatId?: string; pts?: number }>,
    globalPts: number,
  ): { updatedChannels: string[]; gaps: ChannelGapInfo[] } {
    const updatedChannels: string[] = [];
    const gaps: ChannelGapInfo[] = [];

    // Update global pts
    this.setGlobalPts(globalPts);

    // Update per-channel pts
    for (const update of updates) {
      if (!update.chatId || typeof update.pts !== 'number') continue;

      const gap = this.detectGap(update.chatId, update.pts);
      if (gap) {
        gaps.push(gap);
      }

      this.setChannelPts(update.chatId, update.pts);
      updatedChannels.push(update.chatId);
    }

    return { updatedChannels, gaps };
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): ChannelSyncStats {
    let totalPts = 0;
    let maxPts = 0;
    let channelsWithGaps = 0;

    for (const state of this.channelPts.values()) {
      totalPts += state.pts;
      if (state.pts > maxPts) maxPts = state.pts;
    }

    return {
      totalChannels: this.channelPts.size,
      channelsWithGaps,
      avgPts: this.channelPts.size > 0 ? totalPts / this.channelPts.size : 0,
      maxPts,
    };
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  serialize(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [chatId, state] of this.channelPts.entries()) {
      result[chatId] = state.pts;
    }
    return result;
  }

  deserialize(data: Record<string, number>): void {
    this.channelPts.clear();
    for (const [chatId, pts] of Object.entries(data)) {
      if (typeof pts === 'number' && Number.isFinite(pts)) {
        this.setChannelPts(chatId, pts);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Iteration
  // -------------------------------------------------------------------------

  *entries(): IterableIterator<[string, number]> {
    for (const [chatId, state] of this.channelPts.entries()) {
      yield [chatId, state.pts];
    }
  }

  *chatIds(): IterableIterator<string> {
    yield* this.channelPts.keys();
  }
}
