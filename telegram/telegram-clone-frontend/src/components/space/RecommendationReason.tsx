/**
 * RecommendationReason - 推荐理由展示组件 (Premium UI)
 * 显示帖子为何被推荐的原因标签
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    Sparkles,
    Users,
    Flame,
    UserPlus,
    Hash,
    MessageCircle,
    Dices,
    ChevronDown,
    ThumbsDown,
    ThumbsUp,
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

export interface RecommendationExplain {
    detail?: string;
    primarySource?: string;
    sourceReason?: string;
    inNetwork?: boolean;
    embeddingMatched?: boolean;
    graphMatched?: boolean;
    popularFallback?: boolean;
    diversityAdjusted?: boolean;
    userState?: string;
    selectionPool?: string;
    selectionReason?: string;
    evidence?: string[];
    signals?: Record<string, number>;
}

export interface RecommendationReasonProps {
    source: RecallSource;
    detail?: string;
    explain?: RecommendationExplain;
    compact?: boolean;
    onClick?: () => void;
    postId?: string;
    onDismiss?: (postId: string) => void;
    onShowMore?: (postId: string) => void;
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
    explain,
    compact = false,
    onClick,
    postId,
    onDismiss,
    onShowMore,
}) => {
    const [showPopover, setShowPopover] = useState(false);
    const anchorRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const config = SOURCE_CONFIG[source] || SOURCE_CONFIG.embedding;
    const Icon = config.icon;
    const badges = buildExplainBadges(explain).slice(0, compact ? 2 : 3);
    const title = buildExplainTitle(detail || config.label, explain);

    // 点击外部关闭 Popover
    useEffect(() => {
        if (!showPopover) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                anchorRef.current && !anchorRef.current.contains(e.target as Node)
            ) {
                setShowPopover(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showPopover]);

    const handleBadgeClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowPopover((prev) => !prev);
    }, []);

    const handleDismiss = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowPopover(false);
        onDismiss?.(postId || '');
    }, [postId, onDismiss]);

    const handleShowMore = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowPopover(false);
        onShowMore?.(postId || '');
    }, [postId, onShowMore]);

    const popoverContent = showPopover && explain && (
        <div
            ref={popoverRef}
            className="reason-popover"
            style={{
                position: 'fixed',
                top: anchorRef.current ? anchorRef.current.getBoundingClientRect().bottom + 6 : 0,
                left: anchorRef.current ? anchorRef.current.getBoundingClientRect().left : 0,
            }}
        >
            <div className="reason-popover__header">
                <Icon size={16} strokeWidth={2} />
                <span>{detail || config.label}</span>
            </div>

            <div className="reason-popover__section">
                <div className="reason-popover__section-title">推荐来源</div>
                <div className="reason-popover__tags">
                    {explain.inNetwork && <span className="reason-popover__tag">关注网络内</span>}
                    {explain.embeddingMatched && <span className="reason-popover__tag">向量匹配</span>}
                    {explain.graphMatched && <span className="reason-popover__tag">图谱匹配</span>}
                    {explain.popularFallback && <span className="reason-popover__tag">热门兜底</span>}
                    {explain.diversityAdjusted && <span className="reason-popover__tag">多样性调整</span>}
                </div>
            </div>

            {explain.userState && (
                <div className="reason-popover__section">
                    <div className="reason-popover__section-title">用户状态</div>
                    <span className="reason-popover__value">{userStateLabels[explain.userState] || explain.userState}</span>
                </div>
            )}

            {explain.signals && Object.keys(explain.signals).length > 0 && (
                <div className="reason-popover__section">
                    <div className="reason-popover__section-title">信号值</div>
                    <div className="reason-popover__signals">
                        {Object.entries(explain.signals)
                            .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
                            .slice(0, 8)
                            .map(([key, value]) => (
                                <div className="reason-popover__signal-row" key={key}>
                                    <span className="reason-popover__signal-key">{signalLabels[key] || key}</span>
                                    <span className="reason-popover__signal-value">{(value as number).toFixed(3)}</span>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {postId && (
                <div className="reason-popover__actions">
                    <button className="reason-popover__action-btn" onClick={handleShowMore}>
                        <ThumbsUp size={14} /> 更多类似
                    </button>
                    <button className="reason-popover__action-btn reason-popover__action-btn--negative" onClick={handleDismiss}>
                        <ThumbsDown size={14} /> 不感兴趣
                    </button>
                </div>
            )}
        </div>
    );

    return (
        <div
            ref={anchorRef}
            className={`recommendation-reason ${compact ? 'compact' : ''}`}
            onClick={onClick || handleBadgeClick}
            role={onClick || compact ? 'button' : undefined}
            tabIndex={onClick || compact ? 0 : undefined}
            title={title}
            style={{
                '--reason-color': config.color,
                '--reason-color-end': config.colorEnd,
            } as React.CSSProperties}
        >
            <div className="reason-glass-bg" />
            <Icon className="reason-icon" size={compact ? 12 : 14} strokeWidth={2.5} />
            <span className="reason-label">{detail || config.label}</span>
            {badges.map((badge) => (
                <span className="reason-signal" key={badge}>{badge}</span>
            ))}
            {!compact && explain && <ChevronDown className="reason-expand-icon" size={12} />}
            {popoverContent && createPortal(popoverContent, document.body)}
        </div>
    );
};

const userStateLabels: Record<string, string> = {
    cold_start: '冷启动',
    sparse: '稀疏用户',
    warm: '活跃用户',
    heavy: '重度用户',
};

const signalLabels: Record<string, string> = {
    finalScore: '最终分数',
    pipelineScore: '管线分数',
    trendPersonalizationStrength: '趋势个性化',
    trendAffinityStrength: '趋势亲和力',
    explorationRisk: '探索风险',
    fatigueStrength: '疲劳度',
    authorAffinityScore: '作者亲和力',
    diversityScore: '多样性分数',
    embeddingSimilarity: '向量相似度',
    graphProximity: '图谱接近度',
    popularityScore: '热度分数',
    recencyScore: '时效分数',
};

function buildExplainBadges(explain?: RecommendationReasonProps['explain']): string[] {
    const evidence = explain?.evidence || [];
    const map: Record<string, string> = {
        trend_personalized: '趋势',
        trend_affinity: '热度',
        multi_source_consensus: '多源',
        safe_exploration: '探索',
        session_diversified: '低重复',
        graph_match: '图谱',
        dense_vector: '向量',
        author_affinity: '作者',
        news_candidate: '新闻',
    };

    const badges = evidence
        .map((item) => map[item])
        .filter((item): item is string => Boolean(item));

    if (badges.length === 0 && explain?.selectionPool) {
        badges.push(explain.selectionPool === 'fallback' ? '兜底' : explain.selectionPool);
    }

    return Array.from(new Set(badges));
}

function buildExplainTitle(
    label: string,
    explain?: RecommendationReasonProps['explain'],
): string {
    if (!explain) return label;

    const signals = explain.signals || {};
    const compactSignals = [
        ['score', signals.finalScore ?? signals.pipelineScore],
        ['trend', signals.trendPersonalizationStrength ?? signals.trendAffinityStrength],
        ['risk', signals.explorationRisk],
        ['fatigue', signals.fatigueStrength],
    ]
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
        .map(([key, value]) => `${key}:${value.toFixed(2)}`);

    return [
        label,
        explain.sourceReason,
        explain.selectionReason,
        compactSignals.join(' · '),
    ].filter(Boolean).join(' | ');
}

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
