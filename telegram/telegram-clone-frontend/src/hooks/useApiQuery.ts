/**
 * useApiQuery - 自定义 API 请求 Hook
 * 实现请求缓存和去重
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// 请求状态
interface QueryState<T> {
    data: T | null;
    isLoading: boolean;
    error: Error | null;
    isStale: boolean;
}

// 缓存条目
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    subscribers: Set<() => void>;
}

// 全局缓存
const globalCache = new Map<string, CacheEntry<any>>();
const pendingRequests = new Map<string, Promise<any>>();

// 默认配置
const DEFAULT_STALE_TIME = 5 * 60 * 1000; // 5分钟
const DEFAULT_CACHE_TIME = 30 * 60 * 1000; // 30分钟

interface QueryOptions<T> {
    // 查询键
    queryKey: string[];
    // 查询函数
    queryFn: () => Promise<T>;
    // 数据过期时间(ms)
    staleTime?: number;
    // 缓存时间(ms)
    cacheTime?: number;
    // 是否启用
    enabled?: boolean;
    // 成功回调
    onSuccess?: (data: T) => void;
    // 失败回调
    onError?: (error: Error) => void;
    // 初始数据
    initialData?: T;
}

export function useApiQuery<T>({
    queryKey,
    queryFn,
    staleTime = DEFAULT_STALE_TIME,
    cacheTime = DEFAULT_CACHE_TIME,
    enabled = true,
    onSuccess,
    onError,
    initialData,
}: QueryOptions<T>): QueryState<T> & {
    refetch: () => Promise<void>;
    invalidate: () => void;
} {
    const cacheKey = queryKey.join(':');
    const mountedRef = useRef(true);

    const [state, setState] = useState<QueryState<T>>(() => {
        const cached = globalCache.get(cacheKey);
        if (cached) {
            const isStale = Date.now() - cached.timestamp > staleTime;
            return {
                data: cached.data,
                isLoading: false,
                error: null,
                isStale,
            };
        }
        return {
            data: initialData || null,
            isLoading: enabled,
            error: null,
            isStale: true,
        };
    });

    // 订阅缓存更新
    useEffect(() => {
        const cached = globalCache.get(cacheKey);
        if (cached) {
            const notify = () => {
                if (mountedRef.current) {
                    setState((prev) => ({
                        ...prev,
                        data: cached.data,
                        isStale: Date.now() - cached.timestamp > staleTime,
                    }));
                }
            };
            cached.subscribers.add(notify);
            return () => {
                cached.subscribers.delete(notify);
            };
        }
    }, [cacheKey, staleTime]);

    // 执行查询
    const fetchData = useCallback(async () => {
        // 检查是否有正在进行的相同请求
        let request = pendingRequests.get(cacheKey);

        if (!request) {
            request = queryFn();
            pendingRequests.set(cacheKey, request);
        }

        try {
            const data = await request;
            pendingRequests.delete(cacheKey);

            // 更新缓存
            const entry: CacheEntry<T> = {
                data,
                timestamp: Date.now(),
                subscribers: globalCache.get(cacheKey)?.subscribers || new Set(),
            };
            globalCache.set(cacheKey, entry);

            // 通知订阅者
            entry.subscribers.forEach((fn) => fn());

            // 设置缓存过期清理
            setTimeout(() => {
                const cached = globalCache.get(cacheKey);
                if (cached && Date.now() - cached.timestamp > cacheTime) {
                    globalCache.delete(cacheKey);
                }
            }, cacheTime);

            if (mountedRef.current) {
                setState({
                    data,
                    isLoading: false,
                    error: null,
                    isStale: false,
                });
                onSuccess?.(data);
            }
        } catch (err) {
            pendingRequests.delete(cacheKey);
            const error = err instanceof Error ? err : new Error(String(err));

            if (mountedRef.current) {
                setState((prev) => ({
                    ...prev,
                    isLoading: false,
                    error,
                }));
                onError?.(error);
            }
        }
    }, [cacheKey, queryFn, cacheTime, onSuccess, onError]);

    // 初始化和依赖变化时执行
    useEffect(() => {
        mountedRef.current = true;

        if (enabled) {
            const cached = globalCache.get(cacheKey);
            const isStale = !cached || Date.now() - cached.timestamp > staleTime;

            if (isStale) {
                setState((prev) => ({ ...prev, isLoading: true }));
                fetchData();
            }
        }

        return () => {
            mountedRef.current = false;
        };
    }, [cacheKey, enabled, staleTime, fetchData]);

    // 手动刷新
    const refetch = useCallback(async () => {
        setState((prev) => ({ ...prev, isLoading: true }));
        await fetchData();
    }, [fetchData]);

    // 使缓存失效
    const invalidate = useCallback(() => {
        globalCache.delete(cacheKey);
        if (enabled) {
            setState((prev) => ({ ...prev, isStale: true, isLoading: true }));
            fetchData();
        }
    }, [cacheKey, enabled, fetchData]);

    return {
        ...state,
        refetch,
        invalidate,
    };
}

// 全局缓存失效函数
export function invalidateQueries(keyPrefix: string): void {
    for (const key of globalCache.keys()) {
        if (key.startsWith(keyPrefix)) {
            globalCache.delete(key);
        }
    }
}

// 预取数据
export function prefetchQuery<T>(
    queryKey: string[],
    queryFn: () => Promise<T>,
    staleTime = DEFAULT_STALE_TIME
): Promise<void> {
    const cacheKey = queryKey.join(':');
    const cached = globalCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < staleTime) {
        return Promise.resolve();
    }

    return queryFn().then((data) => {
        globalCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            subscribers: new Set(),
        });
    });
}

export default useApiQuery;
