import type { ChatSummary } from '../../features/chat/types';

export interface SlidingWindowConfig {
  /** Number of items visible in the viewport at once. */
  windowSize: number;
  /** Extra items rendered above and below the visible window. */
  bufferSize: number;
  /** Additional overscan count passed to the virtualizer. */
  overscanCount: number;
}

export interface SlidingWindowState {
  /** First index in the rendered window (including buffer). */
  startIndex: number;
  /** Last index in the rendered window (inclusive, including buffer). */
  endIndex: number;
  /** The subset of chats to render. */
  visibleChats: ChatSummary[];
  /** Total number of chats in the full list. */
  totalCount: number;
  /** Whether more chats exist beyond the current window. */
  hasMore: boolean;
}

const DEFAULT_CONFIG: SlidingWindowConfig = {
  windowSize: 30,
  bufferSize: 10,
  overscanCount: 5,
};

/**
 * Pure function that calculates which chats should be rendered
 * based on scroll position, item height, and viewport dimensions.
 *
 * Returns only the visible + buffered subset of the full chat list.
 */
export function createSlidingWindow(
  allChats: ChatSummary[],
  scrollTop: number,
  itemHeight: number,
  viewportHeight: number,
  config?: Partial<SlidingWindowConfig>,
): SlidingWindowState {
  const resolved: SlidingWindowConfig = { ...DEFAULT_CONFIG, ...config };
  const totalCount = allChats.length;

  if (totalCount === 0 || itemHeight <= 0 || viewportHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      visibleChats: [],
      totalCount,
      hasMore: false,
    };
  }

  // Calculate the range of items that are physically visible in the viewport.
  const visibleStartIndex = Math.floor(scrollTop / itemHeight);
  const visibleEndIndex = Math.min(
    totalCount - 1,
    Math.floor((scrollTop + viewportHeight) / itemHeight),
  );

  // Expand by buffer on both sides so off-screen items are pre-rendered.
  const bufferedStart = Math.max(0, visibleStartIndex - resolved.bufferSize);
  const bufferedEnd = Math.min(totalCount - 1, visibleEndIndex + resolved.bufferSize);

  // Ensure we always render at least windowSize items (centered around the visible range)
  // when the list is large enough. This prevents tiny windows on very short viewports.
  const minWindowSize = resolved.windowSize;
  const currentWindowSize = bufferedEnd - bufferedStart + 1;

  let startIndex = bufferedStart;
  let endIndex = bufferedEnd;

  if (currentWindowSize < minWindowSize && totalCount >= minWindowSize) {
    // Expand the window to meet the minimum, preferring to keep the start stable.
    const deficit = minWindowSize - currentWindowSize;
    const canExpandStart = startIndex;
    const canExpandEnd = totalCount - 1 - endIndex;
    const expandStart = Math.min(canExpandStart, Math.ceil(deficit / 2));
    const expandEnd = Math.min(canExpandEnd, deficit - expandStart);

    startIndex = startIndex - expandStart;
    endIndex = endIndex + expandEnd;

    // If we still have room, absorb remaining deficit on the other side.
    if (endIndex - startIndex + 1 < minWindowSize) {
      const remaining = minWindowSize - (endIndex - startIndex + 1);
      if (startIndex > 0) {
        startIndex = Math.max(0, startIndex - remaining);
      } else {
        endIndex = Math.min(totalCount - 1, endIndex + remaining);
      }
    }
  }

  // Clamp to valid bounds.
  startIndex = Math.max(0, startIndex);
  endIndex = Math.min(totalCount - 1, endIndex);

  const visibleChats = allChats.slice(startIndex, endIndex + 1);

  return {
    startIndex,
    endIndex,
    visibleChats,
    totalCount,
    hasMore: endIndex < totalCount - 1,
  };
}

/**
 * Returns the default configuration. Useful when consumers need to
 * read or override individual fields without importing the constant.
 */
export function getDefaultConfig(): Readonly<SlidingWindowConfig> {
  return DEFAULT_CONFIG;
}
