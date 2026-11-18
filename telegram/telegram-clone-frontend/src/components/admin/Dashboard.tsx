/**
 * Analytics Dashboard - 推荐系统监控看板（淡色高对比版）
 * 采用 Bento Grid 布局展示核心指标、延迟趋势、召回分布与实验安全观测
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
    BarChart, Bar
} from 'recharts';
import {
    TrendingUp, TrendingDown, RefreshCw, Settings,
    Users, FileText, Activity, Shield, AlertTriangle,
    Zap, BarChart3, Award
} from 'lucide-react';
import { analyticsAPI } from '../../services/analyticsApi';
import type { DashboardData, ExperimentMetrics, RecallSourceDistribution } from '../../types/analytics';
import { motionDurations, useAnimeScope, waapi } from '../../core/animation';
import './Dashboard.css';

// 统一淡色图表浮层与坐标轴令牌，确保白底高对比度可读性
const CHART_GRID_STROKE = '#EFF3F4';
const CHART_AXIS_STROKE = '#CFD9DE';
const CHART_AXIS_TICK = { fill: '#536471', fontSize: 11 };
const CHART_TOOLTIP_CONTENT_STYLE: React.CSSProperties = {
    backgroundColor: '#FFFFFF',
    border: '1px solid #EFF3F4',
    borderRadius: '10px',
    color: '#0F1419',
    boxShadow: '0 4px 16px rgba(15, 20, 25, 0.08)',
};
const CHART_TOOLTIP_LABEL_STYLE: React.CSSProperties = {
    color: '#0F1419',
    fontWeight: 600,
};
const CHART_TOOLTIP_ITEM_STYLE: React.CSSProperties = {
    color: '#0F1419',
};

const RECALL_LIGHT_PALETTE = ['#1D9BF0', '#0284C7', '#00BA7C', '#D97706', '#64748B'];

// ===== 子组件 =====

// 核心 KPI 指标卡片
interface KPICardProps {
    title: string;
    value: number | string;
    change?: number;
    trend?: 'up' | 'down' | 'stable';
    icon: React.ElementType;
    color: string;
}

const KPICard: React.FC<KPICardProps> = ({ title, value, change, trend, icon: Icon, color }) => {
    const cardMotion = useAnimeScope<HTMLDivElement, { flash: () => void }>(
        ({ root, reducedMotion, duration }) => ({
            flash: () => {
                if (reducedMotion || !root) return;
                const valueEl = root.querySelector('.kpi-value');
                if (!valueEl) return;
                waapi.animate(valueEl, {
                    opacity: [0.6, 1],
                    y: ['4px', '0px'],
                    duration: duration(motionDurations.fast),
                    ease: 'out(4)',
                });
            },
        }),
        [],
    );

    useEffect(() => {
        cardMotion.run('flash');
    }, [cardMotion, value]);

    const formatValue = (val: number | string) => {
        if (typeof val === 'string') return val;
        if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
        return val.toLocaleString();
    };

    const isPositive = trend === 'up' || (change !== undefined && change >= 0);

    return (
        <div ref={cardMotion.rootRef} className="kpi-card glass-card">
            <div className="kpi-icon-wrapper" style={{ '--kpi-color': color } as React.CSSProperties}>
                <Icon size={20} />
            </div>
            <div className="kpi-content">
                <span className="kpi-title">{title}</span>
                <div className="kpi-value-row">
                    <span className="kpi-value">{formatValue(value)}</span>
                    {change !== undefined && (
                        <span className={`kpi-change ${isPositive ? 'up' : 'down'}`}>
                            {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                            {Math.abs(change).toFixed(1)}%
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

// 推荐延迟趋势图
interface LatencyChartCardProps {
    latency: {
        p50: number;
        p90: number;
        p99: number;
        avg: number;
    };
    trend?: Array<{ time: string; p50: number; p99: number }>;
}

const LatencyChartCard: React.FC<LatencyChartCardProps> = ({ latency, trend }) => {
    // 兜底模拟趋势数据（当后端尚未返回时间序列时使用）
    const mockTrend = trend || [
        { time: '10:00', p50: 42, p99: 250 },
        { time: '10:05', p50: 45, p99: 280 },
        { time: '10:10', p50: 38, p99: 220 },
        { time: '10:15', p50: 48, p99: 310 },
        { time: '10:20', p50: 44, p99: 270 },
        { time: '10:25', p50: 46, p99: 290 },
        { time: '10:30', p50: latency.p50, p99: latency.p99 },
    ];

    return (
        <div className="latency-chart-card glass-card">
            <div className="card-header">
                <h3><Zap size={18} /> 推荐延迟</h3>
                <div className="latency-badges">
                    <span className="badge p50">P50: {latency.p50}ms</span>
                    <span className="badge p99">P99: {latency.p99}ms</span>
                </div>
            </div>
            <div className="chart-container">
                <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={mockTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorP50" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#1D9BF0" stopOpacity={0.22} />
                                <stop offset="95%" stopColor="#1D9BF0" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorP99" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#E11D48" stopOpacity={0.18} />
                                <stop offset="95%" stopColor="#E11D48" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="time" stroke={CHART_AXIS_STROKE} tick={CHART_AXIS_TICK} />
                        <YAxis stroke={CHART_AXIS_STROKE} tick={CHART_AXIS_TICK} />
                        <Tooltip
                            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                        />
                        <Area type="monotone" dataKey="p50" stroke="#1D9BF0" strokeWidth={2} fillOpacity={1} fill="url(#colorP50)" name="P50 (ms)" />
                        <Area type="monotone" dataKey="p99" stroke="#E11D48" strokeWidth={2} fillOpacity={1} fill="url(#colorP99)" name="P99 (ms)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// 召回源分布图
interface RecallDistributionCardProps {
    distribution: RecallSourceDistribution[];
}

const RecallDistributionCard: React.FC<RecallDistributionCardProps> = ({ distribution }) => {
    const coloredDistribution = distribution.map((item, index) => ({
        ...item,
        resolvedColor: item.color || RECALL_LIGHT_PALETTE[index % RECALL_LIGHT_PALETTE.length],
    }));

    return (
        <div className="recall-chart-card glass-card">
            <div className="card-header">
                <h3><BarChart3 size={18} /> 召回源分布</h3>
            </div>
            <div className="chart-container pie-chart">
                <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                        <Pie
                            data={coloredDistribution}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={78}
                            innerRadius={44}
                            paddingAngle={2}
                            dataKey="percentage"
                            nameKey="label"
                        >
                            {coloredDistribution.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.resolvedColor} stroke="#FFFFFF" strokeWidth={2} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value) => value !== undefined ? `${Number(value).toFixed(1)}%` : ''}
                            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                        />
                    </PieChart>
                </ResponsiveContainer>
                <div className="pie-legend">
                    {coloredDistribution.map((item) => (
                        <div key={item.source} className="legend-item">
                            <span className="legend-item-left">
                                <span className="legend-dot" style={{ backgroundColor: item.resolvedColor }} />
                                <span className="legend-label">{item.label}</span>
                            </span>
                            <span className="legend-value">{item.percentage.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// 实验指标对比卡片
interface ExperimentCardProps {
    experiment: ExperimentMetrics;
    onManage?: () => void;
}

const ExperimentCard: React.FC<ExperimentCardProps> = ({ experiment, onManage }) => {
    const maxCTR = Math.max(...experiment.buckets.map((b) => b.ctr));
    const controlBucket = experiment.buckets.find(b => b.bucketId === 'control') || experiment.buckets[0];

    const chartData = experiment.buckets.map((bucket) => ({
        name: bucket.bucketName,
        ctr: bucket.ctr,
        engagement: bucket.engagementRate,
    }));

    return (
        <div className="experiment-card glass-card">
            <div className="card-header">
                <div className="experiment-info">
                    <h4>{experiment.experimentName}</h4>
                    <span className={`status-badge ${experiment.status}`}>
                        {experiment.status === 'running' ? '运行中' : experiment.status === 'paused' ? '已暂停' : '已完成'}
                    </span>
                </div>
                {onManage && (
                    <button type="button" className="icon-btn" onClick={onManage} aria-label="管理实验">
                        <Settings size={16} />
                    </button>
                )}
            </div>

            <div className="experiment-chart">
                <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} horizontal={false} />
                        <XAxis type="number" stroke={CHART_AXIS_STROKE} tick={CHART_AXIS_TICK} />
                        <YAxis dataKey="name" type="category" stroke={CHART_AXIS_STROKE} tick={CHART_AXIS_TICK} width={64} />
                        <Tooltip
                            formatter={(value) => value !== undefined ? `${Number(value).toFixed(2)}%` : ''}
                            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                            cursor={{ fill: 'rgba(15, 20, 25, 0.04)' }}
                        />
                        <Bar dataKey="ctr" fill="#1D9BF0" radius={[0, 4, 4, 0]} name="CTR" />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="experiment-summary">
                {experiment.buckets.map((bucket) => {
                    const isWinner = bucket.ctr === maxCTR && bucket.bucketId !== 'control';
                    const ctrLift = controlBucket && controlBucket.ctr > 0
                        ? ((bucket.ctr - controlBucket.ctr) / controlBucket.ctr * 100)
                        : 0;

                    return (
                        <div key={bucket.bucketId} className={`bucket-summary ${isWinner ? 'winner' : ''}`}>
                            <span className="bucket-name">
                                {bucket.bucketName}
                                {isWinner && (
                                    <span className="winner-icon" aria-label="领先分桶">
                                        <Award size={14} />
                                    </span>
                                )}
                            </span>
                            {bucket.bucketId !== 'control' && ctrLift !== 0 && (
                                <span className={`lift ${ctrLift > 0 ? 'positive' : 'negative'}`}>
                                    {ctrLift > 0 ? '+' : ''}{ctrLift.toFixed(1)}%
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// 内容安全指标卡片
interface SafetyCardProps {
    safety: {
        totalChecked: number;
        flaggedCount: number;
        flagRate: number;
        byLevel: { high: number; medium: number; low: number; safe: number };
        byType: { spam: number; nsfw: number; hate: number; violence: number; other: number };
    };
}

const SafetyCard: React.FC<SafetyCardProps> = ({ safety }) => {
    const levelData = [
        { name: '高风险', value: safety.byLevel.high, color: '#E11D48' },
        { name: '中风险', value: safety.byLevel.medium, color: '#D97706' },
        { name: '低风险', value: safety.byLevel.low, color: '#1D9BF0' },
    ].filter(d => d.value > 0);

    return (
        <div className="safety-card glass-card">
            <div className="card-header">
                <h3><Shield size={18} /> 内容安全</h3>
                <span className="safety-rate-badge">
                    <AlertTriangle size={14} />
                    {safety.flagRate.toFixed(2)}% 标记率
                </span>
            </div>
            <div className="safety-content">
                <div className="safety-stats">
                    <div className="stat-item">
                        <span className="stat-value">{safety.totalChecked.toLocaleString()}</span>
                        <span className="stat-label">已检查</span>
                    </div>
                    <div className="stat-item flagged">
                        <span className="stat-value">{safety.flaggedCount.toLocaleString()}</span>
                        <span className="stat-label">已标记</span>
                    </div>
                </div>
                <div className="safety-chart">
                    <ResponsiveContainer width="100%" height={100}>
                        <PieChart>
                            <Pie
                                data={levelData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={25}
                                outerRadius={40}
                                paddingAngle={2}
                            >
                                {levelData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} stroke="#FFFFFF" strokeWidth={2} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                            />
                            <Legend
                                iconType="circle"
                                iconSize={8}
                                wrapperStyle={{ fontSize: '11px', color: '#536471' }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

// ===== 主监控看板组件 =====
export const Dashboard: React.FC = () => {
    const [data, setData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const dashboardData = await analyticsAPI.getDashboard();
            setData(dashboardData);
            setLastUpdated(new Date());
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '加载数据失败');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        // 每 30 秒自动刷新实时监控指标
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    if (isLoading && !data) {
        return (
            <div className="dashboard-loading">
                <div className="loading-spinner" />
                <span>加载监控数据...</span>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="dashboard-error">
                <AlertTriangle size={32} />
                <span>{error}</span>
                <button type="button" onClick={fetchData}>重试</button>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="dashboard">
            {/* 顶部导航栏 */}
            <header className="dashboard-header">
                <div className="header-title">
                    <Activity size={24} />
                    <div>
                        <h1>推荐系统监控</h1>
                        <span className="header-subtitle">实时数据分析看板</span>
                    </div>
                </div>
                <div className="header-actions">
                    {lastUpdated && (
                        <span className="last-updated">
                            更新于 {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                    <Link to="/admin/chat-runtime" className="runtime-link-btn">
                        <Activity size={16} />
                        Chat Runtime
                    </Link>
                    <button
                        type="button"
                        className="refresh-btn"
                        onClick={fetchData}
                        disabled={isLoading}
                        aria-label="刷新监控数据"
                        title="刷新监控数据"
                    >
                        <RefreshCw size={18} className={isLoading ? 'spinning' : ''} />
                    </button>
                </div>
            </header>

            {/* Bento Grid 数据布局 */}
            <div className="bento-grid">
                {/* 第一行：核心 KPI */}
                <div className="bento-row kpi-row">
                    <KPICard
                        title="总用户数"
                        value={data.overview.totalUsers.value}
                        change={data.overview.totalUsers.change}
                        trend={data.overview.totalUsers.trend}
                        icon={Users}
                        color="#1D9BF0"
                    />
                    <KPICard
                        title="日活跃用户"
                        value={data.overview.dau.value}
                        change={data.overview.dau.change}
                        trend={data.overview.dau.trend}
                        icon={Activity}
                        color="#0284C7"
                    />
                    <KPICard
                        title="总帖子数"
                        value={data.overview.totalPosts.value}
                        change={data.overview.totalPosts.change}
                        trend={data.overview.totalPosts.trend}
                        icon={FileText}
                        color="#00BA7C"
                    />
                    <KPICard
                        title="推荐请求"
                        value={data.overview.recommendationsServed.value}
                        change={data.overview.recommendationsServed.change}
                        trend={data.overview.recommendationsServed.trend}
                        icon={Zap}
                        color="#D97706"
                    />
                </div>

                {/* 第二行：延迟趋势 + 召回分布 */}
                <div className="bento-row metrics-row">
                    <LatencyChartCard latency={data.recommendation.requestMetrics.latency} />
                    <RecallDistributionCard distribution={data.recommendation.recallDistribution} />
                </div>

                {/* 第三行：实验对比 */}
                <div className="bento-row experiments-row">
                    <h2 className="section-title"><Settings size={20} /> A/B 实验</h2>
                    <div className="experiments-grid">
                        {data.experiments.map((exp) => (
                            <ExperimentCard key={exp.experimentId} experiment={exp} />
                        ))}
                    </div>
                </div>

                {/* 第四行：安全指标 */}
                <div className="bento-row safety-row">
                    <SafetyCard safety={data.safety} />
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
