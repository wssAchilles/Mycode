import apiClient from './apiClient';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

const withApiBase = (url?: string | null) => {
  if (!url) return url || null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

export interface NewsFeedItem {
  id: string;
  title: string;
  summary: string;
  lead?: string | null;
  source: string;
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  publishedAt?: string | null;
  coverImageUrl?: string | null;
  category?: string | null;
}

export interface NewsTopic {
  clusterId: number;
  count: number;
  title: string;
  summary: string;
  coverImageUrl?: string | null;
  latestAt?: string;
}

export interface NewsArticleDetail extends NewsFeedItem {
  content?: string | null;
}

export type NewsEventType = 'impression' | 'click' | 'dwell' | 'share';

export const newsApi = {
  async getFeed(limit: number = 10, cursor?: string) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.append('cursor', cursor);
    const response = await apiClient.get<{ items: NewsFeedItem[]; nextCursor?: string; hasMore: boolean }>(
      `/api/news/feed?${params.toString()}`
    );
    const items = response.data.items.map((item) => ({
      ...item,
      coverImageUrl: withApiBase(item.coverImageUrl),
    }));
    return { items, nextCursor: response.data.nextCursor, hasMore: response.data.hasMore };
  },

  async getArticle(id: string): Promise<NewsArticleDetail> {
    const response = await apiClient.get<{ article: NewsArticleDetail }>(`/api/news/articles/${id}`);
    const article = response.data.article;
    return {
      ...article,
      coverImageUrl: withApiBase(article.coverImageUrl),
    };
  },

  async getTopics(): Promise<NewsTopic[]> {
    const response = await apiClient.get<{ topics: NewsTopic[] }>('/api/news/topics');
    return (response.data.topics || []).map((topic) => ({
      ...topic,
      coverImageUrl: withApiBase(topic.coverImageUrl),
    }));
  },

  async trackEvent(newsId: string, eventType: NewsEventType, dwellMs?: number) {
    try {
      await apiClient.post('/api/news/events', { newsId, eventType, dwellMs });
    } catch {
      // ignore
    }
  },
};

export default newsApi;
