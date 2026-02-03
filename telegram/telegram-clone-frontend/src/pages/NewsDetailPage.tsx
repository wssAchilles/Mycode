import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import newsApi, { type NewsArticleDetail } from '../services/newsApi';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './NewsDetailPage.css';

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const NewsDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<NewsArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const dwellStart = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchArticle = async () => {
      if (!id) return;
      try {
        const data = await newsApi.getArticle(id);
        if (mounted) setArticle(data);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchArticle();
    return () => {
      mounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    dwellStart.current = Date.now();
    return () => {
      if (dwellStart.current) {
        const dwellMs = Date.now() - dwellStart.current;
        newsApi.trackEvent(id, 'dwell', dwellMs);
        dwellStart.current = null;
      }
    };
  }, [id]);

  if (loading) {
    return (
      <div className="news-detail__loading">
        <div className="news-detail__spinner" />
        <p>加载新闻中...</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="news-detail__empty">
        <h2>未找到新闻</h2>
        <p>可能已过期或被移除。</p>
      </div>
    );
  }

  return (
    <div className="news-detail">
      <div className="news-detail__hero">
        <div
          className="news-detail__hero-image"
          style={{ backgroundImage: article.coverImageUrl ? `url(${article.coverImageUrl})` : undefined }}
        />
        <div className="news-detail__hero-content">
          <p className="news-detail__source">{article.source}</p>
          <h1 className="news-detail__title">{article.title}</h1>
          <div className="news-detail__meta">
            {article.publishedAt && <span>{formatTime(article.publishedAt)}</span>}
            {article.category && <span>· {article.category}</span>}
          </div>
          {article.lead && <p className="news-detail__lead">{article.lead}</p>}
        </div>
      </div>

      <div className="news-detail__body">
        {article.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.content}</ReactMarkdown>
        ) : (
          <p className="news-detail__summary">{article.summary}</p>
        )}

        {article.sourceUrl && (
          <div className="news-detail__source-link">
            <a href={article.sourceUrl} target="_blank" rel="noreferrer">
              查看来源
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsDetailPage;
