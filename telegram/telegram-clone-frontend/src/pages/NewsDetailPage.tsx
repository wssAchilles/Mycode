import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, ExternalLink, RotateCw, Share2, Type } from 'lucide-react';
import newsApi, { type NewsArticleDetail } from '../services/newsApi';
import { resolveMediaCrossOrigin } from '../utils/apiUrl';
import { useSpaceStore } from '../stores';
import { showToast } from '../components/ui/Toast';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './NewsDetailPage.css';

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const stripLeadingTitle = (content: string | null | undefined, title: string) => {
  if (!content) return content || '';
  const lines = content.split('\n');
  const firstNonEmptyIdx = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIdx === -1) return content;
  const firstLine = lines[firstNonEmptyIdx].trim();
  const normalizedTitle = title.trim().toLowerCase();
  if (firstLine.startsWith('#')) {
    const headingText = firstLine.replace(/^#+\s*/, '').trim().toLowerCase();
    if (headingText === normalizedTitle) {
      return lines.slice(firstNonEmptyIdx + 1).join('\n').trim();
    }
  }
  return content;
};

const NewsDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const createPost = useSpaceStore((state) => state.createPost);

  const [article, setArticle] = useState<NewsArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [largeFont, setLargeFont] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const [reposting, setReposting] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dwellStart = useRef<number | null>(null);

  const fetchArticle = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await newsApi.getArticle(id);
      setArticle(data);
    } catch (err: unknown) {
      setArticle(null);
      setLoadError(err instanceof Error ? err.message : '加载新闻详情失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchArticle();
  }, [fetchArticle]);

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

  const handleSmartBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/space');
    }
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      setReadProgress(100);
      return;
    }
    const pct = Math.max(0, Math.min(100, (el.scrollTop / maxScroll) * 100));
    setReadProgress(pct);
  };

  const handleCopyLink = async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    if (!shareUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      showToast('新闻链接已复制到剪贴板', 'success');
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      showToast('复制链接失败，请手动复制地址栏', 'error');
    }
  };

  const handleDiscussInSpace = async () => {
    if (!article || reposting) return;
    setReposting(true);
    try {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      const snippet = `【${article.source}】${article.title}\n${url}`;
      await createPost(snippet);
      showToast('已转发至 Space 动态，正在返回...', 'success');
      navigate('/space');
    } catch {
      showToast('转发失败，请稍后重试', 'error');
    } finally {
      setReposting(false);
    }
  };

  if (loading) {
    return (
      <div className="news-detail news-detail--skeleton" aria-busy="true" aria-label="新闻详情加载中">
        <div className="news-detail__topbar">
          <button type="button" className="news-detail__back" onClick={handleSmartBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回</span>
          </button>
        </div>
        <div className="news-detail__container">
          <div className="news-detail__hero news-detail__hero--skeleton">
            <Skeleton className="news-detail__skeleton-cover" />
            <div className="news-detail__skeleton-meta">
              <Skeleton className="news-detail__skeleton-line is-short" />
              <Skeleton className="news-detail__skeleton-line is-title" />
              <Skeleton className="news-detail__skeleton-line is-title" />
              <Skeleton className="news-detail__skeleton-line" />
            </div>
          </div>
          <div className="news-detail__body news-detail__body--skeleton">
            <Skeleton className="news-detail__skeleton-line" />
            <Skeleton className="news-detail__skeleton-line" />
            <Skeleton className="news-detail__skeleton-line is-medium" />
            <Skeleton className="news-detail__skeleton-line" />
            <Skeleton className="news-detail__skeleton-line is-short" />
          </div>
        </div>
      </div>
    );
  }

  if (!article || loadError) {
    return (
      <div className="news-detail">
        <div className="news-detail__topbar">
          <button type="button" className="news-detail__back" onClick={handleSmartBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回</span>
          </button>
        </div>
        <div className="news-detail__empty">
          <StateBlock
            variant={loadError ? 'error' : 'info'}
            title={loadError ? '新闻加载失败' : '未找到该新闻'}
            description={loadError || '该新闻可能已过期、下线或链接有误。'}
            actionLabel="重新加载"
            onAction={() => void fetchArticle()}
          />
          <button
            type="button"
            className="news-detail__empty-back"
            onClick={handleSmartBack}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>返回上一页</span>
          </button>
        </div>
      </div>
    );
  }

  const sanitizedContent = stripLeadingTitle(article.content, article.title);
  const timeValue = article.publishedAt || article.fetchedAt;

  return (
    <div
      ref={scrollContainerRef}
      className={`news-detail ${largeFont ? 'is-large-font' : ''}`}
      onScroll={handleScroll}
    >
      <header className="news-detail__topbar">
        <div className="news-detail__topbar-inner">
          <button type="button" className="news-detail__back" onClick={handleSmartBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回</span>
          </button>

          <div className="news-detail__topbar-source" title={article.title}>
            <span className="news-detail__topbar-badge">{article.source}</span>
            <span className="news-detail__topbar-title">{article.title}</span>
          </div>

          <div className="news-detail__topbar-actions">
            <button
              type="button"
              className={`news-detail__tool-btn ${largeFont ? 'is-active' : ''}`}
              onClick={() => setLargeFont((prev) => !prev)}
              aria-pressed={largeFont}
              title={largeFont ? '切换标准字号' : '切换舒适大字号'}
            >
              <Type size={15} aria-hidden="true" />
              <span>{largeFont ? '标准字号' : '大字号'}</span>
            </button>
            <button
              type="button"
              className="news-detail__tool-btn"
              onClick={() => void handleCopyLink()}
              title="复制新闻链接"
            >
              {copiedLink ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              <span>{copiedLink ? '已复制' : '复制链接'}</span>
            </button>
            <button
              type="button"
              className="news-detail__tool-btn is-primary"
              onClick={() => void handleDiscussInSpace()}
              disabled={reposting}
              title="转发至 Space 发起讨论"
            >
              {reposting ? <RotateCw size={15} className="news-detail__spin" aria-hidden="true" /> : <Share2 size={15} aria-hidden="true" />}
              <span>{reposting ? '转发中...' : '转发到 Space'}</span>
            </button>
          </div>
        </div>
        <div className="news-detail__progress-track" aria-hidden="true">
          <div className="news-detail__progress-bar" style={{ width: `${readProgress}%` }} />
        </div>
      </header>

      <div className="news-detail__container">
        <div className="news-detail__hero">
          {article.coverImageUrl && (
            <div className="news-detail__hero-image">
              <img
                className="news-detail__hero-img"
                src={article.coverImageUrl}
                alt={article.title}
                crossOrigin={resolveMediaCrossOrigin(article.coverImageUrl)}
                decoding="async"
                onError={(e) => {
                  const wrap = e.currentTarget.parentElement;
                  if (wrap) wrap.style.display = 'none';
                }}
              />
            </div>
          )}
          <div className="news-detail__hero-content">
            <p className="news-detail__source">{article.source}</p>
            <h1 className="news-detail__title">{article.title}</h1>
            <div className="news-detail__meta">
              {timeValue && <span>{formatTime(timeValue)}</span>}
              {article.category && <span>· {article.category}</span>}
            </div>
            {article.lead && <p className="news-detail__lead">{article.lead}</p>}
          </div>
        </div>

        <article className="news-detail__body">
          {sanitizedContent ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizedContent}</ReactMarkdown>
          ) : (
            <p className="news-detail__summary">{article.summary}</p>
          )}

          {article.sourceUrl && (
            <div className="news-detail__source-link">
              <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} aria-hidden="true" />
                <span>阅读原文出处</span>
              </a>
            </div>
          )}
        </article>
      </div>
    </div>
  );
};

export default NewsDetailPage;
