import React from 'react';
import type { NewsTopic } from '../../services/newsApi';
import { resolveMediaCrossOrigin } from '../../utils/apiUrl';
import './NewsTopicCard.css';

interface NewsTopicCardProps {
    cluster: NewsTopic;
    onClick: () => void;
}

export const NewsTopicCard: React.FC<NewsTopicCardProps> = ({ cluster, onClick }) => {
    return (
        <button
            type="button"
            className="glass-card news-topic-card"
            onClick={onClick}
            aria-label={`查看新闻话题：${cluster.title}`}
        >
            <div className="news-topic-cover">
                {cluster.coverImageUrl && (
                    <img
                        className="news-topic-cover__img"
                        src={cluster.coverImageUrl}
                        alt=""
                        crossOrigin={resolveMediaCrossOrigin(cluster.coverImageUrl)}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                )}
                <div className="news-topic-overlay">
                    <span className="news-topic-badge">Trending News</span>
                </div>
            </div>
            <div className="news-topic-content">
                <h3 className="news-topic-title">{cluster.title}</h3>
                <div className="news-topic-meta">
                    <span className="news-topic-time">
                        {cluster.latestAt ? new Date(cluster.latestAt).toLocaleDateString() : '刚刚'}
                    </span>
                    <span className="news-topic-count">
                        {cluster.count} articles
                    </span>
                </div>
            </div>
        </button>
    );
};
