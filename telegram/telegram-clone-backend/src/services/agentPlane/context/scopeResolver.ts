import type { AgentContextScope } from '../contracts/payloads';

const FEED_KEYWORDS = ['动态', '推荐', 'feed', 'space', '帖子', '关注', '时间线', '发什么', '推荐我'];
const NOTIFICATION_KEYWORDS = ['通知', '提醒', '谁找我', '谁赞了我', '谁回复', '未读', '消息提醒'];
const NEWS_KEYWORDS = ['新闻', '热点', '头条', '今天发生', '最新', '时事', '快讯'];
const GENERAL_ONLY_KEYWORDS = ['代码', '翻译', '解释', '概念', '算法', 'python', 'rust', 'typescript', 'javascript', '润色', '改写'];

function includesAnyKeyword(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword));
}

export function resolveAgentContextScopes(message: string): AgentContextScope[] {
  const normalized = message.trim().toLowerCase();
  const scopes = new Set<AgentContextScope>();
  const hasGeneralOnlyIntent = includesAnyKeyword(normalized, GENERAL_ONLY_KEYWORDS);
  const hasSocialIntent =
    includesAnyKeyword(normalized, FEED_KEYWORDS) ||
    includesAnyKeyword(normalized, NOTIFICATION_KEYWORDS) ||
    includesAnyKeyword(normalized, NEWS_KEYWORDS);

  if (hasGeneralOnlyIntent && !hasSocialIntent) {
    return [];
  }

  if (includesAnyKeyword(normalized, FEED_KEYWORDS)) {
    scopes.add('feed');
  }

  if (includesAnyKeyword(normalized, NOTIFICATION_KEYWORDS)) {
    scopes.add('notifications');
  }

  if (includesAnyKeyword(normalized, NEWS_KEYWORDS)) {
    scopes.add('news');
  }

  if (scopes.size === 0) {
    scopes.add('feed');
    scopes.add('notifications');
  }

  return Array.from(scopes);
}
