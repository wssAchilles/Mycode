/**
 * Gap recovery utilities for the chat sync layer.
 *
 * The sync protocol uses monotonically increasing sequence numbers (pts/updateId).
 * When a received seq doesn't match the expected next seq, a gap exists and must
 * be recovered.  This module produces machine-readable recovery plans that the
 * sync loop can execute.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GapInfo {
  /** The chat whose seq stream has a hole. */
  chatId: string;
  /** The next seq we expected to see (lastKnownSeq + 1). */
  expectedSeq: number;
  /** The seq we actually received instead. */
  receivedSeq: number;
  /** How many seq values are missing: receivedSeq - expectedSeq. */
  gapSize: number;
}

export interface ChannelGapInfo {
  chatId: string;
  expectedPts: number;
  receivedPts: number;
  gapSize: number;
}

export interface RecoveryPlan {
  /** 'fetch_range' = fill the hole; 'reset' = discard local state and reload latest. */
  action: 'fetch_range' | 'reset';
  chatId: string;
  /** Inclusive lower bound for a range fetch (only set when action === 'fetch_range'). */
  fromSeq?: number;
  /** Inclusive upper bound for a range fetch (only set when action === 'fetch_range'). */
  toSeq?: number;
  /** Human-readable explanation of why this plan was chosen. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gaps at or above this size trigger a full reset instead of a range fetch. */
const GAP_RESET_THRESHOLD = 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect a gap in a per-chat seq stream.
 *
 * Returns a `GapInfo` when `receivedSeq` is ahead of `lastKnownSeq + 1`,
 * meaning at least one intermediate seq was never delivered.
 * Returns `null` when there is no gap (contiguous or duplicate/stale seq).
 *
 * @param chatId      - The chat being inspected.
 * @param lastKnownSeq - The highest seq we have already processed for this chat.
 * @param receivedSeq  - The seq of the update that just arrived.
 */
export function detectGap(
  chatId: string,
  lastKnownSeq: number,
  receivedSeq: number,
): GapInfo | null {
  const expectedSeq = lastKnownSeq + 1;
  const gapSize = receivedSeq - expectedSeq;

  if (gapSize <= 0) {
    // Contiguous (gapSize === 0) or duplicate / stale (gapSize < 0).
    return null;
  }

  return { chatId, expectedSeq, receivedSeq, gapSize };
}

/**
 * Turn a detected gap into a machine-readable recovery plan.
 *
 * Decision logic:
 * - gap < 1000  -->  'fetch_range' (fetch the missing seq window)
 * - gap >= 1000 -->  'reset' (clear local state and reload the latest page)
 *
 * @param gap - The gap info produced by `detectGap`.
 */
export function planRecovery(gap: GapInfo): RecoveryPlan {
  if (gap.gapSize >= GAP_RESET_THRESHOLD) {
    return {
      action: 'reset',
      chatId: gap.chatId,
      reason: `Gap of ${gap.gapSize} exceeds reset threshold (${GAP_RESET_THRESHOLD}); discarding local state and reloading latest.`,
    };
  }

  return {
    action: 'fetch_range',
    chatId: gap.chatId,
    // fromSeq is the first missing seq; toSeq is the seq just before the one we received.
    fromSeq: gap.expectedSeq,
    toSeq: gap.receivedSeq - 1,
    reason: `Fetching missing seq range [${gap.expectedSeq}, ${gap.receivedSeq - 1}] (${gap.gapSize} values).`,
  };
}

/**
 * Build the API URL that fetches messages in a specific seq range for a chat.
 *
 * The caller is responsible for appending auth headers and making the request.
 *
 * @param chatId  - The chat to fetch from.
 * @param fromSeq - Inclusive lower seq bound.
 * @param toSeq   - Inclusive upper seq bound.
 */
export function buildGapFetchUrl(chatId: string, fromSeq: number, toSeq: number): string {
  const params = new URLSearchParams({
    chatId,
    fromSeq: String(fromSeq),
    toSeq: String(toSeq),
  });
  return `/api/messages/range?${params.toString()}`;
}

/**
 * Detect a gap in a per-channel pts stream.
 *
 * Returns a `ChannelGapInfo` when `receivedPts` is ahead of `lastKnownPts + 1`,
 * meaning at least one intermediate pts was never delivered.
 * Returns `null` when there is no gap (contiguous or duplicate/stale pts).
 *
 * @param chatId       - The channel being inspected.
 * @param lastKnownPts - The highest pts we have already processed for this channel.
 * @param receivedPts  - The pts of the update that just arrived.
 */
export function detectChannelGap(
  chatId: string,
  lastKnownPts: number,
  receivedPts: number,
): ChannelGapInfo | null {
  const expectedPts = lastKnownPts + 1;
  const gapSize = receivedPts - expectedPts;

  if (gapSize <= 0) {
    // Contiguous (gapSize === 0) or duplicate / stale (gapSize < 0).
    return null;
  }

  return { chatId, expectedPts, receivedPts, gapSize };
}
