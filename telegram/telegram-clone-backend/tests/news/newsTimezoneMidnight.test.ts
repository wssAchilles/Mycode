import { describe, expect, it } from 'vitest';
import { getTimeZoneParts, getZonedTodayRange } from '../../src/services/newsService';

describe('newsService timezone midnight h23 boundary', () => {
  it('formats Asia/Shanghai midnight as hour 0 instead of 24', () => {
    // 2026-11-16T16:00:00.000Z 恰好为东八区 2026-11-17 00:00:00
    const parts = getTimeZoneParts(new Date('2026-11-16T16:00:00.000Z'), 'Asia/Shanghai');

    expect(parts).toEqual({
      year: 2026,
      month: 11,
      day: 17,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it('computes accurate today UTC bounds for Asia/Shanghai without -24h drift', () => {
    const range = getZonedTodayRange(new Date('2026-11-17T09:22:00.000Z'), 'Asia/Shanghai');

    expect(range.key).toBe('2026-11-17');
    expect(range.start.toISOString()).toBe('2026-11-16T16:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-17T16:00:00.000Z');
  });

  it('switches day key cleanly across the Asia/Shanghai midnight boundary', () => {
    const beforeMidnight = getZonedTodayRange(new Date('2026-11-16T15:59:59.000Z'), 'Asia/Shanghai');
    const atMidnight = getZonedTodayRange(new Date('2026-11-16T16:00:00.000Z'), 'Asia/Shanghai');

    expect(beforeMidnight.key).toBe('2026-11-16');
    expect(beforeMidnight.start.toISOString()).toBe('2026-11-15T16:00:00.000Z');
    expect(beforeMidnight.end.toISOString()).toBe('2026-11-16T16:00:00.000Z');

    expect(atMidnight.key).toBe('2026-11-17');
    expect(atMidnight.start.toISOString()).toBe('2026-11-16T16:00:00.000Z');
    expect(atMidnight.end.toISOString()).toBe('2026-11-17T16:00:00.000Z');
  });
});
