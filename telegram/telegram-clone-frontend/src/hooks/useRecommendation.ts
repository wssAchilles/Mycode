/**
 * useRecommendation Hook
 * 
 * 提供推荐系统功能的 React Hook
 * 基于 X 算法思想实现智能排序
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  recommendationAPI,
} from '../services/apiClient';
import type {
  RecommendationCandidate
} from '../services/apiClient';

// 互动类型常量
export const InteractionType = {
  MESSAGE_SENT: 'message_sent',
  MESSAGE_READ: 'message_read',
  MESSAGE_REPLIED: 'message_replied',
  CONTACT_ADDED: 'contact_added',
  GROUP_JOINED: 'group_joined',
  GROUP_MESSAGE_SENT: 'group_message_sent',
  PROFILE_VIEWED: 'profile_viewed',
  MESSAGE_IGNORED: 'message_ignored',
  CONTACT_REMOVED: 'contact_removed',
  CONTACT_BLOCKED: 'contact_blocked',
  GROUP_LEFT: 'group_left',
  GROUP_MUTED: 'group_muted',
  CONVERSATION_HIDDEN: 'conversation_hidden',
} as const;

export type InteractionType = typeof InteractionType[keyof typeof InteractionType];

export const TargetType = {
  USER: 'user',
  GROUP: 'group',
  MESSAGE: 'message',
} as const;

export type TargetType = typeof TargetType[keyof typeof TargetType];

interface UseRecommendationOptions {
  type?: 'user' | 'group';
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number; // 毫秒
}

interface UseRecommendationResult {
  // 数据
  recommendations: RecommendationCandidate[];
  isLoading: boolean;
  error: Error | null;
  isCached: boolean;
  lastUpdated: Date | null;

  // 方法
  refresh: () => Promise<void>;
  recordInteraction: (
    targetId: string,
    targetType: TargetType,
    interactionType: InteractionType,
    metadata?: Record<string, any>
  ) => void;
  getScoreForId: (id: string) => number | null;
  sortByRecommendation: <T extends { id: string }>(items: T[]) => T[];
}

/**
 * 推荐系统 Hook
 */
export function useRecommendation(
  options: UseRecommendationOptions = {}
): UseRecommendationResult {
  const {
    type,
    limit = 50,
    autoRefresh = false,
    refreshInterval = 5 * 60 * 1000, // 默认 5 分钟
  } = options;

  const [recommendations, setRecommendations] = useState<RecommendationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 用于批量记录互动
  const pendingInteractions = useRef<Array<{
    targetId: string;
    targetType: TargetType;
    interactionType: string;
    metadata?: Record<string, any>;
  }>>([]);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 获取推荐
  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await recommendationAPI.getRecommendations({ type, limit });

      setRecommendations(response.candidates);
      setIsCached(response.cached);
      setLastUpdated(new Date(response.generatedAt));
    } catch (err) {
      setError(err instanceof Error ? err : new Error('获取推荐失败'));
      console.error('获取推荐失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [type, limit]);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh]);

  // 批量发送互动记录
  const flushInteractions = useCallback(() => {
    if (pendingInteractions.current.length === 0) return;

    const interactions = [...pendingInteractions.current];
    pendingInteractions.current = [];

    recommendationAPI.recordInteractionBatch(interactions).catch(console.error);
  }, []);

  // 记录互动（使用防抖批量发送）
  const recordInteraction = useCallback((
    targetId: string,
    targetType: TargetType,
    interactionType: InteractionType,
    metadata?: Record<string, any>
  ) => {
    pendingInteractions.current.push({
      targetId,
      targetType,
      interactionType,
      metadata,
    });

    // 清除之前的定时器
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
    }

    // 设置新的定时器（500ms 后发送）
    flushTimeoutRef.current = setTimeout(flushInteractions, 500);

    // 如果累积了 10 条以上，立即发送
    if (pendingInteractions.current.length >= 10) {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
      flushInteractions();
    }
  }, [flushInteractions]);

  // 获取特定 ID 的推荐分数
  const getScoreForId = useCallback((id: string): number | null => {
    const candidate = recommendations.find(c => c.id === id);
    return candidate ? candidate.finalScore : null;
  }, [recommendations]);

  // 根据推荐分数排序任意列表
  const sortByRecommendation = useCallback(<T extends { id: string }>(items: T[]): T[] => {
    const scoreMap = new Map(recommendations.map(c => [c.id, c.finalScore]));

    return [...items].sort((a, b) => {
      const scoreA = scoreMap.get(a.id) ?? -Infinity;
      const scoreB = scoreMap.get(b.id) ?? -Infinity;
      return scoreB - scoreA;
    });
  }, [recommendations]);

  // 组件卸载时发送剩余的互动记录
  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
      flushInteractions();
    };
  }, [flushInteractions]);

  return {
    recommendations,
    isLoading,
    error,
    isCached,
    lastUpdated,
    refresh,
    recordInteraction,
    getScoreForId,
    sortByRecommendation,
  };
}

/**
 * 专门用于聊天列表的 Hook
 */
export function useSortedChatList(limit = 50) {
  const result = useRecommendation({ type: 'user', limit });

  return {
    ...result,
    sortedContactIds: result.recommendations.map(r => r.id),
  };
}

/**
 * 互动追踪 Hook
 * 用于在组件中追踪用户行为
 */
export function useInteractionTracker() {
  const { recordInteraction } = useRecommendation();

  // 追踪消息发送
  const trackMessageSent = useCallback((targetId: string, isGroup = false) => {
    recordInteraction(
      targetId,
      isGroup ? TargetType.GROUP : TargetType.USER,
      isGroup ? InteractionType.GROUP_MESSAGE_SENT : InteractionType.MESSAGE_SENT
    );
  }, [recordInteraction]);

  // 追踪消息阅读
  const trackMessageRead = useCallback((targetId: string, messageId: string) => {
    recordInteraction(
      targetId,
      TargetType.USER,
      InteractionType.MESSAGE_READ,
      { messageId }
    );
  }, [recordInteraction]);

  // 追踪查看用户资料
  const trackProfileView = useCallback((targetId: string) => {
    recordInteraction(
      targetId,
      TargetType.USER,
      InteractionType.PROFILE_VIEWED
    );
  }, [recordInteraction]);

  // 追踪加入群组
  const trackGroupJoin = useCallback((groupId: string) => {
    recordInteraction(
      groupId,
      TargetType.GROUP,
      InteractionType.GROUP_JOINED
    );
  }, [recordInteraction]);

  // 追踪屏蔽用户
  const trackBlock = useCallback((targetId: string) => {
    recordInteraction(
      targetId,
      TargetType.USER,
      InteractionType.CONTACT_BLOCKED
    );
  }, [recordInteraction]);

  // 追踪静音群组
  const trackMute = useCallback((groupId: string) => {
    recordInteraction(
      groupId,
      TargetType.GROUP,
      InteractionType.GROUP_MUTED
    );
  }, [recordInteraction]);

  return {
    trackMessageSent,
    trackMessageRead,
    trackProfileView,
    trackGroupJoin,
    trackBlock,
    trackMute,
  };
}

export default useRecommendation;
