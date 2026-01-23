/**
 * useAnalytics - 用户行为追踪 Hook
 * 自动追踪曝光、点击、滚动等行为并上报
 */

import { useCallback, useRef, useEffect } from 'react';
import { analyticsAPI } from '../services/analyticsApi';
import type { UserBehaviorEvent } from '../types/analytics';
import { authUtils } from '../services/apiClient';

// 事件缓冲区配置
const BUFFER_SIZE = 10;
const FLUSH_INTERVAL = 5000; // 5秒

// 全局事件缓冲区
let eventBuffer: UserBehaviorEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// 刷新缓冲区
const flushBuffer = async () => {
    if (eventBuffer.length === 0) return;
    
    const eventsToSend = [...eventBuffer];
    eventBuffer = [];
    
    try {
        await analyticsAPI.trackBatch(eventsToSend);
    } catch (error) {
        console.warn('[Analytics] Failed to flush events:', error);
        // 失败时将事件放回缓冲区（最多保留100个）
        eventBuffer = [...eventsToSend, ...eventBuffer].slice(0, 100);
    }
};

// 添加事件到缓冲区
const addToBuffer = (event: UserBehaviorEvent) => {
    eventBuffer.push(event);
    
    // 缓冲区满时立即刷新
    if (eventBuffer.length >= BUFFER_SIZE) {
        flushBuffer();
    }
    
    // 设置定时刷新
    if (!flushTimer) {
        flushTimer = setTimeout(() => {
            flushBuffer();
            flushTimer = null;
        }, FLUSH_INTERVAL);
    }
};

// 页面卸载时刷新
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushBuffer);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushBuffer();
        }
    });
}

export interface UseAnalyticsOptions {
    source?: string;
    experimentId?: string;
    bucketId?: string;
}

export interface AnalyticsTracker {
    trackImpression: (postId: string, position?: number) => void;
    trackClick: (postId: string, position?: number) => void;
    trackLike: (postId: string) => void;
    trackReply: (postId: string) => void;
    trackRepost: (postId: string) => void;
    trackShare: (postId: string) => void;
    trackDwell: (postId: string, dwellTime: number) => void;
    trackScroll: (scrollDepth: number) => void;
    flush: () => Promise<void>;
}

export function useAnalytics(options: UseAnalyticsOptions = {}): AnalyticsTracker {
    const { source, experimentId, bucketId } = options;
    const userRef = useRef<string | null>(null);

    // 获取当前用户 ID
    useEffect(() => {
        const user = authUtils.getCurrentUser();
        userRef.current = user?.id || 'anonymous';
    }, []);

    // 创建事件
    const createEvent = useCallback((
        type: UserBehaviorEvent['type'],
        postId: string,
        metadata?: Partial<UserBehaviorEvent['metadata']>
    ): UserBehaviorEvent => ({
        type,
        postId,
        userId: userRef.current || 'anonymous',
        timestamp: new Date(),
        metadata: {
            source,
            experimentId,
            bucketId,
            ...metadata,
        },
    }), [source, experimentId, bucketId]);

    // 追踪曝光
    const trackImpression = useCallback((postId: string, position?: number) => {
        const event = createEvent('impression', postId, { position });
        addToBuffer(event);
    }, [createEvent]);

    // 追踪点击
    const trackClick = useCallback((postId: string, position?: number) => {
        const event = createEvent('click', postId, { position });
        addToBuffer(event);
    }, [createEvent]);

    // 追踪点赞
    const trackLike = useCallback((postId: string) => {
        const event = createEvent('like', postId);
        addToBuffer(event);
    }, [createEvent]);

    // 追踪回复
    const trackReply = useCallback((postId: string) => {
        const event = createEvent('reply', postId);
        addToBuffer(event);
    }, [createEvent]);

    // 追踪转发
    const trackRepost = useCallback((postId: string) => {
        const event = createEvent('repost', postId);
        addToBuffer(event);
    }, [createEvent]);

    // 追踪分享
    const trackShare = useCallback((postId: string) => {
        const event = createEvent('share', postId);
        addToBuffer(event);
    }, [createEvent]);

    // 追踪停留时间
    const trackDwell = useCallback((postId: string, dwellTime: number) => {
        // 只追踪超过 2 秒的停留
        if (dwellTime < 2000) return;
        const event = createEvent('dwell', postId, { dwellTime });
        addToBuffer(event);
    }, [createEvent]);

    // 追踪滚动深度
    const trackScroll = useCallback((scrollDepth: number) => {
        const event = createEvent('scroll', '__page__', { scrollDepth });
        addToBuffer(event);
    }, [createEvent]);

    // 手动刷新
    const flush = useCallback(async () => {
        await flushBuffer();
    }, []);

    return {
        trackImpression,
        trackClick,
        trackLike,
        trackReply,
        trackRepost,
        trackShare,
        trackDwell,
        trackScroll,
        flush,
    };
}

// ===== 曝光追踪 Hook =====
export interface UseImpressionTrackerOptions {
    threshold?: number; // 可见比例阈值 (0-1)
    delay?: number; // 延迟时间 (ms)
}

export function useImpressionTracker(
    postId: string,
    source?: string,
    options: UseImpressionTrackerOptions = {}
) {
    const { threshold = 0.5, delay = 1000 } = options;
    const elementRef = useRef<HTMLDivElement>(null);
    const impressedRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();
    const analytics = useAnalytics({ source });

    useEffect(() => {
        const element = elementRef.current;
        if (!element || impressedRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
                    // 元素可见，开始计时
                    timerRef.current = setTimeout(() => {
                        if (!impressedRef.current) {
                            impressedRef.current = true;
                            analytics.trackImpression(postId);
                        }
                    }, delay);
                } else {
                    // 元素不可见，取消计时
                    if (timerRef.current) {
                        clearTimeout(timerRef.current);
                    }
                }
            },
            { threshold }
        );

        observer.observe(element);

        return () => {
            observer.disconnect();
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [postId, source, threshold, delay, analytics]);

    return elementRef;
}

// ===== 停留时间追踪 Hook =====
export function useDwellTracker(postId: string, source?: string) {
    const elementRef = useRef<HTMLDivElement>(null);
    const startTimeRef = useRef<number | null>(null);
    const analytics = useAnalytics({ source });

    useEffect(() => {
        const element = elementRef.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting) {
                    // 开始计时
                    startTimeRef.current = Date.now();
                } else if (startTimeRef.current) {
                    // 结束计时，上报
                    const dwellTime = Date.now() - startTimeRef.current;
                    analytics.trackDwell(postId, dwellTime);
                    startTimeRef.current = null;
                }
            },
            { threshold: 0.5 }
        );

        observer.observe(element);

        return () => {
            observer.disconnect();
            // 组件卸载时也上报
            if (startTimeRef.current) {
                const dwellTime = Date.now() - startTimeRef.current;
                analytics.trackDwell(postId, dwellTime);
            }
        };
    }, [postId, source, analytics]);

    return elementRef;
}

export default useAnalytics;
