import React, { useCallback, useEffect, useState } from 'react';
import { StateBlock } from '@/components/design-system';
import newsApi, { type NewsTopic } from '../../services/newsApi';
import { NewsTopicCard } from './NewsTopicCard';
import './NewsFeed.css';

export const NewsFeed: React.FC = () => {
    const [topics, setTopics] = useState<NewsTopic[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTopics = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await newsApi.getTopics();
            setTopics(data);
        } catch {
            setError('热点新闻话题加载失败，请稍后重试');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTopics();
    }, [fetchTopics]);

    const handleTopicClick = async (cluster: NewsTopic) => {
        // TODO: 话题详情页
        console.log(`Clicked topic ${cluster.clusterId}`);
    };

    return (
        <div className="news-feed-container animate-fade-in">
            <div className="news-feed-header">
                <h2 className="h3">热点新闻话题</h2>
            </div>
            <div className="news-feed-scroll">
                {loading && topics.length === 0 && (
                    <StateBlock
                        compact
                        variant="info"
                        title="正在加载新闻话题"
                        description="稍候即可查看热点聚合。"
                    />
                )}
                {!loading && error && topics.length === 0 && (
                    <StateBlock
                        compact
                        variant="error"
                        title="新闻话题加载失败"
                        description={error}
                        actionLabel="重试"
                        onAction={fetchTopics}
                    />
                )}
                {!loading && !error && topics.length === 0 && (
                    <StateBlock
                        compact
                        title="暂无热点新闻话题"
                        description="有新的新闻聚合后会显示在这里。"
                    />
                )}
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
