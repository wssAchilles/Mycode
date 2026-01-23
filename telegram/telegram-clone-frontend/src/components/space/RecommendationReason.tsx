/**
 * RecommendationReason - 推荐理由展示组件 (Premium UI)
 * 显示帖子为何被推荐的原因标签
 */

import React from 'react';
import {
    Sparkles,
    Users,
    Flame,
    UserPlus,
    Hash,
    MessageCircle,
    Dices
} from 'lucide-react';
import './RecommendationReason.css';

// 召回源类型
export type RecallSource =
    | 'embedding'
    | 'graph'
    | 'trending'
    | 'following'
    | 'topic'
    | 'engagement'
    | 'random';

export interface RecommendationReasonProps {
    source: RecallSource;
    detail?: string;
    compact?: boolean;
    onClick?: () => void;
}

// 映射配置 (Lucide Icons)
const SOURCE_CONFIG: Record<RecallSource, {
    icon: React.ElementType;
    label: string;
    color: string; // Gradient Start
    colorEnd: string; // Gradient End
}> = {
    embedding: {
        icon: Sparkles,
        label: '为你推荐',
        color: '#3390ec',
        colorEnd: '#00bfa5'
    },
    graph: {
        icon: Users,
        label: '好友关注',
        color: '#8774e1',
        colorEnd: '#b39ddb'
    },
    trending: {
        icon: Flame,
        label: '热门趋势',
        color: '#ff5252',
        colorEnd: '#ff1744'
    },
    following: {
        icon: UserPlus,
        label: '关注用户',
        color: '#f5a623',
        colorEnd: '#ff9800'
    },
    topic: {
        icon: Hash,
        label: '话题推荐',
        color: '#29b6f6',
        colorEnd: '#0288d1'
    },
    engagement: {
        icon: MessageCircle,
        label: '基于互动',
        color: '#66bb6a',
        colorEnd: '#43a047'
    },
    random: {
        icon: Dices,
        label: '发现新奇',
        color: '#78909c',
        colorEnd: '#546e7a'
    },
};

export const RecommendationReason: React.FC<RecommendationReasonProps> = ({
    source,
    detail,
    compact = false,
    onClick,
}) => {
    const config = SOURCE_CONFIG[source] || SOURCE_CONFIG.embedding;
    const Icon = config.icon;

    return (
        <div
            className={`recommendation-reason ${compact ? 'compact' : ''}`}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            style={{
                '--reason-color': config.color,
                '--reason-color-end': config.colorEnd,
            } as React.CSSProperties}
        >
            <div className="reason-glass-bg" />
            <Icon className="reason-icon" size={compact ? 12 : 14} strokeWidth={2.5} />
            <span className="reason-label">{detail || config.label}</span>
        </div>
    );
};

// 多理由展示
export interface MultiReasonProps {
    sources: RecallSource[];
    maxDisplay?: number;
}

export const MultiReason: React.FC<MultiReasonProps> = ({ sources, maxDisplay = 2 }) => {
    const displaySources = sources.slice(0, maxDisplay);
    const remainingCount = sources.length - maxDisplay;

    return (
        <div className="multi-reason">
            {displaySources.map((source, index) => (
                <RecommendationReason key={`${source}-${index}`} source={source} compact />
            ))}
            {remainingCount > 0 && (
                <span className="reason-more">+{remainingCount}</span>
            )}
        </div>
    );
};

export default RecommendationReason;
