import React, { useEffect, useState } from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { authUtils } from '../../services/apiClient';
import { API_BASE_URL } from '../../utils/apiUrl';
import './LinkPreviewCard.css';

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  hostname: string;
}

const MAX_MEMORY_CACHE_ENTRIES = 200;
const previewMemoryCache = new Map<string, LinkPreviewData | null>();
const inflightRequests = new Map<string, Promise<LinkPreviewData | null>>();

function trimTrailingPunctuation(raw: string): string {
  return raw.replace(/[),.;:!?'"\]}>，。；：！？、“”’）】》]+$/g, '');
}

/**
 * 从纯文本中提取首个适合生成预览卡片的外部 HTTP/HTTPS 链接
 */
export function extractFirstPreviewableUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i);
  if (!match) return null;

  const candidate = trimTrailingPunctuation(match[0]);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || host.endsWith('.local')
      || host.endsWith('.internal')
    ) {
      return null;
    }
    if (parsed.pathname.includes('/api/uploads/')) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function setMemoryCache(url: string, value: LinkPreviewData | null): void {
  if (previewMemoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const firstKey = previewMemoryCache.keys().next().value;
    if (firstKey) previewMemoryCache.delete(firstKey);
  }
  previewMemoryCache.set(url, value);
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  if (previewMemoryCache.has(url)) {
    return previewMemoryCache.get(url) ?? null;
  }
  const existing = inflightRequests.get(url);
  if (existing) return existing;

  const token = authUtils.getAccessToken();
  if (!token) return null;

  const promise = (async (): Promise<LinkPreviewData | null> => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/link-preview?url=${encodeURIComponent(url)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        setMemoryCache(url, null);
        return null;
      }
      const payload = (await response.json()) as { success?: boolean; data?: LinkPreviewData };
      const data = payload?.data;
      if (!data || (!data.title && !data.description)) {
        setMemoryCache(url, null);
        return null;
      }
      setMemoryCache(url, data);
      return data;
    } catch {
      return null;
    } finally {
      inflightRequests.delete(url);
    }
  })();

  inflightRequests.set(url, promise);
  return promise;
}

interface LinkPreviewCardProps {
  url: string;
  compact?: boolean;
}

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ url, compact = false }) => {
  const [data, setData] = useState<LinkPreviewData | null>(() => {
    return previewMemoryCache.has(url) ? (previewMemoryCache.get(url) ?? null) : null;
  });

  useEffect(() => {
    if (previewMemoryCache.has(url)) {
      setData(previewMemoryCache.get(url) ?? null);
      return;
    }
    let active = true;
    void fetchLinkPreview(url).then((result) => {
      if (active && result) {
        setData(result);
      }
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (!data || (!data.title && !data.description)) {
    return null;
  }

  return (
    <a
      href={data.url || url}
      target="_blank"
      rel="noopener noreferrer"
      className={`tg-link-preview ${compact ? 'is-compact' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="tg-link-preview__body">
        <div className="tg-link-preview__meta">
          <Globe size={12} aria-hidden="true" />
          <span className="tg-link-preview__site">{data.siteName || data.hostname}</span>
          <ExternalLink size={11} className="tg-link-preview__ext" aria-hidden="true" />
        </div>
        {data.title && <div className="tg-link-preview__title">{data.title}</div>}
        {data.description && <div className="tg-link-preview__desc">{data.description}</div>}
      </div>
      {data.image && (
        <div className="tg-link-preview__thumb-wrap">
          <img
            src={data.image}
            alt={data.title || data.hostname}
            className="tg-link-preview__thumb"
            loading="lazy"
            decoding="async"
            onError={(event) => {
              const wrap = (event.currentTarget as HTMLImageElement).parentElement;
              if (wrap) wrap.style.display = 'none';
            }}
          />
        </div>
      )}
    </a>
  );
};

export default LinkPreviewCard;
