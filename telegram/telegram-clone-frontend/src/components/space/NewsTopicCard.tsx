import React from 'react';
import type { NewsTopic } from '../../services/newsApi';
import './NewsTopicCard.css';

interface NewsTopicCardProps {
    cluster: NewsTopic;
    onClick: () => void;
}

export const NewsTopicCard: React.FC<NewsTopicCardProps> = ({ cluster, onClick }) => {
    const coverStyle = cluster.coverImageUrl
        ? { backgroundImage: `url(${cluster.coverImageUrl})` }
        : { backgroundImage: 'linear-gradient(120deg, rgba(51, 144, 236, 0.35), rgba(134, 88, 214, 0.35))' };

    return (
        <div className="glass-card news-topic-card" onClick={onClick}>
            <div className="news-topic-cover" style={coverStyle}>
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
        </div>
    );
};
