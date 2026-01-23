/**
 * SensitiveContentOverlay - 敏感内容遮罩组件
 * 对 VF 标记为低风险的内容显示警告遮罩
 */

import {
    AlertTriangle,
    ShieldAlert,
    Ban,
    CheckCircle2
} from 'lucide-react';
import './SensitiveContentOverlay.css';

export type SafetyLevel = 'safe' | 'low' | 'medium' | 'high';

export interface SensitiveContentOverlayProps {
    level: SafetyLevel;
    reason?: string;
    children: React.ReactNode;
    blurAmount?: number;
    showForLow?: boolean;
    onReveal?: () => void;
}

// 级别配置
const LEVEL_CONFIG: Record<SafetyLevel, {
    show: boolean;
    icon: React.ElementType;
    title: string;
    description: string;
    buttonText: string;
    color: string;
    bgGradient: string;
}> = {
    safe: {
        show: false,
        icon: CheckCircle2,
        title: '',
        description: '',
        buttonText: '',
        color: '#4fae4e',
        bgGradient: ''
    },
    low: {
        show: true,
        icon: AlertTriangle,
        title: '潜在敏感内容',
        description: '包含可能不适合公共环境的内容',
        buttonText: '显示内容',
        color: '#ffb300', // Amber
        bgGradient: 'linear-gradient(135deg, rgba(255,179,0,0.2) 0%, rgba(255,143,0,0.1) 100%)'
    },
    medium: {
        show: true,
        icon: ShieldAlert,
        title: '敏感内容警告',
        description: '此内容已被标记为可能令人不适',
        buttonText: '我已年满18岁，继续查看',
        color: '#f44336', // Red
        bgGradient: 'linear-gradient(135deg, rgba(244,67,54,0.25) 0%, rgba(211,47,47,0.15) 100%)'
    },
    high: {
        show: true,
        icon: Ban,
        title: '内容受限',
        description: '此内容因违反社区准则已被隐藏',
        buttonText: '',
        color: '#d32f2f', // Dark Red
        bgGradient: 'linear-gradient(135deg, rgba(211,47,47,0.3) 0%, rgba(183,28,28,0.2) 100%)'
    },
};

export const SensitiveContentOverlay: React.FC<SensitiveContentOverlayProps> = ({
    level,
    reason,
    children,
    blurAmount = 20,
    showForLow = true,
    onReveal,
}) => {
    const [revealed, setRevealed] = useState(false);
    const config = LEVEL_CONFIG[level];

    // 决定是否显示遮罩
    const shouldShowOverlay = config.show && (level !== 'low' || showForLow) && !revealed;

    const handleReveal = useCallback(() => {
        if (level === 'high') return; // 高风险内容不可揭示
        setRevealed(true);
        onReveal?.();
    }, [level, onReveal]);

    if (!shouldShowOverlay) {
        return <>{children}</>;
    }

    return (
        <div className={`sensitive-content-wrapper level-${level}`}>
            {/* 模糊的内容 */}
            <div
                className="sensitive-content-blur"
                style={{ filter: `blur(${blurAmount}px)` }}
            >
                {children}
            </div>

            {/* 遮罩层 */}
            <div
                className="sensitive-overlay"
                style={{ '--overlay-color': config.color } as React.CSSProperties}
            >
                <div className="overlay-content">
                    <span className="overlay-icon">{config.icon}</span>
                    <h4 className="overlay-title">{config.title}</h4>
                    <p className="overlay-description">
                        {reason || config.description}
                    </p>
                    {level !== 'high' && (
                        <button
                            className="overlay-button"
                            onClick={handleReveal}
                        >
                            {config.buttonText}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// 简化的警告标签（用于列表预览）
export interface SensitiveTagProps {
    level: SafetyLevel;
    onClick?: () => void;
}

export const SensitiveTag: React.FC<SensitiveTagProps> = ({ level, onClick }) => {
    if (level === 'safe') return null;

    const config = LEVEL_CONFIG[level];

    return (
        <span
            className={`sensitive-tag level-${level}`}
            style={{ '--tag-color': config.color } as React.CSSProperties}
            onClick={onClick}
        >
            {config.icon} {level === 'low' ? '敏感' : level === 'medium' ? '限制' : '禁止'}
        </span>
    );
};

export default SensitiveContentOverlay;
