/**
 * useLocalSearch Hook
 * P3: 本地消息搜索 - 从 IndexedDB 搜索已缓存的消息
 */
import { useState, useEffect, useCallback } from 'react';
import { messageCache } from '../services/db';
import type { Message } from '../types/chat';

interface UseLocalSearchResult {
    results: Message[];
    isSearching: boolean;
    error: string | null;
    search: (query: string) => void;
    clearResults: () => void;
}

/**
 * 本地消息搜索 Hook
 * @param debounceMs 防抖延迟（毫秒）
 */
export function useLocalSearch(debounceMs = 300): UseLocalSearchResult {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Message[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 防抖搜索
    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            return;
        }

        setIsSearching(true);
        const timeoutId = setTimeout(async () => {
            try {
                const found = await messageCache.searchMessages(query, 50);
                setResults(found);
                setError(null);
            } catch (err: any) {
                console.error('[P3] 本地搜索失败:', err);
                setError(err.message || '搜索失败');
                setResults([]);
            } finally {
                setIsSearching(false);
            }
        }, debounceMs);

        return () => clearTimeout(timeoutId);
    }, [query, debounceMs]);

    const search = useCallback((newQuery: string) => {
        setQuery(newQuery);
    }, []);

    const clearResults = useCallback(() => {
        setQuery('');
        setResults([]);
        setError(null);
    }, []);

    return {
        results,
        isSearching,
        error,
        search,
        clearResults,
    };
}

export default useLocalSearch;
