import React from 'react';
import type { NewsCluster } from '../../services/spaceApi';
import './NewsTopicCard.css';

interface NewsTopicCardProps {
    cluster: NewsCluster;
    onClick: () => void;
}

export const NewsTopicCard: React.FC<NewsTopicCardProps> = ({ cluster, onClick }) => {
    return (
        <div className="glass-card news-topic-card" onClick={onClick}>
            <div className="news-topic-cover" style={{ backgroundImage: `url(${cluster.coverUrl || '/assets/default_news.jpg'})` }}>
                <div className="news-topic-overlay">
                    <span className="news-topic-badge">Trending News</span>
                </div>
            </div>
            <div className="news-topic-content">
                <h3 className="news-topic-title">{cluster.title}</h3>
                <div className="news-topic-meta">
                    <span className="news-topic-source">{cluster.source || 'Unknown'}</span>
                    <span className="news-topic-time">
                        {new Date(cluster.latestAt).toLocaleDateString()}
                    </span>
                    <span className="news-topic-count">
                        {cluster.count} articles
                    </span>
                </div>
            </div>
        </div>
    );
};
