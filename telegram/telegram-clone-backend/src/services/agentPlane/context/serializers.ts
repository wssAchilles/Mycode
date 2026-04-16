import type {
  AgentFeedItem,
  AgentNewsItem,
  AgentNotificationItem,
} from '../contracts/payloads';

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}

export function buildSnippet(value: string | null | undefined, limit = 120): string {
  return clip(compactWhitespace(value || ''), limit);
}

export function buildFeedSummary(items: AgentFeedItem[]): string {
  if (items.length === 0) {
    return '当前没有可用的动态摘要。';
  }
  const newsCount = items.filter((item) => item.isNews).length;
  return `已准备 ${items.length} 条最近动态${newsCount > 0 ? `，其中 ${newsCount} 条来自新闻内容` : ''}。`;
}

export function buildNotificationSummary(items: AgentNotificationItem[]): string {
  if (items.length === 0) {
    return '当前没有新的通知摘要。';
  }
  return `已准备 ${items.length} 条最近通知，优先保留最新互动。`;
}

export function buildNewsSummary(items: AgentNewsItem[]): string {
  if (items.length === 0) {
    return '当前没有可用的新闻简报。';
  }
  const sources = Array.from(new Set(items.map((item) => item.source).filter(Boolean)));
  return `已准备 ${items.length} 条新闻简报${sources.length > 0 ? `，覆盖 ${sources.slice(0, 3).join('、')}` : ''}。`;
}
