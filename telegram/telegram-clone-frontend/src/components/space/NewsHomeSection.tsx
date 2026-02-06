import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import newsApi, { type NewsFeedItem } from '../../services/newsApi';
import './NewsHomeSection.css';

const HERO_COUNT = 4;

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const clampText = (text: string, max = 160) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}...`;
};

const useNewsImpression = (newsId: string) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const impressed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || impressed.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !impressed.current) {
          impressed.current = true;
          newsApi.trackEvent(newsId, 'impression');
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [newsId]);

  return ref;
};

const useNewsDwell = (newsId: string) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          start.current = Date.now();
        } else if (start.current) {
          const dwell = Date.now() - start.current;
          newsApi.trackEvent(newsId, 'dwell', dwell);
          start.current = null;
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (start.current) {
        const dwell = Date.now() - start.current;
        newsApi.trackEvent(newsId, 'dwell', dwell);
        start.current = null;
      }
    };
  }, [newsId]);

  return ref;
};

interface HeroProps {
  item: NewsFeedItem;
  onOpen: (id: string) => void;
}

const NewsHeroCard: React.FC<HeroProps> = ({ item, onOpen }) => {
  const impressionRef = useNewsImpression(item.id);
  const dwellRef = useNewsDwell(item.id);

  return (
    <div className="news-home__hero" onClick={() => onOpen(item.id)}>
      <div
        className="news-home__hero-media"
        style={{ backgroundImage: item.coverImageUrl ? `url(${item.coverImageUrl})` : undefined }}
        ref={(el) => {
          if (impressionRef.current !== el) (impressionRef as any).current = el;
          if (dwellRef.current !== el) (dwellRef as any).current = el;
        }}
      >
        <span className="news-home__badge">Breaking</span>
      </div>
      <div className="news-home__hero-body">
        <div className="news-home__hero-meta">
          <span>{item.source}</span>
          {item.publishedAt && <span>· {formatTime(item.publishedAt)}</span>}
        </div>
        <h3 className="news-home__hero-title">{item.title}</h3>
        <p className="news-home__hero-summary">{clampText(item.summary, 220)}</p>
      </div>
    </div>
  );
};

interface CardProps {
  item: NewsFeedItem;
  onOpen: (id: string) => void;
}

const NewsMiniCard: React.FC<CardProps> = ({ item, onOpen }) => {
  const impressionRef = useNewsImpression(item.id);
  const dwellRef = useNewsDwell(item.id);

  return (
    <div
      className="news-home__card"
      onClick={() => onOpen(item.id)}
      ref={(el) => {
        if (impressionRef.current !== el) (impressionRef as any).current = el;
        if (dwellRef.current !== el) (dwellRef as any).current = el;
      }}
    >
      <div
        className="news-home__card-media"
        style={{ backgroundImage: item.coverImageUrl ? `url(${item.coverImageUrl})` : undefined }}
      />
      <div className="news-home__card-body">
        <div className="news-home__card-meta">
          <span>{item.source}</span>
          {item.publishedAt && <span>· {formatTime(item.publishedAt)}</span>}
        </div>
        <h4 className="news-home__card-title">{item.title}</h4>
        <p className="news-home__card-summary">{clampText(item.summary, 120)}</p>
      </div>
    </div>
  );
};

export const NewsHomeSection: React.FC = () => {
  const [items, setItems] = useState<NewsFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    let intervalId: number | undefined;
    const fetchFeed = async (silent: boolean = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await newsApi.getFeed(HERO_COUNT);
        if (mounted) setItems(data.items || []);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchFeed(false);

    // Keep "每小时更新" true: poll hourly + refresh on tab focus.
    intervalId = window.setInterval(() => fetchFeed(true), 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchFeed(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted = false;
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const hero = items[0];
  const cards = useMemo(() => items.slice(1, HERO_COUNT), [items]);

  const openDetail = (id: string) => {
    newsApi.trackEvent(id, 'click');
    navigate(`/news/${id}`);
  };

  if (!loading && items.length === 0) return null;

  return (
    <section className="news-home">
      <div className="news-home__header">
        <div>
          <p className="news-home__eyebrow">Daily News</p>
          <h2 className="news-home__title">今日时事速递</h2>
        </div>
        <span className="news-home__meta">每小时更新</span>
      </div>

      <div className="news-home__layout">
        {hero && !loading && <NewsHeroCard item={hero} onOpen={openDetail} />}

        <div className="news-home__cards">
          {loading &&
            Array.from({ length: HERO_COUNT - 1 }).map((_, idx) => (
              <div key={`s-${idx}`} className="news-home__card news-home__card--skeleton">
                <div className="news-home__card-media" />
                <div className="news-home__card-line" />
                <div className="news-home__card-line short" />
              </div>
            ))}
          {!loading && cards.map((card) => <NewsMiniCard key={card.id} item={card} onOpen={openDetail} />)}
        </div>
      </div>
    </section>
  );
};

export default NewsHomeSection;
