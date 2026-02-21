/**
 * useLocalSearch Hook
 * Worker-first 本地消息搜索：通过 ChatCoreWorker 查询，避免主线程扫描 IndexedDB。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useMessageStore } from '../features/chat/store/messageStore';
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
    const requestSeqRef = useRef(0);

    // 防抖搜索
    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            setIsSearching(false);
            setError(null);
            return;
        }

        setIsSearching(true);
        const requestSeq = requestSeqRef.current + 1;
        requestSeqRef.current = requestSeq;
        const timeoutId = setTimeout(async () => {
            try {
                const found = await useMessageStore.getState().searchActiveChat(query, 50);
                if (requestSeqRef.current !== requestSeq) return;
                setResults(found);
                setError(null);
            } catch (err: any) {
                if (requestSeqRef.current !== requestSeq) return;
                console.error('[P3] 本地搜索失败:', err);
                setError(err.message || '搜索失败');
                setResults([]);
            } finally {
                if (requestSeqRef.current === requestSeq) {
                    setIsSearching(false);
                }
            }
        }, debounceMs);

        return () => clearTimeout(timeoutId);
    }, [query, debounceMs]);

    const search = useCallback((newQuery: string) => {
        setQuery(newQuery);
    }, []);

    const clearResults = useCallback(() => {
        requestSeqRef.current += 1;
        setQuery('');
        setResults([]);
        setIsSearching(false);
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
