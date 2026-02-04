/**
 * usePts Hook - PTS 消息序列管理 Hook
 * 实现客户端的消息序列追踪和 Gap Recovery
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../stores';

// PTS 状态
interface PtsState {
    pts: number;
    qts: number;
    date: number;
}

// Gap 状态
interface GapState {
    hasGap: boolean;
    missingCount: number;
}

/**
 * PTS Hook
 */
export function usePts() {
    const [state, setState] = useState<PtsState>({
        pts: 0,
        qts: 0,
        date: 0,
    });

    const [gap, setGap] = useState<GapState>({
        hasGap: false,
        missingCount: 0,
    });

    const [isRecovering, setIsRecovering] = useState(false);
    const { isAuthenticated } = useAuthStore();

    // 使用 ref 存储最新的 pts，避免闭包问题
    const ptsRef = useRef(state.pts);
    ptsRef.current = state.pts;

    // 获取初始状态
    useEffect(() => {
        if (!isAuthenticated) return;

        const fetchState = async () => {
            try {
                const response = await apiClient.get('/api/sync/state');
                const serverState = response.data.data;

                setState({
                    pts: serverState.pts,
                    qts: serverState.qts,
                    date: serverState.date,
                });
            } catch (err) {
                console.error('获取同步状态失败:', err);
            }
        };

        fetchState();
    }, [isAuthenticated]);

    /**
     * 检查消息是否有 Gap
     */
    const checkUpdate = useCallback((remotePts: number, ptsCount: number = 1): 'apply' | 'skip' | 'gap' => {
        const localPts = ptsRef.current;
        const expectedPts = localPts + ptsCount;

        if (expectedPts === remotePts) {
            return 'apply';
        } else if (expectedPts > remotePts) {
            return 'skip'; // 重复消息
        } else {
            return 'gap'; // 有消息丢失
        }
    }, []);

    /**
     * 应用更新 (更新本地 pts)
     */
    const applyUpdate = useCallback((newPts: number) => {
        setState((prev) => ({
            ...prev,
            pts: newPts,
            date: Math.floor(Date.now() / 1000),
        }));
    }, []);

    /**
     * 执行 Gap Recovery
     */
    const recoverGap = useCallback(async (): Promise<any[]> => {
        if (isRecovering) return [];

        setIsRecovering(true);

        try {
            const response = await apiClient.post('/api/sync/difference', {
                pts: ptsRef.current,
                limit: 100,
            });

            const data = response.data.data;

            if (data.messages && data.messages.length > 0) {
                // 更新本地 pts
                setState((prev) => ({
                    ...prev,
                    pts: data.state.pts,
                    date: data.state.date,
                }));

                setGap({
                    hasGap: !data.isLatest,
                    missingCount: data.isLatest ? 0 : data.missingCount - data.messages.length,
                });

                return data.messages;
            }

            setGap({ hasGap: false, missingCount: 0 });
            return [];
        } catch (err) {
            console.error('Gap Recovery 失败:', err);
            return [];
        } finally {
            setIsRecovering(false);
        }
    }, [isRecovering]);

    /**
     * 处理新消息
     */
    const handleNewMessage = useCallback(async (
        messagePts: number,
        ptsCount: number = 1
    ): Promise<{ action: 'apply' | 'skip' | 'recover'; recoveredMessages?: any[] }> => {
        const result = checkUpdate(messagePts, ptsCount);

        if (result === 'apply') {
            applyUpdate(messagePts);
            return { action: 'apply' };
        } else if (result === 'skip') {
            return { action: 'skip' };
        } else {
            // Gap 检测到，执行恢复
            setGap({ hasGap: true, missingCount: messagePts - ptsRef.current });
            const recoveredMessages = await recoverGap();
            return { action: 'recover', recoveredMessages };
        }
    }, [checkUpdate, applyUpdate, recoverGap]);

    /**
     * 确认收到消息
     */
    const acknowledgeMessages = useCallback(async () => {
        try {
            await apiClient.post('/api/sync/ack', {
                pts: ptsRef.current,
            });
        } catch (err) {
            console.error('消息确认失败:', err);
        }
    }, []);

    /**
     * P2: 检查大群更新
     * 从 localStorage 读取每个大群的本地 seq，与服务端对比
     */
    const checkSupergroupUpdates = useCallback(async (): Promise<{
        groupId: string;
        groupName: string;
        serverSeq: number;
        clientSeq: number;
    }[]> => {
        try {
            // 从 localStorage 读取本地大群 seq 状态
            const localStates = JSON.parse(localStorage.getItem('supergroup_seqs') || '{}');

            // 构建查询参数
            const statesParam = Object.entries(localStates)
                .map(([groupId, seq]) => `${groupId}:${seq}`)
                .join(',');

            const response = await apiClient.get('/api/sync/supergroups', {
                params: { states: statesParam },
            });

            const { updates } = response.data.data;

            if (updates && updates.length > 0) {
                console.log(`[P2] 发现 ${updates.length} 个大群有新消息`);
                return updates;
            }

            return [];
        } catch (err) {
            console.error('大群同步检查失败:', err);
            return [];
        }
    }, []);

    /**
     * P2: 更新本地大群 seq
     */
    const updateSupergroupSeq = useCallback((groupId: string, seq: number) => {
        const localStates = JSON.parse(localStorage.getItem('supergroup_seqs') || '{}');
        localStates[groupId] = seq;
        localStorage.setItem('supergroup_seqs', JSON.stringify(localStates));
    }, []);

    return {
        // 状态
        pts: state.pts,
        qts: state.qts,
        hasGap: gap.hasGap,
        missingCount: gap.missingCount,
        isRecovering,

        // 方法
        checkUpdate,
        applyUpdate,
        recoverGap,
        handleNewMessage,
        acknowledgeMessages,

        // P2: 大群同步
        checkSupergroupUpdates,
        updateSupergroupSeq,
    };
}

export default usePts;
