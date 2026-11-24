import { describe, expect, it } from 'vitest';
import {
  formatChatListTimestamp,
  formatMessageTimestamp,
} from '../utils/dateTime';

describe('时间显示分层格式化规范（本日 / 本周 / 非本周）', () => {
  // 2026-11-24 为周二，所在自然周为 2026-11-23（周一）至 2026-11-29（周日）
  const tuesdayNow = new Date(2026, 10, 24, 22, 50, 0, 0);

  it('会话列表时间戳：本日仅时分，本周非本日显示周几，非本周显示具体日期', () => {
    expect(formatChatListTimestamp(new Date(2026, 10, 24, 9, 5, 0), tuesdayNow)).toBe('09:05');
    expect(formatChatListTimestamp(new Date(2026, 10, 23, 18, 30, 0), tuesdayNow)).toBe('周一');
    expect(formatChatListTimestamp(new Date(2026, 10, 22, 23, 59, 0), tuesdayNow)).toBe('11/22');
    expect(formatChatListTimestamp(new Date(2025, 11, 31, 22, 27, 0), tuesdayNow)).toBe('2025/12/31');
  });

  it('周日作为参照时间时，同一自然周的周一仍显示周一而非上周日期', () => {
    // 2026-11-29 为周日
    const sundayNow = new Date(2026, 10, 29, 20, 0, 0, 0);
    expect(formatChatListTimestamp(new Date(2026, 10, 28, 12, 0, 0), sundayNow)).toBe('周六');
    expect(formatChatListTimestamp(new Date(2026, 10, 23, 0, 0, 0), sundayNow)).toBe('周一');
    expect(formatChatListTimestamp(new Date(2026, 10, 22, 23, 59, 0), sundayNow)).toBe('11/22');
  });

  it('消息气泡时间戳：本日显示 HH:mm，非本日且本周内显示周几 HH:mm，非本周显示具体日期 HH:mm', () => {
    expect(formatMessageTimestamp(new Date(2026, 10, 24, 16, 37, 0), tuesdayNow)).toBe('16:37');
    expect(formatMessageTimestamp(new Date(2026, 10, 23, 14, 8, 0), tuesdayNow)).toBe('周一 14:08');
    expect(formatMessageTimestamp(new Date(2026, 10, 22, 16, 28, 0), tuesdayNow)).toBe('11/22 16:28');
    expect(formatMessageTimestamp(new Date(2025, 3, 21, 9, 3, 0), tuesdayNow)).toBe('2025/04/21 09:03');
  });

  it('空值与非法时间安全兜底返回空字符串', () => {
    expect(formatChatListTimestamp(undefined, tuesdayNow)).toBe('');
    expect(formatMessageTimestamp('', tuesdayNow)).toBe('');
    expect(formatChatListTimestamp('not-a-valid-date', tuesdayNow)).toBe('');
    expect(formatMessageTimestamp('not-a-valid-date', tuesdayNow)).toBe('');
  });
});
