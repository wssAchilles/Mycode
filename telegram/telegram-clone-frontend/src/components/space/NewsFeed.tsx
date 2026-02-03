import React, { useEffect, useState } from 'react';
import { spaceAPI, type NewsCluster } from '../../services/spaceApi';
import { NewsTopicCard } from './NewsTopicCard';
import './NewsFeed.css';

export const NewsFeed: React.FC = () => {
    const [topics, setTopics] = useState<NewsCluster[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTopics = async () => {
            try {
                const data = await spaceAPI.getNewsTopics();
                setTopics(data);
            } catch (error) {
                console.error('Failed to load news topics', error);
            } finally {
                setLoading(false);
            }
        };

        fetchTopics();
    }, []);

    if (!loading && topics.length === 0) {
        return null; // Don't show if empty
    }

    const handleTopicClick = async (cluster: NewsCluster) => {
        // Log click
        if (cluster.postId) {
            try {
                await spaceAPI.getPost(cluster.postId); // Implicitly logs view/click on backend
            } catch { }
        }
        console.log(`Clicked topic ${cluster.clusterId}`);
        // Future: Navigation.navigate('TopicDetail', { clusterId: cluster.clusterId });
    };

    return (
        <div className="news-feed-container animate-fade-in">
            <div className="news-feed-header">
                <h2 className="h3">热点新闻话题</h2>
            </div>
            <div className="news-feed-scroll">
                {topics.map(topic => (
                    <NewsTopicCard
                        key={topic.clusterId}
                        cluster={topic}
                        onClick={() => handleTopicClick(topic)}
                    />
                ))}
            </div>
        </div>
    );
};
