/**
 * ExperimentManager - A/B 实验管理面板
 * 允许管理员动态调整实验流量 (0% -> 50%)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { analyticsAPI } from '../../services/analyticsApi';
import type { ExperimentConfig } from '../../types/analytics';
import './ExperimentManager.css';

// ===== 图标 =====
const PlayIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

const PauseIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
    </svg>
);

const TrashIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

const EditIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
);

const PlusIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

// ===== 子组件 =====

// 流量滑块
interface TrafficSliderProps {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}

const TrafficSlider: React.FC<TrafficSliderProps> = ({ value, onChange, disabled }) => {
    const [localValue, setLocalValue] = useState(value);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (!isDragging) {
            setLocalValue(value);
        }
    }, [value, isDragging]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = parseInt(e.target.value, 10);
        setLocalValue(newValue);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        if (localValue !== value) {
            onChange(localValue);
        }
    };

    return (
        <div className="traffic-slider">
            <div className="slider-header">
                <span className="slider-label">流量分配</span>
                <span className="slider-value">{localValue}%</span>
            </div>
            <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={localValue}
                onChange={handleChange}
                onMouseDown={() => setIsDragging(true)}
                onMouseUp={handleMouseUp}
                onTouchEnd={handleMouseUp}
                disabled={disabled}
                className="slider-input"
                style={{
                    '--slider-progress': `${localValue}%`,
                } as React.CSSProperties}
            />
            <div className="slider-marks">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
            </div>
        </div>
    );
};

// 桶权重编辑器
interface BucketWeightEditorProps {
    buckets: ExperimentConfig['buckets'];
    onChange: (buckets: ExperimentConfig['buckets']) => void;
    disabled?: boolean;
}

const BucketWeightEditor: React.FC<BucketWeightEditorProps> = ({ buckets, onChange, disabled }) => {
    const totalWeight = buckets.reduce((sum, b) => sum + b.weight, 0);

    const handleWeightChange = (index: number, newWeight: number) => {
        const newBuckets = [...buckets];
        newBuckets[index] = { ...newBuckets[index], weight: newWeight };
        onChange(newBuckets);
    };

    return (
        <div className="bucket-weight-editor">
            <div className="bucket-weight-header">
                <span>实验分桶</span>
                <span className={`total-weight ${totalWeight !== 100 ? 'invalid' : ''}`}>
                    总计: {totalWeight}%
                </span>
            </div>
            <div className="bucket-list">
                {buckets.map((bucket, index) => (
                    <div key={bucket.id} className="bucket-item">
                        <span className="bucket-name">{bucket.name}</span>
                        <div className="bucket-weight-input">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                value={bucket.weight}
                                onChange={(e) => handleWeightChange(index, parseInt(e.target.value, 10) || 0)}
                                disabled={disabled}
                            />
                            <span>%</span>
                        </div>
                        <div 
                            className="bucket-weight-bar"
                            style={{ width: `${bucket.weight}%` }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

// 实验卡片
interface ExperimentCardProps {
    experiment: ExperimentConfig;
    onUpdate: (updates: Partial<ExperimentConfig>) => Promise<void>;
    onToggle: (action: 'pause' | 'resume') => Promise<void>;
    onDelete: () => void;
}

const ExperimentCard: React.FC<ExperimentCardProps> = ({
    experiment,
    onUpdate,
    onToggle,
    onDelete,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [localTraffic, setLocalTraffic] = useState(experiment.trafficPercentage);
    const [localBuckets, setLocalBuckets] = useState(experiment.buckets);

    const handleTrafficChange = async (value: number) => {
        setLocalTraffic(value);
        setIsSaving(true);
        try {
            await onUpdate({ trafficPercentage: value });
        } finally {
            setIsSaving(false);
        }
    };

    const handleBucketsChange = (buckets: ExperimentConfig['buckets']) => {
        setLocalBuckets(buckets);
    };

    const handleSaveBuckets = async () => {
        setIsSaving(true);
        try {
            await onUpdate({ buckets: localBuckets });
            setIsEditing(false);
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggle = async () => {
        setIsSaving(true);
        try {
            await onToggle(experiment.status === 'running' ? 'pause' : 'resume');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className={`experiment-manager-card ${experiment.status}`}>
            {/* 头部 */}
            <div className="card-header">
                <div className="card-info">
                    <h3>{experiment.name}</h3>
                    {experiment.description && (
                        <p className="card-description">{experiment.description}</p>
                    )}
                    <div className="card-meta">
                        <span className={`status-badge ${experiment.status}`}>
                            {experiment.status === 'running' ? '运行中' : 
                             experiment.status === 'paused' ? '已暂停' : 
                             experiment.status === 'draft' ? '草稿' : '已完成'}
                        </span>
                        <span className="created-at">
                            创建于 {new Date(experiment.createdAt).toLocaleDateString()}
                        </span>
                    </div>
                </div>
                <div className="card-actions">
                    <button 
                        className={`action-btn toggle ${experiment.status}`}
                        onClick={handleToggle}
                        disabled={isSaving || experiment.status === 'completed'}
                        title={experiment.status === 'running' ? '暂停' : '启动'}
                    >
                        {experiment.status === 'running' ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button 
                        className="action-btn edit"
                        onClick={() => setIsEditing(!isEditing)}
                        disabled={isSaving}
                        title="编辑"
                    >
                        <EditIcon />
                    </button>
                    <button 
                        className="action-btn delete"
                        onClick={onDelete}
                        disabled={isSaving || experiment.status === 'running'}
                        title="删除"
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>

            {/* 流量控制 */}
            <TrafficSlider
                value={localTraffic}
                onChange={handleTrafficChange}
                disabled={isSaving || experiment.status !== 'running'}
            />

            {/* 桶编辑器 (可展开) */}
            {isEditing && (
                <div className="bucket-editor-section">
                    <BucketWeightEditor
                        buckets={localBuckets}
                        onChange={handleBucketsChange}
                        disabled={isSaving}
                    />
                    <div className="editor-actions">
                        <button 
                            className="btn-secondary"
                            onClick={() => {
                                setLocalBuckets(experiment.buckets);
                                setIsEditing(false);
                            }}
                        >
                            取消
                        </button>
                        <button 
                            className="btn-primary"
                            onClick={handleSaveBuckets}
                            disabled={isSaving}
                        >
                            {isSaving ? '保存中...' : '保存更改'}
                        </button>
                    </div>
                </div>
            )}

            {/* 保存指示器 */}
            {isSaving && <div className="saving-indicator">保存中...</div>}
        </div>
    );
};

// ===== 主组件 =====
export const ExperimentManager: React.FC = () => {
    const [experiments, setExperiments] = useState<ExperimentConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    const fetchExperiments = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await analyticsAPI.getExperiments();
            setExperiments(data);
        } catch (err: unknown) {
            setError(err.message || '加载实验列表失败');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchExperiments();
    }, [fetchExperiments]);

    const handleUpdate = async (id: string, updates: Partial<ExperimentConfig>) => {
        const updated = await analyticsAPI.updateExperiment(id, updates);
        setExperiments((prev) => 
            prev.map((exp) => exp.id === id ? { ...exp, ...updated } : exp)
        );
    };

    const handleToggle = async (id: string, action: 'pause' | 'resume') => {
        await analyticsAPI.toggleExperiment(id, action);
        setExperiments((prev) =>
            prev.map((exp) => 
                exp.id === id 
                    ? { ...exp, status: action === 'pause' ? 'paused' : 'running' }
                    : exp
            )
        );
    };

    const handleDelete = (id: string) => {
        if (window.confirm('确定要删除此实验吗？此操作无法撤销。')) {
            setExperiments((prev) => prev.filter((exp) => exp.id !== id));
            // TODO: Call API to delete
        }
    };

    const [isSeeding, setIsSeeding] = useState(false);
    const handleSeed = async () => {
        setIsSeeding(true);
        try {
            const results = await analyticsAPI.seedExperiments();
            const created = results.filter(r => r.status === 'created').length;
            const skipped = results.filter(r => r.status === 'skipped').length;
            alert(`种子实验初始化完成：${created} 个新建，${skipped} 个已存在`);
            fetchExperiments();
        } catch (err: unknown) {
            alert('初始化失败：' + (err.message || '未知错误'));
        } finally {
            setIsSeeding(false);
        }
    };

    if (isLoading) {
        return (
            <div className="experiment-manager-loading">
                <div className="loading-spinner" />
                <span>加载实验配置...</span>
            </div>
        );
    }

    return (
        <div className="experiment-manager">
            <header className="manager-header">
                <div>
                    <h1>🧪 实验管理</h1>
                    <p>管理 A/B 测试实验，调整流量分配</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        className="create-btn"
                        style={{ background: 'rgba(255,255,255,0.08)' }}
                        onClick={handleSeed}
                        disabled={isSeeding}
                    >
                        {isSeeding ? '⏳ 初始化中...' : '🌱 初始化种子实验'}
                    </button>
                    <button
                        className="create-btn"
                        onClick={() => setShowCreateModal(true)}
                    >
                        <PlusIcon />
                        创建实验
                    </button>
                </div>
            </header>

            {error && (
                <div className="error-banner">
                    ⚠️ {error}
                    <button onClick={fetchExperiments}>重试</button>
                </div>
            )}

            <div className="experiments-list">
                {experiments.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">🧪</span>
                        <h3>暂无实验</h3>
                        <p>点击"创建实验"开始您的第一个 A/B 测试</p>
                    </div>
                ) : (
                    experiments.map((exp) => (
                        <ExperimentCard
                            key={exp.id}
                            experiment={exp}
                            onUpdate={(updates) => handleUpdate(exp.id, updates)}
                            onToggle={(action) => handleToggle(exp.id, action)}
                            onDelete={() => handleDelete(exp.id)}
                        />
                    ))
                )}
            </div>

            {/* TODO: Create Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>创建新实验</h2>
                        <p>即将推出...</p>
                        <button onClick={() => setShowCreateModal(false)}>关闭</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExperimentManager;
