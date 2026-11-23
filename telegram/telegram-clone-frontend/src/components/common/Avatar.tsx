import React, { useEffect, useMemo, useState } from 'react';
import { getAvatarGradient, getInitials } from '../../lib/colorUtils';
import { resolveMediaCrossOrigin, withApiBase } from '../../utils/apiUrl';
import { isAvatarUrlLoaded, markAvatarUrlLoaded, resolveAvatarUrl } from '../../utils/media';
import './Avatar.css';

export interface AvatarProps {
    id?: string | number; // 用于生成默认渐变底色
    src?: string; // 原始头像链接
    name?: string; // 用于生成首字占位
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number; // 预设尺寸或具体像素
    isSavedMessages?: boolean; // 收藏夹特殊图标
    onClick?: () => void;
    className?: string;
    online?: boolean; // 在线状态指示点
    priority?: 'high' | 'normal' | 'low'; // 加载优先级（遵循 optimize-image-priority）
}

const Avatar: React.FC<AvatarProps> = ({
    id,
    src,
    name,
    size = 'md',
    isSavedMessages = false,
    onClick,
    className = '',
    online = false,
    priority = 'normal',
}) => {
    const primarySrc = useMemo(() => resolveAvatarUrl(src, size), [src, size]);
    const fallbackSrc = useMemo(() => withApiBase(src) ?? undefined, [src]);

    const [useFallbackSrc, setUseFallbackSrc] = useState(false);
    const [imgFailed, setImgFailed] = useState(false);
    const [imgLoaded, setImgLoaded] = useState(false);

    // 头像地址变更时重置状态，允许重新加载并触发新图片解码
    useEffect(() => {
        setUseFallbackSrc(false);
        setImgFailed(false);
        setImgLoaded(false);
    }, [primarySrc]);

    const activeSrc = useFallbackSrc ? fallbackSrc : primarySrc;
    const isAlreadyCached = Boolean(activeSrc && isAvatarUrlLoaded(activeSrc));
    const effectiveLoaded = imgLoaded || isAlreadyCached;
    const showImage = Boolean(activeSrc && !imgFailed && !isSavedMessages);
    const showInitials = !isSavedMessages && (!showImage || !effectiveLoaded);

    const sizeStyle = useMemo(() => {
        if (typeof size === 'number') {
            return { width: size, height: size, fontSize: size * 0.4 };
        }
        return {};
    }, [size]);

    const backgroundStyle = useMemo(() => {
        if (isSavedMessages || (showImage && effectiveLoaded)) {
            return {};
        }
        return { background: getAvatarGradient(id || 0) };
    }, [effectiveLoaded, id, isSavedMessages, showImage]);

    const initials = useMemo(() => getInitials(name || ''), [name]);

    const handleClick = (e: React.MouseEvent) => {
        if (onClick) {
            e.stopPropagation();
            onClick();
        }
    };

    const handleLoad = () => {
        if (activeSrc) {
            markAvatarUrlLoaded(activeSrc);
        }
        setImgLoaded(true);
    };

    const handleError = () => {
        if (!useFallbackSrc && fallbackSrc && fallbackSrc !== primarySrc) {
            setUseFallbackSrc(true);
            setImgLoaded(false);
            return;
        }
        setImgFailed(true);
    };

    // 严格遵守 optimize-image-priority：high 使用 eager+high；normal 仅 eager；low 仅 lazy 不叠 low
    const loadingAttr = priority === 'low' ? 'lazy' : 'eager';
    const fetchPriorityAttr = priority === 'high' ? 'high' : undefined;

    return (
        <div
            className={`tg-avatar tg-avatar-${typeof size === 'string' ? size : 'custom'} ${className}`}
            style={{ ...sizeStyle, ...backgroundStyle }}
            onClick={handleClick}
        >
            {isSavedMessages ? (
                <div className="tg-avatar-saved-icon">
                    <svg viewBox="0 0 24 24" fill="white" width="60%" height="60%">
                        <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
                    </svg>
                </div>
            ) : (
                <>
                    {showInitials && <span className="tg-avatar-initials">{initials}</span>}
                    {showImage && activeSrc && (
                        <img
                            src={activeSrc}
                            alt={name || 'Avatar'}
                            crossOrigin={resolveMediaCrossOrigin(activeSrc)}
                            className={`tg-avatar-img ${effectiveLoaded ? 'is-loaded' : ''}`}
                            loading={loadingAttr}
                            fetchPriority={fetchPriorityAttr}
                            decoding="async"
                            onLoad={handleLoad}
                            onError={handleError}
                        />
                    )}
                </>
            )}

            {online && <span className="tg-avatar-online" />}
        </div>
    );
};

export default React.memo(Avatar);
