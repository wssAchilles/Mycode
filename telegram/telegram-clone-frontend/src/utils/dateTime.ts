/**
 * 统一时间格式化工具
 * 规则：
 * - 本日：仅显示具体时分（HH:mm）
 * - 非本日且本周内（自然周：周一至周日）：显示周几（列表显示「周X」，气泡/详情附加具体时分「周X HH:mm」）
 * - 非本周：显示具体日期（同年「MM/DD」，跨年「YYYY/MM/DD」；气泡/详情附加具体时分）
 */

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function toValidDate(timestamp: string | number | Date | undefined): Date | null {
  if (timestamp === undefined || timestamp === null || timestamp === '') return null;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatHourMinute(date: Date): string {
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

/**
 * 判断目标时间是否落在参照时间所在的自然周（周一 00:00:00 至下周一 00:00:00 前）
 */
function isWithinCurrentWeek(target: Date, now: Date): boolean {
  const daysSinceMonday = (now.getDay() + 6) % 7;
  const startOfWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysSinceMonday,
    0,
    0,
    0,
    0,
  );
  const startOfNextWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysSinceMonday + 7,
    0,
    0,
    0,
    0,
  );
  const targetMs = target.getTime();
  return targetMs >= startOfWeek.getTime() && targetMs < startOfNextWeek.getTime();
}

function formatAbsoluteDate(date: Date, now: Date): string {
  const monthDay = `${padDatePart(date.getMonth() + 1)}/${padDatePart(date.getDate())}`;
  if (date.getFullYear() === now.getFullYear()) {
    return monthDay;
  }
  return `${date.getFullYear()}/${monthDay}`;
}

/**
 * 侧边栏会话列表、AI 会话列表与申请时间摘要格式化
 * - 本日：HH:mm
 * - 非本日且本周内：周X
 * - 非本周：MM/DD 或 YYYY/MM/DD
 */
export function formatChatListTimestamp(
  timestamp: string | number | Date | undefined,
  now = new Date(),
): string {
  const date = toValidDate(timestamp);
  if (!date) return '';

  if (isSameCalendarDay(date, now)) {
    return formatHourMinute(date);
  }

  if (isWithinCurrentWeek(date, now)) {
    return WEEKDAY_LABELS[date.getDay()];
  }

  return formatAbsoluteDate(date, now);
}

/**
 * 聊天消息气泡时间格式化（完整保留具体时分，并按日/周/年分级展示周几或日期）
 * - 本日：HH:mm
 * - 非本日且本周内：周X HH:mm
 * - 非本周：MM/DD HH:mm 或 YYYY/MM/DD HH:mm
 */
export function formatMessageTimestamp(
  timestamp: string | number | Date | undefined,
  now = new Date(),
): string {
  const date = toValidDate(timestamp);
  if (!date) return '';

  const timePart = formatHourMinute(date);
  if (isSameCalendarDay(date, now)) {
    return timePart;
  }

  if (isWithinCurrentWeek(date, now)) {
    return `${WEEKDAY_LABELS[date.getDay()]} ${timePart}`;
  }

  return `${formatAbsoluteDate(date, now)} ${timePart}`;
}

/**
 * 聊天消息流居中日期分隔条文案
 * - 今天 -> 「今天」
 * - 昨天 -> 「昨天」
 * - 本周内更早几天 -> 「周X」
 * - 非本周同年 -> 「M月D日」
 * - 跨年 -> 「YYYY年M月D日」
 */
export function formatChatDateDivider(
  timestamp: string | number | Date | undefined,
  now = new Date(),
): string {
  const date = toValidDate(timestamp);
  if (!date) return '';

  if (isSameCalendarDay(date, now)) {
    return '今天';
  }

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) {
    return '昨天';
  }

  if (isWithinCurrentWeek(date, now)) {
    return WEEKDAY_LABELS[date.getDay()];
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日`;
  }
  return `${date.getFullYear()}年${month}月${day}日`;
}
