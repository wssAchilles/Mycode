import User from '../../../models/User';
import { spaceService } from '../../../services/spaceService';
import type {
  AgentContextScope,
  AgentContextSnapshot,
  AgentFeedItem,
  AgentNewsItem,
  AgentNotificationItem,
} from '../contracts/payloads';
import {
  buildFeedSummary,
  buildNewsSummary,
  buildNotificationSummary,
  buildSnippet,
} from './serializers';

const FEED_LIMIT = 6;
const NOTIFICATION_LIMIT = 6;
const NEWS_LIMIT = 5;

async function buildFeedContext(userId: string): Promise<{ items: AgentFeedItem[]; summary: string }> {
  const feed = await spaceService.getFeed(userId, FEED_LIMIT, undefined, false, { inNetworkOnly: false });
  const items = feed.slice(0, FEED_LIMIT).map((candidate) => ({
    postId: candidate.postId.toString(),
    title: candidate.newsMetadata?.title || null,
    snippet: buildSnippet(candidate.newsMetadata?.summary || candidate.content),
    authorUsername: candidate.authorUsername || null,
    isNews: Boolean(candidate.isNews),
    recallSource: candidate.recallSource || candidate.newsMetadata?.source || null,
    createdAt: candidate.createdAt instanceof Date ? candidate.createdAt.toISOString() : new Date(candidate.createdAt).toISOString(),
  }));

  return {
    items,
    summary: buildFeedSummary(items),
  };
}

async function buildNotificationContext(userId: string): Promise<{ items: AgentNotificationItem[]; summary: string }> {
  const notificationResult = await spaceService.getNotifications(userId, NOTIFICATION_LIMIT);
  const rawItems = Array.isArray(notificationResult?.items) ? notificationResult.items : [];
  const items = rawItems.slice(0, NOTIFICATION_LIMIT).map((item: any) => ({
    id: String(item.id || ''),
    type: String(item.type || 'unknown'),
    actorUsername: item.actor?.username || null,
    postSnippet: buildSnippet(item.postSnippet || ''),
    actionText: buildSnippet(item.actionText || '', 80),
    createdAt: String(item.createdAt || new Date().toISOString()),
  }));

  return {
    items,
    summary: buildNotificationSummary(items),
  };
}

async function buildNewsContext(userId: string): Promise<{ items: AgentNewsItem[]; summary: string }> {
  const brief = await spaceService.getNewsBrief(userId, NEWS_LIMIT, 24);
  const items = brief.slice(0, NEWS_LIMIT).map((item: any) => ({
    postId: item.postId ? String(item.postId) : null,
    title: String(item.title || '新闻速递'),
    summary: buildSnippet(item.summary || '', 160),
    source: item.source ? String(item.source) : null,
    url: item.url ? String(item.url) : null,
    createdAt: item.createdAt ? String(item.createdAt) : null,
  }));

  return {
    items,
    summary: buildNewsSummary(items),
  };
}

export async function buildAgentContextSnapshot(params: {
  userId: string;
  requestedScopes: AgentContextScope[];
}): Promise<AgentContextSnapshot> {
  const user = await User.findByPk(params.userId, {
    attributes: ['id', 'username'],
  });

  if (!user) {
    throw new Error('agent_context_user_not_found');
  }

  const scopeSet = new Set(params.requestedScopes);
  const [feedResult, notificationsResult, newsResult] = await Promise.all([
    scopeSet.has('feed') ? buildFeedContext(params.userId).catch(() => null) : Promise.resolve(null),
    scopeSet.has('notifications') ? buildNotificationContext(params.userId).catch(() => null) : Promise.resolve(null),
    scopeSet.has('news') ? buildNewsContext(params.userId).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    user: {
      id: user.id,
      username: user.username,
    },
    requestedScopes: params.requestedScopes,
    feed: feedResult,
    notifications: notificationsResult,
    news: newsResult,
    generatedAt: new Date().toISOString(),
  };
}
